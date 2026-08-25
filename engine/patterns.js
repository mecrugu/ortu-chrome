// Örtü — biçimden tanınan veriler
//
// Buradaki her tanıyıcı bir regex + isteğe bağlı bir doğrulayıcıdan oluşur.
// Doğrulayıcı skoru belirler; üç ayrı değer var:
//
//   score    doğrulayıcısı olmayan tanıyıcının sabit skoru
//   valid    sağlama tuttuğunda
//   invalid  sağlama TUTMADIĞINDA
//
// `invalid` bilinçli olarak tür tür ayarlanıyor. TC/IBAN/kart biçimindeki bir
// dizi, sağlaması tutmasa bile büyük olasılıkla hassastır (yazım hatası, elle
// değiştirilmiş örnek, farklı ülke formatı) — bunlar varsayılan eşiğin ÜSTÜNDE
// kalır, panelde düşük güven çubuğuyla görünür ve kullanıcı isterse işareti
// kaldırır. Vergi numarası ve IP ise tutmadığında düşürülür: 10 haneli sayı ve
// nokta ayraçlı sayı günlük metinde sipariş/sürüm numarası olarak sürekli
// geçiyor ve her birini panele koymak, paneli okunmaz hale getiriyordu.
//
// Yön şu: bir gizlilik aracında yanlış negatif, yanlış pozitiften pahalıdır —
// ama panel gürültüden okunmaz hale gelirse kullanıcı hepsini onaylamayı
// öğrenir ve bu da bir yanlış negatif üretir.

function ortuOnlyDigits(s) {
    return String(s).replace(/\D/g, '');
}

// TC kimlik: 11 hane, ilk hane 0 değil, son iki hane sağlama.
function ortuValidTC(raw) {
    const d = ortuOnlyDigits(raw);
    if (d.length !== 11 || d[0] === '0') return false;
    const n = [...d].map(Number);
    const odd = n[0] + n[2] + n[4] + n[6] + n[8];
    const even = n[1] + n[3] + n[5] + n[7];
    const d10 = (odd * 7 - even) % 10;
    if (d10 < 0 ? d10 + 10 !== n[9] : d10 !== n[9]) return false;
    const sum10 = n.slice(0, 10).reduce((a, b) => a + b, 0);
    return sum10 % 10 === n[10];
}

// IBAN: mod-97 = 1. TR IBAN'ı 26 karakter.
function ortuValidIBAN(raw) {
    const s = String(raw).replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
    const moved = s.slice(4) + s.slice(0, 4);
    let rem = 0;
    for (const ch of moved) {
        const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
        for (const digit of v) rem = (rem * 10 + Number(digit)) % 97;
    }
    return rem === 1;
}

// Kart numarası: Luhn.
function ortuValidLuhn(raw) {
    const d = ortuOnlyDigits(raw);
    if (d.length < 13 || d.length > 19) return false;
    let sum = 0, alt = false;
    for (let i = d.length - 1; i >= 0; i--) {
        let n = Number(d[i]);
        if (alt) { n *= 2; if (n > 9) n -= 9; }
        sum += n;
        alt = !alt;
    }
    return sum % 10 === 0;
}

// Vergi kimlik numarası: 10 hane, GİB sağlaması.
function ortuValidVergiNo(raw) {
    const d = ortuOnlyDigits(raw);
    if (d.length !== 10) return false;
    let total = 0;
    for (let i = 0; i < 9; i++) {
        const tmp = (Number(d[i]) + (9 - i)) % 10;
        if (tmp === 0) continue;
        total += (tmp * Math.pow(2, 9 - i)) % 9 || 9;
    }
    return (10 - (total % 10)) % 10 === Number(d[9]);
}

function ortuValidIPv4(raw) {
    const parts = String(raw).split('.');
    return parts.length === 4 && parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

// Sıra önemli: yukarıdakiler önce denenir, çakışan aday soldan sağa ve yüksek
// skorluya göre çözülür (detect.js).
const ORTU_PATTERNS = [
    {
        entity: 'EPOSTA',
        re: /\b[\p{L}0-9._%+-]+@[\p{L}0-9.-]+\.[\p{L}]{2,}\b/gu,
        score: 0.98,
    },
    {
        entity: 'IBAN',
        re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g,
        score: 0.55,
        validate: ortuValidIBAN,
        valid: 1.0,
        invalid: 0.5,
    },
    {
        entity: 'KREDI_KARTI',
        re: /\b(?:\d[ -]?){12,18}\d\b/g,
        score: 0.35,
        validate: ortuValidLuhn,
        valid: 0.9,
        invalid: 0.5,
    },
    {
        entity: 'TC_KIMLIK',
        re: /\b[1-9]\d{10}\b/g,
        score: 0.5,
        validate: ortuValidTC,
        valid: 0.95,
        invalid: 0.5,
    },
    {
        entity: 'TELEFON',
        // 0532 123 45 67 · +90 532 123 45 67 · (0212) 555 44 33
        // (?<![\d+]) ve (?!\d) şart: bu kalıp bunlar olmadan 16 haneli bir kart
        // numarasının İÇİNDE eşleşiyor ve numarayı "telefon" diye etiketliyordu.
        re: /(?<![\d+])(?:\+90|0090|0)?[ .-]?\(?(?:5\d{2}|2\d{2}|3\d{2}|4\d{2})\)?[ .-]?\d{3}[ .-]?\d{2}[ .-]?\d{2}(?!\d)/g,
        score: 0.8,
        validate: (v) => {
            const d = ortuOnlyDigits(v);
            return d.length >= 10 && d.length <= 12;
        },
        valid: 0.9,
        invalid: 0,
    },
    {
        entity: 'VERGI_NO',
        re: /\b\d{10}\b/g,
        score: 0.3,
        validate: ortuValidVergiNo,
        valid: 0.85,
        invalid: 0,
    },
    {
        entity: 'PASAPORT',
        re: /\b[A-Z]\d{8}\b/g,
        score: 0.65,
    },
    {
        entity: 'PLAKA',
        re: /\b(?:0[1-9]|[1-7]\d|8[01])[ ]?[A-Z]{1,3}[ ]?\d{2,5}\b/g,
        score: 0.7,
    },
    {
        entity: 'MAC_ADRESI',
        re: /\b(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b/g,
        score: 0.95,
    },
    {
        entity: 'IP_ADRESI',
        re: /\b\d{1,3}(?:\.\d{1,3}){3}\b/g,
        score: 0.4,
        validate: ortuValidIPv4,
        valid: 0.9,
        invalid: 0,
    },
    {
        entity: 'DOSYA_NO',
        // 2024/1234 E. · 2019/123 K.
        re: /\b(?:19|20)\d{2}\/\d{1,6}(?:\s?[EK]\.)?/g,
        score: 0.75,
    },
    {
        entity: 'URL',
        re: /\bhttps?:\/\/[^\s<>"']+/g,
        score: 0.9,
    },
    {
        entity: 'TARIH',
        re: /\b\d{1,2}[./-]\d{1,2}[./-](?:19|20)\d{2}\b/g,
        score: 0.85,
    },
    {
        entity: 'TUTAR',
        re: /\b\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?\s?(?:TL|₺|USD|EUR|\$|€)\b/gi,
        score: 0.8,
    },
    {
        entity: 'YAS',
        re: /\b\d{1,3}\s?yaşında\b/gi,
        score: 0.7,
    },
];

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ORTU_PATTERNS, ortuValidTC, ortuValidIBAN, ortuValidLuhn,
        ortuValidVergiNo, ortuValidIPv4, ortuOnlyDigits,
    };
}
