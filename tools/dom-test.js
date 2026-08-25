// Örtü — DOM testleri:  npm run test:dom   (jsdom gerektirir)
//
// test.js saf mantığı kapsıyor; burası DOM katmanı: gönderim koruması,
// yapıştırma koruması, panel akışı, rozet ve sızıntı denetimi.
//
// Neden ayrı? jsdom bir bağımlılık ve `npm test` bağımlılıksız kalmalı.
// Kurmak isteyen:  npm i -D jsdom && npm run test:dom
//
// Uyarı: jsdom gerçek Chromium değil. Olay sırası, capture fazı ve
// contenteditable davranışı burada doğrulanır ama execCommand'ın React
// üzerindeki etkisi doğrulanamaz — o katman hâlâ elle deneniyor.

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

let JSDOM;
try {
    ({ JSDOM } = require('jsdom'));
} catch (err) {
    // Eskiden her hata "kurulu değil" diye raporlanıyordu. jsdom kurulu ama
    // Node sürümü yetersizse (jsdom 30 için Node 22+ gerekiyor) bu mesaj
    // yanlış yere baktırıyor: paket kurulu, yüklenirken patlıyor.
    if (err && err.code === 'MODULE_NOT_FOUND') {
        console.error('jsdom kurulu değil.  npm i -D jsdom  komutunu çalıştır.');
    } else {
        console.error('jsdom yüklenemedi (Node ' + process.version +
            '). jsdom 30 için Node 22 veya üstü gerekiyor.');
        console.error(err && err.message);
    }
    process.exit(1);
}
const ROOT = __dirname.replace(/tools$/, '');
const FILES = [
    'engine/dictionaries.js', 'engine/patterns.js', 'engine/detect.js',
    'engine/tokenize.js', 'src/policy.js', 'src/ui.js', 'src/content.js',
];
const SOURCE = FILES.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');

const KIRLI = 'Müvekkilim Ada Yılmaz, TC 10000000146, tel 0532 123 45 67, ' +
    'IBAN TR330006100519786457841326, ada.yilmaz@ornek.com';
const TEMIZ = 'bugün hava çok güzel, parkta biraz yürüdük';

// Sızıntı denetiminde tek tek aranacak gerçek değerler.
const SIRLAR = ['Ada Yılmaz', '10000000146', '0532 123 45 67',
    'TR330006100519786457841326', 'ada.yilmaz@ornek.com'];

// ─── Ortam ───────────────────────────────────────────────────────────────────

function build(opts = {}) {
    const dom = new JSDOM(`<!doctype html><html><body>
      <textarea id="ta"></textarea>
      <div id="ce" contenteditable="true"></div>
      <input id="pw" type="password">
      <button id="send" data-testid="send-button">Gönder</button>
      <button id="other">Başka</button>
    </body></html>`, { url: 'https://chatgpt.com/', pretendToBeVisual: true, runScripts: 'outside-only' });

    const w = dom.window;
    const state = {
        local: { settings: opts.settings },
        session: {},
        messages: [],
        shadowInit: null,
        consoleCalls: [],
    };

    // Kapalı shadow root'u test edebilmek için açıyoruz ama istenen modu
    // kaydediyoruz: bir test kodun 'closed' istediğini ayrıca doğruluyor.
    const attach = w.Element.prototype.attachShadow;
    w.Element.prototype.attachShadow = function (init) {
        state.shadowInit = init;
        const root = attach.call(this, { ...init, mode: 'open' });
        state.root = root;
        return root;
    };

    for (const k of ['log', 'warn', 'error', 'info', 'debug']) {
        w.console[k] = (...a) => state.consoleCalls.push([k, a.join(' ')]);
    }

    w.chrome = {
        storage: {
            local: {
                get: (keys, cb) => cb({ ...state.local }),
                set: (obj, cb) => { Object.assign(state.local, obj); cb && cb(); },
            },
            session: {
                get: (k, cb) => cb({ ...state.session }),
                set: (o, cb) => { Object.assign(state.session, o); cb && cb(); },
            },
            onChanged: { addListener: (fn) => { state.onChanged = fn; } },
        },
        runtime: {
            lastError: null,
            sendMessage: (msg, cb) => {
                state.messages.push(msg);
                if (msg.type === 'ortu:get-map') return cb && cb({ entries: state.map || [] });
                cb && cb({ ok: true });
            },
            onMessage: { addListener: (fn) => { state.onRuntimeMessage = fn; } },
        },
    };

    // execCommand: gerçek tarayıcıdaki insertText davranışını taklit et.
    w.document.execCommand = (cmd, _ui, value) => {
        if (cmd !== 'insertText') return false;
        const el = w.document.activeElement;
        if (!el) return false;
        if ('value' in el && typeof el.value === 'string') {
            const s = el.selectionStart ?? el.value.length;
            const e = el.selectionEnd ?? el.value.length;
            el.value = el.value.slice(0, s) + value + el.value.slice(e);
            el.dispatchEvent(new w.InputEvent('input', { bubbles: true }));
            return true;
        }
        if (el.isContentEditable) {
            el.textContent = value;
            el.dispatchEvent(new w.InputEvent('input', { bubbles: true }));
            return true;
        }
        return false;
    };

    w.eval(SOURCE);
    return { w, state, dom };
}

