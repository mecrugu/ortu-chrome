// Örtü — saf karar mantığı
//
// "Ne maskelenecek, ne maskelenmeyecek" kararları burada. DOM'a ve chrome.*
// API'lerine dokunmaz; content.js, popup.js ve background.js bunu çağırır,
// test.js doğrudan node içinde yükler. DOM'suz olması testin ucuz olmasını
// sağlıyor ve bu dosya eklentinin en çok test edilen yeri.

// ─── Profiller ───────────────────────────────────────────────────────────────
//
// Kapsam ARTAN sırada: dar ⊂ dengeli ⊂ tumu.
// Profil adı kapsamı dürüst anlatmalı. "Güvenli" gibi bir ad en dar profile
// verilirse kullanıcı en korumalı seçeneği seçtiğini sanır; oysa isim ve adres
// maskelenmiyordur. Bir gizlilik aracında ad, korumayı olduğundan geniş
// göstermemeli.

// Genel metinde sürekli tetiklenen, tek başına kimseyi işaret etmeyen türler.
const ORTU_LOW_SIGNAL = ['URL', 'TARIH'];

// Zayıf niteleyiciler: tek başlarına kimliklendirici değil ama günlük metinde
// her cümlede geçiyorlar ("avukat", "35 yaşında", "45.000 TL").
const ORTU_WEAK_ATTRS = ['YAS', 'MESLEK', 'TUTAR'];

// Biçiminden tanınan, tartışmasız kimliklendiriciler. İsim/yer/kurum burada YOK.
const ORTU_HARD_IDS = [
    'TC_KIMLIK', 'VERGI_NO', 'PASAPORT', 'TELEFON', 'EPOSTA',
    'IBAN', 'KREDI_KARTI', 'PLAKA', 'IP_ADRESI', 'MAC_ADRESI',
];

const ORTU_PROFILES = {
    dar: {
        label: 'Dar',
        short: 'yalnızca numaralar',
        hint: 'Yalnızca biçiminden tanınan kesin kimliklendiriciler: TC, IBAN, telefon, ' +
              'e-posta, kart, pasaport, plaka, IP. İsim, adres ve kurum MASKELENMEZ.',
        include: ORTU_HARD_IDS,
    },
    dengeli: {
        label: 'Dengeli',
        short: 'önerilen',
        hint: 'Dar profildeki her şey, ayrıca kişi adı, kurum, yer, adres, sağlık verisi ' +
              've dosya numarası. Bağlantı, tarih, tutar, yaş ve meslek kapsam dışı.',
        exclude: ORTU_LOW_SIGNAL.concat(ORTU_WEAK_ATTRS),
    },
    tumu: {
        label: 'Tümü',
        short: 'en geniş',
        hint: 'Motorun bildiği bütün türler. Bağlantı, tarih, tutar, meslek ve yaş dahil. ' +
              'En kapsamlı ama en çok yanlış alarm veren seçenek.',
        exclude: [],
    },
};

// Eski kayıtları güncel profil adlarına taşır. Yön her zaman GENİŞ tarafa:
// kullanıcıyı sessizce daha dar bir korumada bırakmak, gereğinden geniş
// maskelemekten kötü.
const ORTU_PROFILE_ALIASES = {
    guvenli: 'dengeli',
    minimum: 'dar',
    hepsi: 'tumu',
};

// ─── Koruma kapıları ─────────────────────────────────────────────────────────
//
// Verinin dışarı çıkabileceği iki an var, ikisi ayrı ayrı ayarlanır:
//   1) YAPIŞTIRMA — metin panodan alana giriyor.
//   2) GÖNDERİM   — Enter'a basılıyor / gönder düğmesine tıklanıyor.
//
// Gönderim kapısı daha önemli: elle yazılan veri yalnızca oradan geçer ve veri
// tam o an gerçekten dışarı çıkar. Yazarken metni anında yeniden yazmak
// (imleci kaydırır, ProseMirror/Lexical durumunu bozar) yerine gönderim anında
// durdurmak hem daha güvenli hem daha az müdahaleci.

const ORTU_PASTE_MODES = {
    sor: { label: 'Önce sor', hint: 'Yapıştırma durur, ne maskeleneceğini görüp onaylarsın.' },
    sessiz: { label: 'Sessiz maskele', hint: 'Sormadan maskeler; köşede kısa bir bildirim ve "geri al" çıkar.' },
    kapali: { label: 'Kapalı', hint: 'Yapıştırmaya karışılmaz. Gönderim koruması açıksa son anda yine yakalanır.' },
};

const ORTU_SEND_MODES = {
    sor: { label: 'Önce sor', hint: 'Gönderim durur, panelde onaylarsın. En güvenli seçenek.' },
    otomatik: { label: 'Otomatik maskele', hint: 'Sormadan maskeler ve gönderir. Akıcı ama gideni önceden görmezsin.' },
    kapali: { label: 'Kapalı', hint: 'Gönderime karışılmaz. Elle yazdığın veri denetlenmeden gider.' },
};

