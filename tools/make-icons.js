// Örtü — ikon üretici
//
// Bağımlılık yok: PNG'yi elle kodluyoruz (zlib Node'da hazır). Bir ikon için
// sharp/canvas kurmak, "git clone yeter, build adımı yok" sözünü bozardı.
//
// Çizim: koyu yuvarlak zemin üstünde bir perde/örtü — üstte kapalı bir şerit,
// altta kısmen açılmış iki kanat. Simge küçükken bile ayırt edilebilsin diye
// biçim kaba tutuldu.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'icons');
const SIZES = [16, 32, 48, 128];

const INK = [18, 22, 28];
const MINT = [95, 211, 176];
const DIM = [38, 48, 65];

function crc32(buf) {
    let c, table = [];
    for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    let crc = 0xFFFFFFFF;
    for (const b of buf) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8;    // bit derinliği
    ihdr[9] = 6;    // RGBA
    const raw = Buffer.alloc(size * (size * 4 + 1));
    for (let y = 0; y < size; y++) {
        raw[y * (size * 4 + 1)] = 0;   // filtre: none
        pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
    }
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

function draw(size) {
    const px = Buffer.alloc(size * size * 4);
    const set = (x, y, [r, g, b], a = 255) => {
        if (x < 0 || y < 0 || x >= size || y >= size) return;
        const i = (y * size + x) * 4;
        px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
    };
    const c = (size - 1) / 2;
    const rad = size * 0.48;
    const railY = size * 0.24;
    const railH = Math.max(1, size * 0.09);

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const d = Math.hypot(x - c, y - c);
            if (d > rad) continue;                       // yuvarlak zeminin dışı şeffaf
            set(x, y, INK);

            // Askı çubuğu
            if (y >= railY && y < railY + railH && Math.abs(x - c) < rad * 0.78) {
                set(x, y, MINT);
                continue;
            }
            if (y < railY + railH) continue;

            // İki kanat: ortaya doğru açılan bir aralık bırakırlar
            const t = (y - railY - railH) / (size - railY - railH);   // 0 üst, 1 alt
            const gap = size * (0.03 + 0.16 * t);
            const dx = x - c;
            if (Math.abs(dx) < gap) continue;                          // aradaki boşluk
            if (Math.abs(dx) > rad * 0.82) continue;
            // Kanat kıvrımı: dikey şeritler
            const band = Math.floor((Math.abs(dx) - gap) / Math.max(1, size * 0.07)) % 2;
            set(x, y, band ? MINT : DIM);
        }
    }
    return px;
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
    const file = path.join(OUT, `icon${size}.png`);
    fs.writeFileSync(file, png(size, draw(size)));
    console.log('yazıldı', path.relative(process.cwd(), file));
}