const enter = (el, extra = {}) => {
    const ev = new el.ownerDocument.defaultView.KeyboardEvent('keydown',
        { key: 'Enter', bubbles: true, cancelable: true, ...extra });
    el.dispatchEvent(ev);
    return ev;
};

function paste(el, text) {
    const w = el.ownerDocument.defaultView;
    const ev = new w.Event('paste', { bubbles: true, cancelable: true });
    ev.clipboardData = { getData: (t) => (t === 'text/plain' ? text : '') };
    el.dispatchEvent(ev);
    return ev;
}

const panel = (state) => state.root && state.root.querySelector('.panel');
const q = (state, sel) => state.root && state.root.querySelector(sel);
const buttonByText = (state, text) =>
    [...(state.root ? state.root.querySelectorAll('button') : [])].find(b => b.textContent === text);
const preview = (state) => (q(state, '.out') || {}).textContent || '';
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms));

// ─── Gönderim koruması ───────────────────────────────────────────────────────

test('kirli mesajda gönderim kesilir ve panel açılır', () => {
    const { w, state } = build();
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    const ev = enter(ta);
    assert.ok(ev.defaultPrevented, 'gönderim kesilmeli');
    assert.ok(panel(state), 'panel açılmalı');
});

test('temiz mesaja karışılmaz', () => {
    const { w, state } = build();
    const ta = w.document.getElementById('ta');
    ta.value = TEMIZ;
    assert.ok(!enter(ta).defaultPrevented);
    assert.ok(!panel(state));
});

test('Shift+Enter satır sonu sayılır, kesilmez', () => {
    const { w } = build();
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    assert.ok(!enter(ta, { shiftKey: true }).defaultPrevented);
});

test('IME yazımı sırasında kesilmez', () => {
    const { w } = build();
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    assert.ok(!enter(ta, { isComposing: true }).defaultPrevented);
});

test('şifre alanına hiç dokunulmaz', () => {
    const { w, state } = build();
    const pw = w.document.getElementById('pw');
    pw.value = KIRLI;
    assert.ok(!enter(pw).defaultPrevented);
    assert.ok(!panel(state));
});

test('olayı tüketen editörde bile gönderim kesilir', () => {
    // ChatGPT davranışı: sayfa Enter'ı window + capture fazında yakalayıp
    // stopImmediatePropagation çağırıyor. Bizim dinleyicimiz ÖNCE kaydolduğu
    // için yine de sıra bize geliyor. Bu, eklentinin en kritik davranışı.
    const { w, state } = build();
    let sayfaGordu = false;
    w.addEventListener('keydown', (e) => { sayfaGordu = true; e.stopImmediatePropagation(); }, true);
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    const ev = enter(ta);
    assert.ok(ev.defaultPrevented, 'sayfa olayı yutsa da kesilmeli');
    assert.ok(!sayfaGordu, 'sayfanın dinleyicisine hiç ulaşmamalı');
    assert.ok(panel(state));
});