const ORTU_STYLES = {
    token: { label: '[KISI_1]', hint: 'Geri çevrilebilir. Cevaptaki token\'ları gerçek değere döndürebilirsin.' },
    etiket: { label: '<Kişi>', hint: 'Okunaklı ama geri çevrilemez.' },
    yildiz: { label: '****', hint: 'En sade. Yapay zeka orada bir veri olduğunu anlar, türünü bilmez.' },
};

const ORTU_DEFAULTS = {
    enabled: true,
    profile: 'dengeli',
    pasteMode: 'sor',
    sendMode: 'sor',
    style: 'token',
    threshold: 0.4,
    // Kısa metinde boşuna çalışmamak için alt sınır. Bu bir GÜVENLİK eşiği
    // DEĞİL: motorun tek başına yakalayabildiği en kısa kimliklendiriciye eşit
    // tutulur (bugün 6 — "a@b.co"). Daha yükseğe çekmek doğrudan sızıntı demek.
    minLength: 6,
    typingHints: true,
    disabledEntities: [],
    perSite: {},
};

function ortuMigrate(settings) {
    const s = { ...ORTU_DEFAULTS, ...(settings || {}) };
    const alias = ORTU_PROFILE_ALIASES[s.profile];
    if (alias) s.profile = alias;
    if (!ORTU_PROFILES[s.profile]) s.profile = ORTU_DEFAULTS.profile;

    // Eskiden tek "mode" alanı vardı ve yalnızca yapıştırmayı kapsıyordu.
    if (s.mode && !settings?.pasteMode) s.pasteMode = s.mode;
    delete s.mode;

    if (!ORTU_PASTE_MODES[s.pasteMode]) s.pasteMode = ORTU_DEFAULTS.pasteMode;
    // Gönderim kapısı sonradan eklendi: eski kurulumda tanımsız olur ve en
    // güvenli değerle açılır. Sessizce kapalı kalmamalı.
    if (!ORTU_SEND_MODES[s.sendMode]) s.sendMode = ORTU_DEFAULTS.sendMode;
    if (!ORTU_STYLES[s.style]) s.style = ORTU_DEFAULTS.style;
    if (typeof s.threshold !== 'number' || s.threshold < 0 || s.threshold > 1) {
        s.threshold = ORTU_DEFAULTS.threshold;
    }
    if (typeof s.minLength !== 'number' || s.minLength < 0) s.minLength = ORTU_DEFAULTS.minLength;
    if (!Array.isArray(s.disabledEntities)) s.disabledEntities = [];
    else s.disabledEntities = [...s.disabledEntities];
    if (!s.perSite || typeof s.perSite !== 'object') s.perSite = {};
    else s.perSite = { ...s.perSite };
    // Kopyalamak şart: ORTU_DEFAULTS sığ yayıldığı için, kopyalanmazsa ayarı
    // olmayan her kullanıcı AYNI perSite nesnesini paylaşır ve bir sitede
    // yapılan kapatma her yere sızar.
    return s;
}

// Tek satırda "şu an ne kadar korunuyorum" özeti. İki kapı da kapalıysa bunu
// açıkça söylemek gerekiyor; kullanıcı korunduğunu sanmamalı.
function ortuProtectionSummary(settings) {
    const s = ortuMigrate(settings);
    if (!s.enabled) return { level: 'kapali', text: 'Örtü kapalı' };
    const paste = s.pasteMode !== 'kapali';
    const send = s.sendMode !== 'kapali';
    if (!paste && !send) return { level: 'kapali', text: 'İki koruma da kapalı. Hiçbir şey denetlenmiyor' };
    if (paste && send) {
        return {
            level: 'tam',
            text: s.sendMode === 'otomatik'
                ? 'Yapıştırma ve gönderim korunuyor (gönderim otomatik)'
                : 'Yapıştırma ve gönderim korunuyor',
        };
    }
    if (send) return { level: 'kismi', text: 'Yalnızca gönderim korunuyor' };
    return { level: 'kismi', text: 'Yalnızca yapıştırma korunuyor. Elle yazdığın veri denetlenmiyor' };
}

// Profil + kullanıcının kapattığı türlerden nihai açık tür kümesi.
function ortuResolveEntities(settings, allEntities) {
    const s = ortuMigrate(settings);
    const all = allEntities || (typeof ORTU_ALL_ENTITIES !== 'undefined' ? ORTU_ALL_ENTITIES : []);
    const profile = ORTU_PROFILES[s.profile];
    const disabled = new Set(s.disabledEntities);
    const out = new Set();
    if (profile.include) {
        const allow = new Set(profile.include);
        for (const e of all) if (allow.has(e) && !disabled.has(e)) out.add(e);
        return out;
    }
    const excluded = new Set(profile.exclude);
    for (const e of all) if (!excluded.has(e) && !disabled.has(e)) out.add(e);
    return out;
}

