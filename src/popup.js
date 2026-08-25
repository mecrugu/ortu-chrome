// Örtü — popup
//
// İki iş: ayarları değiştirmek ve "Dene" alanı.
//
// Dene alanı sadece bir oyuncak değil: "neden maskelemedi?" sorusunun tek
// dürüst cevabı. Kullanıcı mevcut ayarlarıyla ne yakalandığını görür ve daha
// geniş bir kapsamın ne EKLEYECEĞİNİ ayrıca okur — kapsamı büyütmeden önce
// bedelini bilir.

const $ = (id) => document.getElementById(id);

const ORNEK = 'Müvekkilim Ada Yılmaz (TC 10000000146), Örnek Mahallesi Çınar Sokak No: 5 ' +
    'Düzce adresinde ikamet ediyor. IBAN TR330006100519786457841326, tel 0532 123 45 67, ' +
    'e-posta ada.yilmaz@ornek.com. 2024/1234 E. sayılı dosya için 45.000 TL talep ediyoruz.';

let settings = { ...ORTU_DEFAULTS };
let host = '';

init();

async function init() {
    const res = await chrome.storage.local.get(['settings', 'maskedTotal']);
    settings = ortuMigrate(res.settings);
    $('total').textContent = (res.maskedTotal || 0) + ' veri maskelendi';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    host = ortuHostOf(tab && tab.url);
    $('siteName').textContent = host || '—';
    $('siteOn').disabled = !host;

    buildSegments();
    paint();
    // Eskiden çağrılmıyordu ve "bu siteyi ekle" satırı hiç görünmüyordu:
    // allowlist dışındaki sitelerde eklentiyi açmanın yolu yoktu.
    refreshAddRow();

    $('enabled').onchange = () => save({ enabled: $('enabled').checked });
    $('typingHints').onchange = () => save({ typingHints: $('typingHints').checked });
    $('siteOn').onchange = () => {
        if (!host) return;
        save({ perSite: { ...settings.perSite, [host]: $('siteOn').checked } });
    };

    $('try').addEventListener('input', runTry);
    $('fill').onclick = () => { $('try').value = ORNEK; runTry(); };
    $('clearTry').onclick = () => { $('try').value = ''; runTry(); };
    $('addSite').onclick = addCurrentSite;
    // Sayaç arka planda artıyor; popup açıkken de güncel kalsın.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.maskedTotal) {
            $('total').textContent = (changes.maskedTotal.newValue || 0) + ' veri maskelendi';
        }
    });

    $('clearMaps').onclick = () => {
        chrome.runtime.sendMessage({ type: 'ortu:clear-maps' }, () => {
            $('clearMaps').textContent = 'Silindi';
            setTimeout(() => { $('clearMaps').textContent = 'Token haritasını sil'; }, 1500);
        });
    };
}

// ─── Ek site ─────────────────────────────────────────────────────────────────
//
// Manifest'te bilerek <all_urls> istenmiyor. Başka bir siteye ihtiyacı olan
// kullanıcı izni burada, tıklama anında verir; content script o origin için
// dinamik kaydedilir. İzin verilmezse hiçbir şey değişmez.

async function isCovered(h) {
    if (!h) return true;
    const list = chrome.runtime.getManifest().host_permissions || [];
    if (list.some(p => p.includes('://' + h + '/') || p.includes('://*.' + h + '/'))) return true;
    const { extraSites = [] } = await chrome.storage.local.get('extraSites');
    return extraSites.includes(h);
}

async function addCurrentSite() {
    if (!host) return;
    const origin = 'https://*.' + host + '/*';
    const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
    if (!granted) {
        $('addSite').textContent = 'İzin verilmedi';
        setTimeout(refreshAddRow, 1800);
        return;
    }
    const { extraSites = [] } = await chrome.storage.local.get('extraSites');
    if (!extraSites.includes(host)) {
        await chrome.storage.local.set({ extraSites: [...extraSites, host] });
    }
    chrome.runtime.sendMessage({ type: 'ortu:register-sites' }, () => {
        $('addSite').textContent = 'Eklendi. Sayfayı yenile';
    });
}

async function refreshAddRow() {
    const covered = await isCovered(host);
    $('addRow').hidden = covered;
    $('addSite').textContent = 'Bu siteyi ekle (izin ister)';
}

function buildSegments() {
    segment('sendMode', ORTU_SEND_MODES, 'sendHint');
    segment('pasteMode', ORTU_PASTE_MODES, 'pasteHint');
    segment('profile', ORTU_PROFILES, 'profileHint');
    segment('style', ORTU_STYLES, 'styleHint');
}

function segment(field, defs, hintId) {
    const box = $(field);
    box.innerHTML = '';
    for (const [key, def] of Object.entries(defs)) {
        const b = document.createElement('button');
        b.textContent = def.label;
        b.dataset.key = key;
        b.onclick = () => save({ [field]: key });
        box.appendChild(b);
    }
    box._hint = hintId;
    box._defs = defs;
}

function paint() {
    $('enabled').checked = settings.enabled;
    $('typingHints').checked = settings.typingHints;
    $('siteOn').checked = host ? ortuSiteEnabled({ ...settings, enabled: true }, host) : false;

    for (const field of ['sendMode', 'pasteMode', 'profile', 'style']) {
        const box = $(field);
        for (const b of box.children) {
            b.setAttribute('aria-pressed', String(b.dataset.key === settings[field]));
        }
        const def = box._defs[settings[field]];
        $(box._hint).textContent = def ? def.hint : '';
    }

    const st = ortuProtectionSummary(settings);
    $('status').textContent = st.text;
    $('status').className = st.level === 'kapali' ? 'kapali' : '';
    $('dot').className = 'dot' + (st.level === 'kapali' ? ' off' : '');

    runTry();
}

async function save(patch) {
    settings = ortuMigrate({ ...settings, ...patch });
    await chrome.storage.local.set({ settings });
    paint();
}

// ─── Dene ────────────────────────────────────────────────────────────────────

function runTry() {
    const text = $('try').value;
    const found = $('found'), out = $('out'), wider = $('wider');
    found.innerHTML = ''; out.textContent = ''; wider.textContent = '';
    if (!text.trim()) return;

    const enabled = ortuResolveEntities(settings, ORTU_ALL_ENTITIES);
    const findings = ortuDetect(text, { enabled, threshold: settings.threshold });

    if (!findings.length) {
        found.appendChild(chip('Bu ayarlarla hiçbir şey yakalanmadı'));
    } else {
        const s = ortuSummarize(findings, ORTU_LABELS);
        for (const g of s.groups) found.appendChild(chip((g.count > 1 ? g.count + ' ' : '') + g.label));
        out.textContent = ortuMask(text, findings, { style: settings.style, labels: ORTU_LABELS }).text;
    }

    // Daha geniş kapsam ne eklerdi?
    if (settings.profile !== 'tumu') {
        const all = ortuDetect(text, { enabled: new Set(ORTU_ALL_ENTITIES), threshold: settings.threshold });
        const have = new Set(findings.map(f => f.start + ':' + f.entity));
        const extra = all.filter(f => !have.has(f.start + ':' + f.entity));
        if (extra.length) {
            const labels = [...new Set(extra.map(f => ORTU_LABELS[f.entity] || f.entity))];
            wider.textContent = 'Tümü kapsamı şunları da maskelerdi: ' + labels.join(', ');
        }
    }
}

function chip(text) {
    const c = document.createElement('span');
    c.className = 'chip';
    c.textContent = text;
    return c;
}