test('maskele ve gönder: metin maskelenir ve gönderim yeniden tetiklenir', async () => {
    const { w, state } = build();
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    enter(ta);
    let yenidenGonderildi = false;
    w.addEventListener('keydown', () => { yenidenGonderildi = true; }, true);
    buttonByText(state, 'Maskele ve gönder').click();
    await wait(60);
    for (const s of SIRLAR) assert.ok(!ta.value.includes(s), 'alanda kaldı: ' + s);
    assert.match(ta.value, /\[TC_KIMLIK_1\]/);
    assert.ok(yenidenGonderildi, 'gönderim yeniden tetiklenmeli');
    assert.ok(state.messages.some(m => m.type === 'ortu:store-map'));
});

test('maskesiz gönder metni olduğu gibi bırakır', async () => {
    const { w, state } = build();
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    enter(ta);
    buttonByText(state, 'Maskesiz gönder').click();
    await wait(60);
    assert.equal(ta.value, KIRLI);
});

test('iptal: metin alanda kalır, gönderim olmaz', async () => {
    const { w, state } = build();
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    enter(ta);
    let gonderildi = false;
    w.addEventListener('keydown', () => { gonderildi = true; }, true);
    q(state, '.x').click();
    await wait(60);
    assert.equal(ta.value, KIRLI);
    assert.ok(!gonderildi);
    assert.ok(!panel(state));
});

test('otomatik mod sormadan maskeler', async () => {
    const { w, state } = build({ settings: { sendMode: 'otomatik' } });
    await wait(0);
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    enter(ta);
    assert.ok(!panel(state), 'otomatik modda panel açılmamalı');
    await wait(60);
    assert.match(ta.value, /\[TC_KIMLIK_1\]/);
});

test('kapalı modda gönderime karışılmaz', async () => {
    const { w, state } = build({ settings: { sendMode: 'kapali' } });
    await wait(0);
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    assert.ok(!enter(ta).defaultPrevented);
    assert.ok(!panel(state));
});

test('site kapalıysa hiçbir kapı çalışmaz', async () => {
    const { w, state } = build({ settings: { perSite: { 'chatgpt.com': false } } });
    await wait(0);
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    assert.ok(!enter(ta).defaultPrevented);
    assert.ok(!paste(ta, KIRLI).defaultPrevented);
    assert.ok(!panel(state));
});

test('gönder düğmesi yolu: tanınan düğme kesilir, tanınmayan düğmeye karışılmaz', async () => {
    const { w, state } = build();
    await wait(0);
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    ta.dispatchEvent(new w.InputEvent('input', { bubbles: true }));   // lastTyped kaydı

    const other = w.document.getElementById('other');
    const ev1 = new w.MouseEvent('click', { bubbles: true, cancelable: true });
    other.dispatchEvent(ev1);
    assert.ok(!ev1.defaultPrevented, 'tanınmayan düğmeye karışılmamalı');

    const send = w.document.getElementById('send');
    const ev2 = new w.MouseEvent('click', { bubbles: true, cancelable: true });
    send.dispatchEvent(ev2);
    assert.ok(ev2.defaultPrevented, 'gönder düğmesi kesilmeli');
    assert.ok(panel(state));
});

test('hiç yazmadan yapıştırıp gönder düğmesine tıklama da denetlenir', async () => {
    // Eskiden yalnızca `lastTyped` alanına bakılıyordu; input olayı hiç
    // geçmediği için alan bulunamıyor ve mesaj denetlenmeden çıkıyordu.
    const { w, state } = build({ settings: { pasteMode: 'kapali' } });
    await wait(0);
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    ta.focus();
    const ev = new w.MouseEvent('click', { bubbles: true, cancelable: true });
    w.document.getElementById('send').dispatchEvent(ev);
    assert.ok(ev.defaultPrevented, 'gönderim kesilmeliydi');
    assert.ok(panel(state), 'panel açılmalıydı');
});

test('contenteditable alanda da çalışır', () => {
    const { w, state } = build();
    const ce = w.document.getElementById('ce');
    ce.textContent = KIRLI;
    assert.ok(enter(ce).defaultPrevented);
    assert.ok(panel(state));
});

// ─── Panel davranışı ─────────────────────────────────────────────────────────

