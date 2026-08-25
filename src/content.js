// Örtü — sayfa katmanı
//
// Üç iş yapar:
//   1) GÖNDERİM KORUMASI — Enter / gönder düğmesi anında metni denetler.
//   2) YAPIŞTIRMA KORUMASI — pano metni sayfaya girmeden denetler.
//   3) YAZARKEN ROZET — metne dokunmadan, yanında ne bulunduğunu gösterir.
//
// Neden dinleyiciler `window` üzerinde ve CAPTURE fazında?
// ChatGPT gibi editörler Enter'ı window + capture fazında yakalayıp
// stopImmediatePropagation çağırıyor. Dinleyici `document` üzerinde olursa
// sıra hiç gelmiyor ve mesaj maskelenmeden gidiyor. Aynı hedef ve fazda
// sıralama KAYIT SIRASINA göre olduğu için sayfanın kendi betiğinden önce
// kaydolmak gerekiyor — bu yüzden manifest'te run_at: document_start.

(() => {
    'use strict';

    let settings = { ...ORTU_DEFAULTS };
    let siteOn = true;
    const host = ortuHostOf(location.href);

    // Kendi tetiklediğimiz gönderimi tekrar yakalamamak için tek seferlik bayrak.
    let bypass = false;
    let lastTyped = null;
    // Açık tür kümesi yalnızca ayar değişince yeniden kuruluyor. Eskiden her
    // çağrıda kuruluyordu ve yazarken tarama her 600 ms'de bir çalıştığı için
    // uzun metinde gereksiz iş çıkarıyordu.
    let enabledCache = null;

    chrome.storage.local.get(['settings'], (res) => applySettings(res && res.settings));

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.settings) return;
        applySettings(changes.settings.newValue);
    });

    function applySettings(raw) {
        settings = ortuMigrate(raw);
        siteOn = ortuSiteEnabled(settings, host);
        enabledCache = null;   // profil değişmiş olabilir
    }

    // ── Alan yardımcıları ────────────────────────────────────────────────────

    function isEditable(el) {
        if (!el || el.nodeType !== 1) return false;
        // Şifre alanına hiç dokunulmaz.
        if (el.tagName === 'INPUT' && el.type === 'password') return false;
        if (el.tagName === 'TEXTAREA') return true;
        if (el.tagName === 'INPUT') return ['text', 'search', 'email', 'url', 'tel', ''].includes(el.type);
        if (el.isContentEditable === true) return true;
        // isContentEditable her ortamda yok; niteliğe de bakılır ve üst
        // elemanlar taranır (editörler çoğu zaman iç bir düğümü odaklar).
        return !!(el.closest && el.closest('[contenteditable=""], [contenteditable="true"]'));
    }

    function readValue(el) {
        if (!el) return '';
        if ('value' in el && typeof el.value === 'string') return el.value;
        return el.innerText || el.textContent || '';
    }

    // Metni alana yazmanın güvenilir yolu.
    // execCommand('insertText') deprecated ama React/ProseMirror/Lexical'ın
    // duyduğu input olaylarını doğru üreten tek yol; native setter yedeği var.
    function writeValue(el, text) {
        el.focus();
        try {
            if ('value' in el && typeof el.value === 'string') {
                // email/url gibi tiplerde setSelectionRange istisna atar.
                try { el.setSelectionRange(0, el.value.length); } catch (_) { el.select && el.select(); }
            } else {
                const range = document.createRange();
                range.selectNodeContents(el);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }
            if (document.execCommand('insertText', false, text)) return true;
        } catch (_) { /* aşağıdaki yedeğe düş */ }

        try {
            if ('value' in el) {
                const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
                const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
                setter.call(el, text);
            } else {
                el.textContent = text;
            }
            el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
            return true;
        } catch (_) {
            return false;
        }
    }

    // Gönder düğmesine tıklandığında hangi alanın denetleneceğini bulur.
    // Eskiden yalnızca `lastTyped`e bakılıyordu: kullanıcı metni YAPIŞTIRIP
    // (input olayı bizim yolumuzdan geçmeden) düğmeye tıkladığında alan
    // bulunamıyor ve gönderim hiç denetlenmeden çıkıyordu.
    function editableFor(btn) {
        if (isEditable(document.activeElement)) return document.activeElement;
        if (lastTyped && document.contains(lastTyped) && isEditable(lastTyped)) return lastTyped;
        const scopes = [btn.closest('form'), btn.parentElement,
            btn.closest('div[class]'), document].filter(Boolean);
        for (const scope of scopes) {
            const found = scope.querySelector &&
                scope.querySelector('textarea, [contenteditable="true"], [contenteditable=""]');
            if (found && isEditable(found)) return found;
        }
        return null;
    }

    function findSendButton(el) {
        const form = el.closest && el.closest('form');
        const scopes = [form, el.parentElement, el.closest && el.closest('div[class]'), document].filter(Boolean);
        const selectors = [
            'button[data-testid*="send" i]',
            'button[aria-label*="gönder" i]',
            'button[aria-label*="send" i]',
            'button[type="submit"]',
            '[role="button"][aria-label*="send" i]',
        ];
        for (const scope of scopes) {
            for (const sel of selectors) {
                const btn = scope.querySelector && scope.querySelector(sel);
                if (btn && !btn.disabled) return btn;
            }
        }
        return null;
    }

    // ── Analiz ───────────────────────────────────────────────────────────────

    function analyze(text) {
        if (!enabledCache) enabledCache = ortuResolveEntities(settings, ORTU_ALL_ENTITIES);
        return ortuDetect(text, { enabled: enabledCache, threshold: settings.threshold });
    }

    function active() {
        return settings.enabled && siteOn;
    }

    // Token haritasını service worker'a gönder: chrome.storage.session içinde,
    // yalnızca bellekte tutulur, diske yazılmaz.
    function storeMap(map) {
        if (!map || !map.size) return;
        chrome.runtime.sendMessage(
            { type: 'ortu:store-map', host, entries: [...map.entries()] },
            () => void chrome.runtime.lastError,
        );
    }

    // ── 1. Gönderim koruması ─────────────────────────────────────────────────

    function submitGuard(event, el, resume) {
        const text = readValue(el);
        // Analiz preventDefault'tan ÖNCE çalışır: metin temizse veya motor hata
        // verirse gönderim hiç kesilmez. Kullanıcının mesajını rehin almıyoruz.
        let findings = [];
        try {
            findings = analyze(text);
        } catch (err) {
            return false;
        }
        if (!ortuShouldIntercept(text, findings, settings)) return false;

        event.preventDefault();
        event.stopImmediatePropagation();

        if (settings.sendMode === 'otomatik') {
            const masked = ortuMask(text, findings, { style: settings.style, labels: ORTU_LABELS });
            storeMap(masked.map);
            writeValue(el, masked.text);
            bump(findings.length);
            ORTU_UI.toast(findings.length + ' veri maskelendi, gönderiliyor');
            setTimeout(() => resume(el), 30);
            return true;
        }

        ORTU_UI.showPanel({
            text, findings, settings, labels: ORTU_LABELS, reason: 'send',
            onSettings: (patch) => saveSettings(patch),
            onConfirm: (kept, s) => {
                const masked = ortuMask(text, findings, { style: s.style, kept, labels: ORTU_LABELS });
                storeMap(masked.map);
                writeValue(el, masked.text);
                bump(findings.length - kept.size);
                setTimeout(() => resume(el), 30);
            },
            onRaw: () => resume(el),
            onCancel: () => { /* metin alanda kalır, gönderim iptal */ },
        });
        return true;
    }

    // Gönderimi yeniden tetikle. Başarısız olursa mesaj KAYBOLMAZ: maskeli
    // metin alanda hazır bekler ve kullanıcıya Enter'a basması söylenir.
    function resumeByEnter(el) {
        bypass = true;
        el.focus();
        const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
        el.dispatchEvent(new KeyboardEvent('keydown', opts));
        el.dispatchEvent(new KeyboardEvent('keyup', opts));
        setTimeout(() => { bypass = false; }, 250);
        // Denetim her durumda yapılır. Eskiden yalnızca olay iptal EDİLMEDİĞİNDE
        // yedek yol deneniyordu; oysa sayfa preventDefault çağırıp yine de
        // göndermeyebiliyor (düğme pasifse) ve mesaj sessizce asılı kalıyordu.
        setTimeout(() => {
            if (readValue(el).trim().length) {
                const btn = findSendButton(el);
                if (btn) { bypass = true; btn.click(); setTimeout(() => { bypass = false; }, 250); }
                else ORTU_UI.toast('Maskeli metin hazır. Göndermek için Enter\'a bas');
            }
        }, 220);
    }

    function resumeByClick(btn) {
        return () => {
            bypass = true;
            btn.click();
            setTimeout(() => { bypass = false; }, 250);
        };
    }

    window.addEventListener('keydown', (e) => {
        if (bypass || !active() || settings.sendMode === 'kapali') return;
        if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
        if (ORTU_UI.isPanelOpen()) return;
        const el = e.target;
        if (!isEditable(el)) return;
        submitGuard(e, el, resumeByEnter);
    }, true);

    window.addEventListener('click', (e) => {
        if (bypass || !active() || settings.sendMode === 'kapali') return;
        if (ORTU_UI.isPanelOpen()) return;
        const btn = e.target.closest && e.target.closest('button, [role="button"]');
        if (!btn) return;
        // DİKKAT: btn.type özelliği, nitelik yazılmamış her <button> için
        // "submit" döner. Özelliği kullanmak sayfadaki HER düğmeyi gönder
        // düğmesi sayıyordu ("kopyala", "yeni sohbet" dahil). Niteliğe bakılır.
        const hint = ((btn.getAttribute('data-testid') || '') + ' ' +
                      (btn.getAttribute('aria-label') || '') + ' ' +
                      (btn.getAttribute('type') || '')).toLowerCase();
        // Tanımadığı düğmeye karışmaz. Enter yolu birincil, bu yol yedek.
        if (!/send|gönder|submit/.test(hint)) return;
        const el = editableFor(btn);
        if (!el || !readValue(el).trim()) return;
        submitGuard(e, el, resumeByClick(btn));
    }, true);

    // ── 2. Yapıştırma koruması ───────────────────────────────────────────────

    window.addEventListener('paste', (e) => {
        if (!active() || settings.pasteMode === 'kapali') return;
        const el = e.target;
        if (!isEditable(el)) return;
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        if (!text) return;

        let findings = [];
        try { findings = analyze(text); } catch (_) { return; }
        if (!ortuShouldIntercept(text, findings, settings)) return;

        e.preventDefault();
        e.stopImmediatePropagation();

        if (settings.pasteMode === 'sessiz') {
            const masked = ortuMask(text, findings, { style: settings.style, labels: ORTU_LABELS });
            storeMap(masked.map);
            const before = readValue(el);
            insertAtCursor(el, masked.text);
            bump(findings.length);
            ORTU_UI.toast(findings.length + ' veri maskelendi', 'geri al', () => writeValue(el, before + text));
            return;
        }

        ORTU_UI.showPanel({
            text, findings, settings, labels: ORTU_LABELS, reason: 'paste',
            onSettings: (patch) => saveSettings(patch),
            onConfirm: (kept, s) => {
                const masked = ortuMask(text, findings, { style: s.style, kept, labels: ORTU_LABELS });
                storeMap(masked.map);
                insertAtCursor(el, masked.text);
                bump(findings.length - kept.size);
            },
            onRaw: () => insertAtCursor(el, text),
        });
    }, true);

    function insertAtCursor(el, text) {
        el.focus();
        try {
            if (document.execCommand('insertText', false, text)) return;
        } catch (_) { /* yedek */ }
        writeValue(el, readValue(el) + text);
    }

    // ── 3. Yazarken rozet ────────────────────────────────────────────────────

    let typingTimer = null;

    window.addEventListener('input', (e) => {
        const el = e.target;
        if (!isEditable(el)) return;
        lastTyped = el;
        if (!active() || !settings.typingHints) return;
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            if (ORTU_UI.isPanelOpen()) return;
            const text = readValue(el);
            let findings = [];
            try { findings = analyze(text); } catch (_) { return; }
            if (!ortuShouldIntercept(text, findings, settings)) return ORTU_UI.hideBadge();
            const s = ortuSummarize(findings, ORTU_LABELS);
            // Metne DOKUNULMAZ; yalnızca ne bulunduğu gösterilir.
            ORTU_UI.showBadge(el, s.total + ' · ' + ortuGroupText(s.groups, 2), () => maskField(el));
        }, 600);
    }, true);

    window.addEventListener('scroll', () => ORTU_UI.hideBadge(), true);
    window.addEventListener('blur', () => ORTU_UI.hideBadge(), true);

    // ── Menü ve kısayol komutları ────────────────────────────────────────────

    function maskField(el) {
        const target = el || document.activeElement;
        if (!isEditable(target)) return ORTU_UI.toast('Önce bir metin alanına tıkla');
        const text = readValue(target);
        const findings = analyze(text);
        if (!findings.length) return ORTU_UI.toast('Bu alanda kişisel veri bulunmadı');
        ORTU_UI.showPanel({
            text, findings, settings, labels: ORTU_LABELS, reason: 'field',
            onSettings: (patch) => saveSettings(patch),
            onConfirm: (kept, s) => {
                const masked = ortuMask(text, findings, { style: s.style, kept, labels: ORTU_LABELS });
                storeMap(masked.map);
                writeValue(target, masked.text);
                bump(findings.length - kept.size);
            },
            onRaw: () => { },
        });
    }

    function decodeSelection() {
        const sel = String(window.getSelection());
        if (!sel.trim()) return ORTU_UI.toast('Önce çözülecek metni seç');
        if (!ortuHasTokens(sel)) return ORTU_UI.toast('Seçili metinde token yok');
        chrome.runtime.sendMessage({ type: 'ortu:get-map', host }, (res) => {
            if (chrome.runtime.lastError) return;
            const map = new Map(res && res.entries || []);
            const decoded = ortuDecode(sel, map);
            if (decoded === sel) return ORTU_UI.toast('Bu token\'ların karşılığı bu oturumda yok');
            showDecoded(decoded);
        });
    }

    function showDecoded(text) {
        ORTU_UI.showPanel({
            text, findings: [], settings, labels: ORTU_LABELS, reason: 'decode',
            onConfirm: () => {
                if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => { });
                ORTU_UI.toast('Panoya kopyalandı. Pano başka uygulamalara açıktır');
            },
            onRaw: () => { },
        });
    }

    chrome.runtime.onMessage.addListener((msg) => {
        if (!msg || !msg.type) return;
        if (msg.type === 'ortu:mask-field') maskField(null);
        else if (msg.type === 'ortu:decode-selection') decodeSelection();
    });

    // ── Ayar yazma ve sayaç ──────────────────────────────────────────────────

    function saveSettings(patch) {
        settings = ortuMigrate({ ...settings, ...patch });
        enabledCache = null;
        chrome.storage.local.set({ settings }, () => void chrome.runtime.lastError);
    }

    // Yalnızca TOPLAM sayı tutulur. İçerik hiçbir zaman saklanmaz.
    function bump(n) {
        if (!n) return;
        chrome.runtime.sendMessage({ type: 'ortu:count', n }, () => void chrome.runtime.lastError);
    }
})();
