// Örtü — token üretimi ve geri çözme
//
// Token stili tek geri çevrilebilir stildir: [KISI_1] gibi bir yer tutucu üretir
// ve token → gerçek değer haritası ayrı döner. Yapay zekânın cevabındaki
// token'lar bu haritayla gerçek değerlere döndürülür; veri hiç dışarı çıkmadan
// cevap okunur kalır.
//
// Aynı değer metinde birden çok geçiyorsa aynı token'ı alır — yoksa yapay zekâ
// iki ayrı kişi olduğunu sanır ve cevap bozulur.

// Token adı ASCII olmalı: bazı modeller Türkçe karakterli yer tutucuyu
// bölüyor ve cevapta parçalanmış halde geri veriyor.
function ortuAsciiKey(entity) {
    return String(entity)
        .replace(/İ/g, 'I').replace(/ı/g, 'i')
        .replace(/Ş/g, 'S').replace(/ş/g, 's')
        .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
        .replace(/Ü/g, 'U').replace(/ü/g, 'u')
        .replace(/Ö/g, 'O').replace(/ö/g, 'o')
        .replace(/Ç/g, 'C').replace(/ç/g, 'c')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_');
}

/**
 * Metni token'larla maskeler.
 * @param {string} text
 * @param {Array} findings  ortuDetect çıktısı
 * @param {(index:number)=>boolean} isKept  açık bırakılacak bulgular
 * @returns {{text:string, map:Map<string,string>}}
 */
function ortuTokenize(text, findings, isKept) {
    const counters = new Map();   // entity → son numara
    const seen = new Map();       // entity|değer → token
    const map = new Map();        // token → gerçek değer
    const keep = typeof isKept === 'function' ? isKept : () => false;

    let out = '', pos = 0;
    for (const f of findings) {
        if (f.start < pos) continue;
        out += text.slice(pos, f.start);
        if (keep(f.index, f.entity)) {
            out += text.slice(f.start, f.end);
        } else {
            const key = ortuAsciiKey(f.entity);
            const seenKey = key + '|' + f.value;
            let token = seen.get(seenKey);
            if (!token) {
                const n = (counters.get(key) || 0) + 1;
                counters.set(key, n);
                token = '[' + key + '_' + n + ']';
                seen.set(seenKey, token);
                map.set(token, f.value);
            }
            out += token;
        }
        pos = f.end;
    }
    out += text.slice(pos);
    return { text: out, map };
}

/**
 * Token'ları gerçek değerlere geri çevirir.
 * Uzun token'lar önce değiştirilir ki [KISI_1] ile [KISI_11] karışmasın.
 */
function ortuDecode(text, map) {
    if (!text || !map) return text || '';
    const entries = map instanceof Map ? [...map.entries()] : Object.entries(map);
    entries.sort((a, b) => b[0].length - a[0].length);
    let out = String(text);
    for (const [token, value] of entries) {
        out = out.split(token).join(value);
    }
    return out;
}

// Metinde çözülebilecek token var mı? (sağ tık menüsünü boş yere çalıştırmamak için)
function ortuHasTokens(text) {
    return /\[[A-Z0-9_]+_\d+\]/.test(String(text || ''));
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ortuTokenize, ortuDecode, ortuAsciiKey, ortuHasTokens };
}
