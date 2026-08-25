// Örtü — tespit motoru
//
// Tek genel giriş: ortuDetect(text, options) → findings[]
// Bulgu: { entity, value, start, end, score }
//
// İki katman var:
//   1) biçim katmanı  — patterns.js (TC, IBAN, telefon, e-posta…)
//   2) sözlük katmanı — dictionaries.js (ad, yer, kurum, adres, sağlık)
//
// Katmanlar birbirini görmez; çakışmalar sonda tek yerde çözülür. Böylece yeni
// bir tanıyıcı eklemek başka bir tanıyıcının davranışını değiştirmez.

// Türkçe küçültme. Standart toLowerCase 'I' → 'i' yapar; Türkçede 'ı' olmalı,
// yoksa "ISTANBUL" şehir sözlüğünde bulunamaz.
function ortuLower(s) {
    return String(s).replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
}

function ortuCap(word) {
    return /^[\p{Lu}]/u.test(word);
}

// Metindeki büyük harfle başlayan ardışık sözcük dizilerini çıkarır.
// "Müvekkilim Ada Yılmaz İstanbul'da" → [{text:'Ada Yılmaz', start, end}, {text:'İstanbul', …}]
function ortuCapRuns(text) {
    const runs = [];
    const wordRe = /[\p{Lu}][\p{L}]*(?:['’][\p{L}]+)?/gu;
    let m, cur = null;
    while ((m = wordRe.exec(text)) !== null) {
        const start = m.index;
        // Kesme işaretinden sonrası ek: "İstanbul'da" → çekirdek "İstanbul"
        const core = m[0].replace(/['’][\p{L}]+$/u, '');
        const coreEnd = start + core.length;
        if (cur && text.slice(cur.end, start) === ' ' && cur.words.length < 4) {
            cur.words.push(core);
            cur.spans.push({ start, end: coreEnd });
            cur.end = coreEnd;
        } else {
            cur = { words: [core], spans: [{ start, end: coreEnd }], start, end: coreEnd };
            runs.push(cur);
        }
        // Kesme eki varsa dizi orada biter ("Ali'nin Ahmet" ayrı iki dizi)
        if (core.length !== m[0].length) cur = null;
    }
    return runs.map(r => ({
        text: r.words.join(' '), words: r.words, spans: r.spans, start: r.start, end: r.end,
    }));
}

// Bir konumun solundaki son sözcük ("müvekkilim", "sn") — ad ipucu için.
function ortuPrevWord(text, pos) {
    const before = text.slice(Math.max(0, pos - 40), pos);
    const m = before.match(/([\p{L}]+)[\s.,:]*$/u);
    return m ? ortuLower(m[1]) : '';
}

// ─── Sözlük katmanı ──────────────────────────────────────────────────────────

// Sözlük regexleri BİR KEZ derlenir. Eskiden her çağrıda 81 il + 24 sağlık
// terimi + 14 meslek için ayrı RegExp kuruluyordu; yazarken tarama her 600 ms'de
// bir çalıştığı için bu, uzun metinde gözle görülür takılma demekti.
// Uzun alternatif önce gelmeli, yoksa "kars" kalıbı "kastamonu"yu gölgeleyebilir.
function ortuAlternation(terms) {
    const sorted = [...terms].sort((a, b) => b.length - a.length)
        .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return '(?:' + sorted.join('|') + ')';
}

const ORTU_CITY_RE = new RegExp(
    '(?<![\\p{L}])' + ortuAlternation(ORTU_CITIES) + '(?![\\p{L}])', 'giu');
const ORTU_HEALTH_RE = new RegExp(
    '(?<![\\p{L}])' + ortuAlternation(ORTU_HEALTH_TERMS) + '[\\p{L}]{0,6}(?![\\p{L}])', 'giu');
const ORTU_ORG_RE = new RegExp(ortuAlternation(ORTU_ORG_TAILS), 'gi');
const ORTU_ADDRESS_RE = new RegExp(
    '(?<![\\p{L}])' + ortuAlternation(ORTU_ADDRESS_CUES) + '(?![\\p{L}])', 'giu');

function ortuDetectOrgs(text) {
    const out = [];
    ORTU_ORG_RE.lastIndex = 0;
    let m;
    while ((m = ORTU_ORG_RE.exec(text)) !== null) {
        const tailStart = m.index;
        const end = m.index + m[0].length;
        // Soldaki büyük harfli sözcükleri kuruma kat.
        let start = tailStart;
        const left = text.slice(Math.max(0, tailStart - 60), tailStart);
        const lm = left.match(/((?:[\p{Lu}][\p{L}.]*\s+){1,4})$/u);
        if (lm) start = tailStart - lm[1].length;
        // Boşlukları kırparken indisleri de kaydır: value ile
        // text.slice(start, end) her zaman birebir aynı olmalı, yoksa
        // maskeleme metni yanlış yerden keser. Bir test bu değişmezi denetliyor.
        while (start < end && /\s/.test(text[start])) start++;
        while (end > start && /\s/.test(text[end - 1])) end--;
        const value = text.slice(start, end);
        if (value.length < 4) continue;
        out.push({ entity: 'KURUM', value, start, end, score: 0.85 });
    }
    return out;
}

function ortuDetectAddresses(text) {
    const hits = [];
    ORTU_ADDRESS_RE.lastIndex = 0;
    let m;
    while ((m = ORTU_ADDRESS_RE.exec(text)) !== null) hits.push({ start: m.index, end: m.index + m[0].length });
    if (!hits.length) return [];

    // Birbirine yakın ipuçlarını tek adrese topla.
    const spans = [];
    for (const h of hits) {
        const last = spans[spans.length - 1];
        if (last && h.start - last.end <= 45) last.end = h.end;
        else spans.push({ ...h });
    }

    return spans.map(sp => {
        // Sola: cümle/ibare başına kadar.
        let start = sp.start;
        const leftCut = Math.max(
            text.lastIndexOf('.', sp.start - 1),
            text.lastIndexOf(',', sp.start - 1),
            text.lastIndexOf('\n', sp.start - 1),
            text.lastIndexOf(':', sp.start - 1),
        );
        start = leftCut === -1 ? 0 : leftCut + 1;
        // Sağa: adrese ait kuyruk (No: 5 Kat 2 Düzce) bitene kadar.
        let end = sp.end;
        const tail = text.slice(sp.end, sp.end + 70);
        const tm = tail.match(/^(?:[\s,]*(?:no|kat|daire|d|blok|kapı)?[:.]?\s*\d+[\p{L}]?|[\s,]*[\p{L}]+)*/iu);
        if (tm && tm[0]) {
            // Cümleyi yutma: nokta veya "adresinde/ikamet" gibi kalıpta dur.
            const stop = tm[0].search(/[.;]|adres|ikamet|bulunan/i);
            end = sp.end + (stop === -1 ? tm[0].length : stop);
        }
        // indexOf ile geri aramak yanlıştı: aynı metin daha erken geçiyorsa
        // indisler kayıyor ve maskeleme yanlış yeri kesiyordu. Sınırları
        // doğrudan kaydırıyoruz.
        while (start < end && /[\s,:]/.test(text[start])) start++;
        while (end > start && /[\s,:]/.test(text[end - 1])) end--;
        return { entity: 'ADRES', value: text.slice(start, end), start, end, score: 0.85 };
    }).filter(f => f.value.length >= 8);
}

// Ad, diziden bir yerde başlayabilir: "Müvekkilim Ada Yılmaz" dizisinde ilk
// sözcük cümle başı olduğu için büyük harflidir ama ad değildir. Bu yüzden dizi
// içinde ilk ad ADAYINI arıyoruz, diziyi bütün olarak kabul etmiyoruz.
function ortuDetectNames(text) {
    const out = [];
    for (const run of ortuCapRuns(text)) {
        for (let i = 0; i < run.words.length; i++) {
            const w = ortuLower(run.words[i]);
            const prev = i === 0 ? ortuPrevWord(text, run.start) : ortuLower(run.words[i - 1]);
            const known = ORTU_FIRST_NAMES.has(w);
            const cued = ORTU_NAME_CUES.includes(prev);
            if (!known && !cued) continue;
            if (ORTU_CITIES.has(w)) continue;
            if (ORTU_NAME_CUES.includes(w)) continue;

            // Addan sonraki büyük harfli sözcükler soyadıdır; en çok iki tane.
            let last = i;
            while (last + 1 < run.words.length && last - i < 2) {
                const nxt = ortuLower(run.words[last + 1]);
                if (ORTU_CITIES.has(nxt)) break;
                last++;
            }
            const start = run.spans[i].start;
            const end = run.spans[last].end;
            out.push({
                entity: 'KISI',
                value: text.slice(start, end),
                start,
                end,
                score: known && last > i ? 0.9 : known ? 0.75 : 0.65,
            });
            i = last;
        }
    }
    return out;
}

function ortuDetectPlaces(text) {
    const out = [];
    for (const run of ortuCapRuns(text)) {
        for (let i = 0; i < run.words.length; i++) {
            const w = ortuLower(run.words[i]);
            if (!ORTU_CITIES.has(w)) continue;
            const start = run.spans[i].start;
            out.push({
                entity: 'YER',
                value: run.words[i],
                start,
                end: start + run.words[i].length,
                score: 0.8,
            });
        }
    }
    // Küçük harfle yazılmış şehir adları da geçer ("düzce'de oturuyor").
    ORTU_CITY_RE.lastIndex = 0;
    let m;
    while ((m = ORTU_CITY_RE.exec(text)) !== null) {
        if (out.some(f => f.start === m.index)) continue;
        out.push({ entity: 'YER', value: m[0], start: m.index, end: m.index + m[0].length, score: 0.7 });
    }
    return out;
}

function ortuDetectHealth(text) {
    const out = [];
    ORTU_HEALTH_RE.lastIndex = 0;
    let m;
    while ((m = ORTU_HEALTH_RE.exec(text)) !== null) {
        out.push({ entity: 'SAGLIK', value: m[0], start: m.index, end: m.index + m[0].length, score: 0.75 });
    }
    return out;
}

const ORTU_OCCUPATIONS = [
    'avukat', 'doktor', 'hemşire', 'öğretmen', 'mühendis', 'muhasebeci',
    'polis', 'hakim', 'savcı', 'eczacı', 'mimar', 'şoför', 'öğrenci', 'emekli',
];

const ORTU_OCC_RE = new RegExp(
    '(?<![\\p{L}])' + ortuAlternation(ORTU_OCCUPATIONS) + '[\\p{L}]{0,4}(?![\\p{L}])', 'giu');

function ortuDetectOccupations(text) {
    const out = [];
    ORTU_OCC_RE.lastIndex = 0;
    let m;
    while ((m = ORTU_OCC_RE.exec(text)) !== null) {
        out.push({ entity: 'MESLEK', value: m[0], start: m.index, end: m.index + m[0].length, score: 0.6 });
    }
    return out;
}

// ─── Biçim katmanı ───────────────────────────────────────────────────────────

function ortuDetectPatterns(text) {
    const out = [];
    for (const p of ORTU_PATTERNS) {
        p.re.lastIndex = 0;
        let m;
        while ((m = p.re.exec(text)) !== null) {
            const value = m[0].trim();
            if (!value) continue;
            const start = m.index + m[0].indexOf(value);
            let score = p.score;
            if (p.validate) {
                score = p.validate(value)
                    ? (p.valid != null ? p.valid : p.score)
                    : (p.invalid != null ? p.invalid : 0);
            }
            if (score <= 0) continue;
            out.push({ entity: p.entity, value, start, end: start + value.length, score });
        }
    }
    return out;
}

// ─── Birleştirme ─────────────────────────────────────────────────────────────

// Çakışan bulgulardan tek kazanan seçer: soldan sağa, aynı yerde başlıyorsa
// UZUN olan (adres > içindeki yer adı), eşitse yüksek skorlu.
function ortuResolve(findings) {
    const sorted = [...findings].sort((a, b) =>
        a.start - b.start ||
        (b.end - b.start) - (a.end - a.start) ||
        b.score - a.score);
    const out = [];
    let lastEnd = -1;
    for (const f of sorted) {
        if (f.start >= lastEnd) { out.push(f); lastEnd = f.end; }
    }
    return out;
}

/**
 * @param {string} text
 * @param {{enabled?:Set<string>|string[], threshold?:number}} options
 * @returns {Array<{entity:string,value:string,start:number,end:number,score:number}>}
 */
function ortuDetect(text, options) {
    const o = options || {};
    if (!text) return [];
    const threshold = typeof o.threshold === 'number' ? o.threshold : 0.4;
    const enabled = o.enabled
        ? (o.enabled instanceof Set ? o.enabled : new Set(o.enabled))
        : new Set(ORTU_ALL_ENTITIES);

    const all = [
        ...ortuDetectPatterns(text),
        ...ortuDetectAddresses(text),
        ...ortuDetectOrgs(text),
        ...ortuDetectNames(text),
        ...ortuDetectPlaces(text),
        ...ortuDetectHealth(text),
        ...ortuDetectOccupations(text),
    ].filter(f => enabled.has(f.entity) && f.score >= threshold);

    return ortuResolve(all).map((f, i) => ({ ...f, index: i }));
}

if (typeof module !== 'undefined' && module.exports) {
    Object.assign(globalThis, require('./dictionaries.js'), require('./patterns.js'));
    module.exports = {
        ortuDetect, ortuResolve, ortuLower, ortuCapRuns,
        ortuDetectPatterns, ortuDetectNames, ortuDetectPlaces,
        ortuDetectAddresses, ortuDetectOrgs, ortuDetectHealth,
        ORTU_OCCUPATIONS,
    };
}
