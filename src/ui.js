// Örtü — arayüz katmanı
//
// Panel, rozet ve bildirim KAPALI bir shadow root içinde yaşar
// (mode: 'closed'). Content script'ler yalıtık dünyada çalıştığı için sayfa
// attachShadow'u ele geçiremiyor; kapalı root sayfanın panelde görünen kişisel
// veriyi okumasını gerçekten engelliyor. Bu sadece kozmetik bir yalıtım değil,
// gizlilik sınırının kendisi.
//
// Tasarım kararı: panel ekranın ORTASINDA açılır. Sohbet kutusu her zaman
// sayfanın en altında olduğu için alta yapışan bir panel gönder düğmesinin
// üstüne biniyor ve kullanıcı kararı okumadan tıklıyordu.

const ORTU_UI = (() => {
    let host = null, root = null;
    let panelEl = null, badgeEl = null, toastEl = null;
    let escHandler = null;

    const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .backdrop {
      position: fixed; inset: 0; z-index: 2147483646;
      background: rgba(8, 11, 15, .58);
      display: grid; place-items: center;
      font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
      animation: fade .12s ease-out;
    }
    @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
    @media (prefers-reduced-motion: reduce) { .backdrop { animation: none } }

    .panel {
      width: min(560px, calc(100vw - 32px));
      max-height: min(720px, calc(100vh - 48px));
      display: flex; flex-direction: column;
      background: #12161c; color: #e7ecf2;
      border: 1px solid #263041; border-radius: 14px;
      box-shadow: 0 24px 60px rgba(0,0,0,.5);
      overflow: hidden;
    }

    .head {
      display: flex; align-items: center; gap: 10px;
      padding: 13px 16px; border-bottom: 1px solid #1e2632;
      background: #151a22;
    }
    .brand { font-size: 13px; font-weight: 650; letter-spacing: .02em; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #5fd3b0; }
    .head .why { font-size: 12px; color: #8d9bad; }
    .x {
      margin-left: auto; background: none; border: 0; color: #8d9bad;
      font-size: 16px; line-height: 1; cursor: pointer; padding: 4px 6px; border-radius: 6px;
    }
    .x:hover { background: #1e2632; color: #e7ecf2 }
    .x:focus-visible { outline: 2px solid #5fd3b0; outline-offset: 1px }

    .strip {
      display: flex; align-items: center; gap: 12px;
      padding: 11px 16px; background: #171d26; border-bottom: 1px solid #1e2632;
    }
    .count {
      font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums;
      min-width: 28px; color: #5fd3b0;
    }
    .strip .types { font-size: 13px; }
    .strip .sub { font-size: 11.5px; color: #8d9bad; margin-top: 1px }
    .bulk { margin-left: auto; display: flex; gap: 6px }
    .link {
      background: none; border: 0; color: #7fb6ff; font-size: 12px;
      cursor: pointer; padding: 3px 5px; border-radius: 5px;
    }
    .link:hover { background: #1e2632 }
    .link:focus-visible { outline: 2px solid #5fd3b0; outline-offset: 1px }

    /* min-height: 0 şart. Flex çocuğunun varsayılan min-height'i auto olduğu
       için liste uzunken panel max-height'ini aşıyor ve alt sıra (gönder
       düğmeleri) ekranın dışında kalıyordu. */
    .body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 6px 0; }

    .row {
      display: grid; grid-template-columns: 20px 1fr auto;
      gap: 10px; align-items: start; padding: 9px 16px;
      border-bottom: 1px solid #171d26;
    }
    .row:last-child { border-bottom: 0 }
    .row input { margin-top: 2px; accent-color: #5fd3b0; width: 15px; height: 15px; cursor: pointer }
    .val {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12.5px; word-break: break-word; line-height: 1.45;
    }
    .row.open .val { text-decoration: line-through; color: #8d9bad }
    .meta { font-size: 11px; color: #8d9bad; margin-top: 3px; display: flex; gap: 8px; align-items: center }
    .warn { color: #ffab5e; font-weight: 600 }
    .bar { display: inline-flex; gap: 2px }
    .bar i { width: 9px; height: 4px; border-radius: 1px; background: #2a3444 }
    .bar i.on { background: #5fd3b0 }
    .tag {
      font-size: 10.5px; color: #9fb0c4; background: #1b2330;
      padding: 2px 7px; border-radius: 999px; white-space: nowrap;
    }

    .preview { border-top: 1px solid #1e2632; background: #10141a }
    .preview > summary {
      list-style: none; cursor: pointer; padding: 11px 16px;
      font-size: 12.5px; color: #b8c4d2; display: flex; gap: 7px; align-items: center;
    }
    .preview > summary::-webkit-details-marker { display: none }
    .preview > summary::before { content: '▸'; color: #5fd3b0; font-size: 11px }
    .preview[open] > summary::before { content: '▾' }
    .out {
      margin: 0 16px 14px; padding: 11px 13px;
      border-left: 3px solid #5fd3b0; border-radius: 0 8px 8px 0;
      background: #171d26; max-height: 190px; overflow-y: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word;
    }
    .out.leaky { border-left-color: #ffab5e }

    .foot {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 16px; border-top: 1px solid #1e2632; background: #151a22;
    }
    .btn {
      font: inherit; font-size: 13px; padding: 8px 14px; border-radius: 8px;
      border: 1px solid #2a3444; background: #1b2330; color: #e7ecf2; cursor: pointer;
    }
    .btn:hover { background: #212a38 }
    .btn:focus-visible { outline: 2px solid #5fd3b0; outline-offset: 2px }
    .btn.primary { background: #5fd3b0; border-color: #5fd3b0; color: #0c1116; font-weight: 650 }
    .btn.primary:hover { background: #74dcbc }
    .btn.ghost { border-color: transparent; background: transparent; color: #9fb0c4 }
    .btn.ghost:hover { background: #1b2330 }
    .spacer { flex: 1 }

    .opts { padding: 12px 16px; border-top: 1px solid #1e2632; background: #10141a; display: none }
    .opts.show { display: block }
    .opts h4 { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: #8d9bad; margin-bottom: 7px }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px }
    .chip {
      font: inherit; font-size: 12px; padding: 5px 11px; border-radius: 999px;
      border: 1px solid #2a3444; background: transparent; color: #b8c4d2; cursor: pointer;
    }
    .chip[aria-pressed="true"] { background: #5fd3b0; border-color: #5fd3b0; color: #0c1116; font-weight: 600 }
    .chip:focus-visible { outline: 2px solid #5fd3b0; outline-offset: 2px }

    /* Rozet: alana yapışık, tıklanınca paneli açar */
    .badge {
      position: absolute; z-index: 2147483645;
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; border-radius: 999px; cursor: pointer;
      background: #12161c; color: #e7ecf2; border: 1px solid #2a3444;
      font: 500 11.5px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 4px 14px rgba(0,0,0,.35);
    }
    .badge .dot { width: 6px; height: 6px }

    .toast {
      position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
      display: flex; align-items: center; gap: 12px;
      padding: 11px 14px; border-radius: 10px;
      background: #12161c; color: #e7ecf2; border: 1px solid #2a3444;
      font: 13px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 12px 32px rgba(0,0,0,.45);
    }
  `;

    function ensure() {
        if (root) return root;
        host = document.createElement('div');
        host.setAttribute('data-ortu', '');
        host.style.cssText = 'all:initial;position:static';
        (document.body || document.documentElement).appendChild(host);
        root = host.attachShadow({ mode: 'closed' });
        const style = document.createElement('style');
        style.textContent = CSS;
        root.appendChild(style);
        return root;
    }

    function el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    function scoreBar(score) {
        const bar = el('span', 'bar');
        const filled = Math.max(1, Math.round((score || 0) * 5));
        for (let i = 0; i < 5; i++) {
            const seg = el('i');
            if (i < filled) seg.className = 'on';
            bar.appendChild(seg);
        }
        return bar;
    }

    // ── Panel ────────────────────────────────────────────────────────────────

    /**
     * @param {{
     *   text:string, findings:Array, settings:Object, labels:Object,
     *   reason:'paste'|'send'|'field',
     *   onConfirm:(kept:Set<number>, settings:Object)=>void,
     *   onRaw?:()=>void, onCancel?:()=>void, onSettings?:(patch:Object)=>void
     * }} opts
     */
    function showPanel(opts) {
        closePanel();
        const r = ensure();
        const labels = opts.labels || {};
        let settings = { ...opts.settings };
        const kept = new Set();   // AÇIK bırakılacak bulgular

        const back = el('div', 'backdrop');
        const panel = el('div', 'panel');
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', 'Örtü kontrolü');

        // Çözme görünümü maskeleme değil, okuma işidir: liste, "maskesiz gönder"
        // ve stil ayarı burada anlamsız, gizleniyor.
        const isDecode = opts.reason === 'decode';

        // Başlık
        const head = el('div', 'head');
        head.append(el('span', 'dot'), el('strong', 'brand', 'Örtü'));
        head.appendChild(el('span', 'why',
            isDecode ? 'çözülmüş metin'
                : opts.reason === 'paste' ? 'yapıştırma kontrolü'
                    : opts.reason === 'field' ? 'alan kontrolü' : 'gönderim kontrolü'));
        const close = el('button', 'x', '✕');
        close.setAttribute('aria-label', 'Kapat');
        close.onclick = () => { closePanel(); opts.onCancel && opts.onCancel(); };
        head.appendChild(close);
        panel.appendChild(head);

        // Özet şerit
        const summary = ortuSummarize(opts.findings, labels);
        const strip = el('div', 'strip');
        strip.appendChild(el('span', 'count', String(summary.total)));
        const types = el('div');
        types.appendChild(el('div', 'types', ortuGroupText(summary.groups, 3)));
        const sub = el('div', 'sub', 'Tümü maskelenecek');
        types.appendChild(sub);
        strip.appendChild(types);
        const bulk = el('div', 'bulk');
        const allMask = el('button', 'link', 'tümünü maskele');
        const allOpen = el('button', 'link', 'tümünü açık bırak');
        bulk.append(allMask, allOpen);
        strip.appendChild(bulk);
        panel.appendChild(strip);
        if (!summary.total) strip.style.display = 'none';

        // Bulgu listesi
        const body = el('div', 'body');
        const rows = new Map();
        for (const item of summary.items) {
            const row = el('div', 'row');
            const cb = el('input');
            cb.type = 'checkbox';
            cb.checked = true;
            cb.setAttribute('aria-label', item.label + ' maskelensin');
            const mid = el('div');
            mid.appendChild(el('div', 'val', item.value));
            const meta = el('div', 'meta');
            meta.appendChild(el('span', null, item.label));
            if (item.score != null) {
                meta.appendChild(scoreBar(item.score));
                meta.appendChild(el('span', null, '%' + Math.round(item.score * 100)));
            }
            const leak = el('span', 'warn', 'açık gidecek');
            leak.style.display = 'none';
            meta.appendChild(leak);
            mid.appendChild(meta);
            row.append(cb, mid, el('span', 'tag', item.entity));
            body.appendChild(row);
            rows.set(item.index, { row, cb, leak });

            cb.onchange = () => {
                if (cb.checked) kept.delete(item.index); else kept.add(item.index);
                row.classList.toggle('open', !cb.checked);
                leak.style.display = cb.checked ? 'none' : '';
                render();
            };
        }
        panel.appendChild(body);
        if (!summary.total) body.style.display = 'none';

        allMask.onclick = () => {
            kept.clear();
            for (const { row, cb, leak } of rows.values()) {
                cb.checked = true; row.classList.remove('open'); leak.style.display = 'none';
            }
            render();
        };
        allOpen.onclick = () => {
            for (const [i, { row, cb, leak }] of rows) {
                kept.add(i); cb.checked = false; row.classList.add('open'); leak.style.display = '';
            }
            render();
        };

        // Gidecek metin — son kontrol
        const preview = el('details', 'preview');
        preview.open = true;
        const sum = el('summary', null,
            isDecode ? 'Çözülmüş metin'
                : opts.reason === 'paste' ? 'Alana girecek metin' : 'Gidecek metin');
        const out = el('div', 'out');
        preview.append(sum, out);
        panel.appendChild(preview);

        // Panel içi ayarlar
        const opts_ = el('div', 'opts');
        opts_.appendChild(el('h4', null, 'Maskeleme stili'));
        const chips = el('div', 'chips');
        for (const [key, def] of Object.entries(ORTU_STYLES)) {
            const chip = el('button', 'chip', def.label);
            chip.setAttribute('aria-pressed', String(settings.style === key));
            chip.onclick = () => {
                settings = { ...settings, style: key };
                for (const c of chips.children) c.setAttribute('aria-pressed', 'false');
                chip.setAttribute('aria-pressed', 'true');
                opts.onSettings && opts.onSettings({ style: key });
                render();
            };
            chips.appendChild(chip);
        }
        opts_.appendChild(chips);
        panel.appendChild(opts_);

        // Alt sıra
        const foot = el('div', 'foot');
        const gear = el('button', 'btn ghost', 'Ayarlar');
        gear.onclick = () => opts_.classList.toggle('show');
        const raw = el('button', 'btn', 'Maskesiz gönder');
        if (opts.reason === 'paste') raw.textContent = 'Olduğu gibi yapıştır';
        raw.onclick = () => { closePanel(); opts.onRaw && opts.onRaw(); };
        const go = el('button', 'btn primary',
            isDecode ? 'Panoya kopyala'
                : opts.reason === 'paste' ? 'Maskele ve yapıştır' : 'Maskele ve gönder');
        go.onclick = () => { closePanel(); opts.onConfirm(kept, settings); };
        if (isDecode) {
            // Çözülmüş metin gerçek veri içerir: panoya yazmak bilinçli bir
            // seçim olmalı, kazara basılan ikinci bir düğme bulunmasın.
            foot.append(el('span', 'spacer'), go);
        } else {
            foot.append(gear, el('span', 'spacer'), raw, go);
        }
        panel.appendChild(foot);

        function render() {
            const masked = ortuMask(opts.text, opts.findings, { style: settings.style, kept, labels });
            out.textContent = masked.text;
            out.classList.toggle('leaky', kept.size > 0);
            sub.textContent = kept.size === 0
                ? 'Tümü maskelenecek'
                : kept.size + ' veri açık gidecek';
            strip.querySelector('.count').style.color = kept.size ? '#ffab5e' : '#5fd3b0';
        }
        render();

        back.appendChild(panel);
        back.onclick = (e) => {
            if (e.target === back) { closePanel(); opts.onCancel && opts.onCancel(); }
        };
        r.appendChild(back);
        panelEl = back;

        escHandler = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                closePanel();
                opts.onCancel && opts.onCancel();
            }
        };
        window.addEventListener('keydown', escHandler, true);
        setTimeout(() => go.focus(), 0);
    }

    function closePanel() {
        if (escHandler) { window.removeEventListener('keydown', escHandler, true); escHandler = null; }
        if (panelEl) { panelEl.remove(); panelEl = null; }
    }

    function isPanelOpen() { return !!panelEl; }

    // ── Rozet ────────────────────────────────────────────────────────────────

    function showBadge(target, text, onClick) {
        hideBadge();
        if (!target || !target.getBoundingClientRect) return;
        const r = ensure();
        const rect = target.getBoundingClientRect();
        const b = el('div', 'badge');
        b.append(el('span', 'dot'), el('span', null, text));
        b.style.position = 'fixed';
        b.style.left = Math.max(8, rect.left) + 'px';
        b.style.top = Math.max(8, rect.top - 30) + 'px';
        // mousedown'ı iptal etmek şart: aksi halde tıklama önce metin alanını
        // bulanıklaştırıyor, content.js blur'da rozeti kaldırıyor ve click hiç
        // ateşlenmiyordu. Rozet görünüyor ama tıklanamıyordu.
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.onclick = () => { hideBadge(); onClick && onClick(); };
        r.appendChild(b);
        badgeEl = b;
    }

    function hideBadge() {
        if (badgeEl) { badgeEl.remove(); badgeEl = null; }
    }

    // ── Bildirim ─────────────────────────────────────────────────────────────

    function toast(message, actionLabel, onAction, ms) {
        const r = ensure();
        if (toastEl) toastEl.remove();
        const t = el('div', 'toast');
        t.append(el('span', null, message));
        if (actionLabel) {
            const a = el('button', 'link', actionLabel);
            a.onclick = () => { t.remove(); toastEl = null; onAction && onAction(); };
            t.appendChild(a);
        }
        r.appendChild(t);
        toastEl = t;
        setTimeout(() => { if (toastEl === t) { t.remove(); toastEl = null; } }, ms || 5000);
    }

    return { showPanel, closePanel, isPanelOpen, showBadge, hideBadge, toast };
})();