test('gidecek metin önizlemesi canlı: işaret kalkınca gerçek değer görünür', () => {
    const { w, state } = build();
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    enter(ta);
    assert.ok(!preview(state).includes('10000000146'), 'başlangıçta hepsi maskeli olmalı');

    const rows = [...state.root.querySelectorAll('.row')];
    const tcRow = rows.find(r => r.querySelector('.val').textContent === '10000000146');
    const cb = tcRow.querySelector('input');
    cb.checked = false;
    cb.dispatchEvent(new w.Event('change'));

    assert.ok(preview(state).includes('10000000146'), 'açık bırakılan veri önizlemede görünmeli');
    assert.ok(tcRow.classList.contains('open'));
    assert.match(q(state, '.sub').textContent, /açık gidecek/);
    assert.ok(q(state, '.out').classList.contains('leaky'));
});

test('tümünü açık bırak / tümünü maskele', () => {
    const { w, state } = build();
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    enter(ta);
    buttonByText(state, 'tümünü açık bırak').click();
    assert.equal(preview(state), KIRLI, 'hepsi açıkken metin aynen kalmalı');
    buttonByText(state, 'tümünü maskele').click();
    for (const s of SIRLAR) assert.ok(!preview(state).includes(s));
});

test('panel içi stil değişikliği önizlemeye anında yansır', () => {
    const { w, state } = build();
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    enter(ta);
    buttonByText(state, 'Ayarlar').click();
    assert.ok(q(state, '.opts').classList.contains('show'));
    buttonByText(state, '****').click();
    assert.match(preview(state), /\*{3,}/);
    assert.ok(!preview(state).includes('[TC_KIMLIK_1]'));
});

test('Esc paneli kapatır, metin alanda kalır', () => {
    const { w, state } = build();
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    enter(ta);
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(!panel(state));
    assert.equal(ta.value, KIRLI);
});

test('panel açıkken ikinci bir panel açılmaz', () => {
    const { w, state } = build();
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    enter(ta);
    enter(ta);
    assert.equal(state.root.querySelectorAll('.panel').length, 1);
});

// ─── Yapıştırma koruması ─────────────────────────────────────────────────────

test('kirli yapıştırma durur, temiz yapıştırma geçer', () => {
    const { w, state } = build();
    const ta = w.document.getElementById('ta');
    assert.ok(paste(ta, KIRLI).defaultPrevented);
    assert.ok(panel(state));
    q(state, '.x').click();
    assert.ok(!paste(ta, TEMIZ).defaultPrevented);
});

test('yapıştırma paneli onaylanınca maskeli metin alana girer', () => {
    const { w, state } = build();
    const ta = w.document.getElementById('ta');
    ta.focus();
    paste(ta, KIRLI);
    buttonByText(state, 'Maskele ve yapıştır').click();
    assert.match(ta.value, /\[IBAN_1\]/);
    for (const s of SIRLAR) assert.ok(!ta.value.includes(s));
});

test('sessiz mod sormadan maskeler ve geri al sunar', async () => {
    const { w, state } = build({ settings: { pasteMode: 'sessiz' } });
    await wait(0);
    const ta = w.document.getElementById('ta');
    ta.focus();
    paste(ta, KIRLI);
    assert.ok(!panel(state), 'sessiz modda panel açılmamalı');
    assert.match(ta.value, /\[TC_KIMLIK_1\]/);
    assert.ok(q(state, '.toast'));
    assert.ok(buttonByText(state, 'geri al'));
});

test('yapıştırma kapalıyken karışılmaz', async () => {
    const { w, state } = build({ settings: { pasteMode: 'kapali', sendMode: 'kapali' } });
    await wait(0);
    const ta = w.document.getElementById('ta');
    assert.ok(!paste(ta, KIRLI).defaultPrevented);
    assert.ok(!panel(state));
});

// ─── Yazarken rozet ──────────────────────────────────────────────────────────

test('yazarken rozet çıkar ve metne dokunmaz', async () => {
    const { w, state } = build();
    await wait(0);
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    ta.dispatchEvent(new w.InputEvent('input', { bubbles: true }));
    await wait(700);
    const badge = q(state, '.badge');
    assert.ok(badge, 'rozet çıkmalı');
    assert.equal(ta.value, KIRLI, 'metne dokunulmamalı');
    badge.click();
    assert.ok(panel(state), 'rozete tıklayınca panel açılmalı');
});