// ─── Site kapsamı ────────────────────────────────────────────────────────────

function ortuHostOf(url) {
    try {
        return String(new URL(url).hostname).replace(/^www\./, '').toLowerCase();
    } catch (_) {
        return '';
    }
}

function ortuSiteEnabled(settings, host) {
    if (!settings || !settings.enabled) return false;
    const per = settings.perSite || {};
    const h = String(host || '').replace(/^www\./, '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(per, h)) return per[h] !== false;
    // Üst alan adı kaydı miras alınır: "google.com" kapalıysa
    // "gemini.google.com" da kapalı.
    const parts = h.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
        const parent = parts.slice(i).join('.');
        if (Object.prototype.hasOwnProperty.call(per, parent)) return per[parent] !== false;
    }
    return true;
}

// ─── Bulgu seçimi ────────────────────────────────────────────────────────────

// Metne karışmaya değer mi? Çok kısa metinde ve bulgu yoksa karışılmaz.
function ortuShouldIntercept(text, findings, settings) {
    const s = ortuMigrate(settings);
    if (!text || text.length < s.minLength) return false;
    return (findings || []).length > 0;
}

// Panel için: her bulgu tek tek listelenir, ayrıca tür bazında özet çıkarılır.
function ortuSummarize(findings, labels) {
    const L = labels || (typeof ORTU_LABELS !== 'undefined' ? ORTU_LABELS : {});
    const items = (findings || []).map((f, i) => ({
        index: typeof f.index === 'number' ? f.index : i,
        entity: f.entity,
        label: L[f.entity] || f.entity,
        value: f.value,
        score: typeof f.score === 'number' ? f.score : null,
        start: f.start,
        end: f.end,
    }));
    const counts = new Map();
    for (const it of items) counts.set(it.label, (counts.get(it.label) || 0) + 1);
    const groups = [...counts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'tr'));
    return { items, groups, total: items.length };
}

// "3 Kişi, TC Kimlik, IBAN +2"
function ortuGroupText(groups, limit) {
    const max = limit || 3;
    const shown = (groups || []).slice(0, max).map(g => (g.count > 1 ? g.count + ' ' : '') + g.label);
    const rest = (groups || []).length - shown.length;
    return shown.join(', ') + (rest > 0 ? ' +' + rest : '');
}

// ─── Maskeleme ───────────────────────────────────────────────────────────────

function ortuStarMask(value) {
    const len = [...String(value)].length;
    if (len <= 4) return '*'.repeat(Math.max(3, len));
    return '*'.repeat(Math.min(len, 12));
}

/**
 * Seçili stile göre metni maskeler.
 * @param {string} text
 * @param {Array} findings
 * @param {{style?:string, kept?:Set<number>|number[], labels?:Object}} opts
 * @returns {{text:string, map:Map<string,string>}}  map yalnızca token stilinde dolu
 */
function ortuMask(text, findings, opts) {
    const o = opts || {};
    const style = ORTU_STYLES[o.style] ? o.style : 'token';
    const kept = o.kept instanceof Set ? o.kept : new Set(o.kept || []);
    const isKept = (i) => kept.has(i);

    if (style === 'token') {
        // Token üretimi motorda: numaralandırma ve geri çözme tek yerde kalsın.
        return ortuTokenize(text, findings, isKept);
    }

    const L = o.labels || (typeof ORTU_LABELS !== 'undefined' ? ORTU_LABELS : {});
    let out = '', pos = 0;
    for (const f of findings) {
        if (f.start < pos) continue;
        out += text.slice(pos, f.start);
        const idx = typeof f.index === 'number' ? f.index : -1;
        if (isKept(idx)) out += text.slice(f.start, f.end);
        else if (style === 'yildiz') out += ortuStarMask(f.value);
        else out += '<' + (L[f.entity] || f.entity) + '>';
        pos = f.end;
    }
    out += text.slice(pos);
    return { text: out, map: new Map() };
}

if (typeof module !== 'undefined' && module.exports) {
    Object.assign(globalThis,
        require('../engine/dictionaries.js'),
        require('../engine/tokenize.js'));
    module.exports = {
        ORTU_PROFILES, ORTU_DEFAULTS, ORTU_LOW_SIGNAL, ORTU_WEAK_ATTRS,
        ORTU_HARD_IDS, ORTU_PROFILE_ALIASES, ORTU_PASTE_MODES, ORTU_SEND_MODES,
        ORTU_STYLES, ortuMigrate, ortuProtectionSummary, ortuResolveEntities,
        ortuHostOf, ortuSiteEnabled, ortuShouldIntercept, ortuSummarize,
        ortuGroupText, ortuMask, ortuStarMask,
    };
}