test('rozete tıklamak alanın odağını düşürmüyor', async () => {
    // Aksi halde tıklama önce blur üretiyor, blur rozeti kaldırıyor ve click
    // hiç ateşlenmiyordu: rozet görünüyor ama tıklanamıyordu.
    const { w, state } = build();
    await wait(0);
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    ta.dispatchEvent(new w.InputEvent('input', { bubbles: true }));
    await wait(700);
    const badge = q(state, '.badge');
    const down = new w.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    badge.dispatchEvent(down);
    assert.ok(down.defaultPrevented, 'mousedown iptal edilmeli');
    assert.ok(q(state, '.badge'), 'rozet mousedown sonrası ayakta kalmalı');
});

test('yazarken uyarı kapalıysa rozet çıkmaz', async () => {
    const { w, state } = build({ settings: { typingHints: false } });
    await wait(0);
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    ta.dispatchEvent(new w.InputEvent('input', { bubbles: true }));
    await wait(700);
    assert.ok(!q(state, '.badge'));
});

// ─── Komutlar ────────────────────────────────────────────────────────────────

test('alanı maskele komutu paneli açar', () => {
    const { w, state } = build();
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    ta.focus();
    state.onRuntimeMessage({ type: 'ortu:mask-field' });
    assert.ok(panel(state));
});

test('token çözme seçili metni gerçek değere döndürür', async () => {
    const { w, state } = build();
    state.map = [['[KISI_1]', 'Ada Yılmaz'], ['[TC_KIMLIK_1]', '10000000146']];
    const div = w.document.createElement('div');
    div.textContent = '[KISI_1] (TC [TC_KIMLIK_1]) ile görüşüldü.';
    w.document.body.appendChild(div);
    const range = w.document.createRange();
    range.selectNodeContents(div);
    w.getSelection().removeAllRanges();
    w.getSelection().addRange(range);

    state.onRuntimeMessage({ type: 'ortu:decode-selection' });
    await wait(10);
    assert.ok(panel(state), 'çözülmüş metin panelde gösterilmeli');
    assert.match(preview(state), /Ada Yılmaz/);
    assert.match(preview(state), /10000000146/);
});

// ─── Sızıntı denetimi ────────────────────────────────────────────────────────

test('sızıntı denetimi: hiçbir gerçek değer dışarı çıkmıyor', async () => {
    const { w, state } = build();
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    enter(ta);
    buttonByText(state, 'Maskele ve gönder').click();
    await wait(60);

    // 1) Giden metin
    for (const s of SIRLAR) assert.ok(!ta.value.includes(s), 'giden metinde: ' + s);
    // 2) Sayfanın okuyabildiği DOM (panel kapalı root'ta olmalı)
    const sayfaMetni = w.document.body.textContent;
    for (const s of SIRLAR) assert.ok(!sayfaMetni.includes(s), 'sayfa DOM\'unda: ' + s);
    // 3) Kalıcı depo: yalnızca ayar ve sayaç
    const kalici = JSON.stringify(state.local);
    for (const s of SIRLAR) assert.ok(!kalici.includes(s), 'kalıcı depoda: ' + s);
    assert.deepEqual(Object.keys(state.local).sort(), ['settings']);
    // 4) Konsol
    assert.deepEqual(state.consoleCalls, []);
    // 5) Harita yalnızca service worker'a gidiyor, oradan oturum belleğine
    const mapMsg = state.messages.find(m => m.type === 'ortu:store-map');
    assert.ok(mapMsg && mapMsg.entries.length, 'harita gönderilmiş olmalı');
});

test('panel KAPALI shadow root ile açılıyor', () => {
    // build() tek başına DOM'a hiçbir şey eklemez; shadow root ilk panelle
    // kurulur. Test eskiden paneli açmadan shadowInit okuyup null'a düşüyordu.
    const { w, state } = build();
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    enter(ta);
    assert.ok(state.shadowInit, 'shadow root kurulmuş olmalı');
    assert.equal(state.shadowInit.mode, 'closed');
});

test('paneldeki gerçek değerler sayfadan okunamaz', () => {
    const { w, state } = build();
    const ta = w.document.getElementById('ta');
    ta.value = KIRLI;
    enter(ta);
    // Panel açıkken bile: host elemanın shadowRoot'u sayfaya kapalı olmalı.
    // (Test ortamında root'u açtık; burada sayfanın gördüğü DOM'u denetliyoruz.)
    const host = w.document.querySelector('[data-ortu]');
    assert.ok(host, 'host eleman olmalı');
    assert.ok(!w.document.body.textContent.includes('10000000146'));
});
