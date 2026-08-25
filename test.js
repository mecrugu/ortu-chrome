// Örtü — birim testleri:  node test.js
//
// Kapsam: motor doğrulayıcıları, tespit, token round-trip, profil kapsamı,
// ayar göçü, maskeleme stilleri ve depo bütünlüğü (manifest ↔ dosyalar,
// popup.html ↔ popup.js).
//
// DOM katmanı burada test EDİLMEZ; onun için gerçek tarayıcı gerekir. Bu
// dosyanın işi, DOM'suz çalışan her şeyin doğru olduğunu ucuza garantilemek.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

Object.assign(globalThis,
    require('./engine/dictionaries.js'),
    require('./engine/patterns.js'),
    require('./engine/tokenize.js'));
const E = require('./engine/detect.js');
Object.assign(globalThis, E);
const P = require('./src/policy.js');
Object.assign(globalThis, P);

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const detect = (text, settings) => ortuDetect(text, {
    enabled: ortuResolveEntities(settings || ORTU_DEFAULTS, ORTU_ALL_ENTITIES),
    threshold: (settings || ORTU_DEFAULTS).threshold,
});
const kinds = (findings) => new Set(findings.map(f => f.entity));

// ─── Doğrulayıcılar ──────────────────────────────────────────────────────────

test('TC kimlik sağlaması', () => {
    assert.ok(ortuValidTC('10000000146'));
    assert.ok(!ortuValidTC('11111111111'));
    assert.ok(!ortuValidTC('01234567890'), 'ilk hane 0 olamaz');
    assert.ok(!ortuValidTC('123456789'), 'kısa');
});

test('IBAN mod-97', () => {
    assert.ok(ortuValidIBAN('TR330006100519786457841326'));
    assert.ok(ortuValidIBAN('TR33 0006 1005 1978 6457 8413 26'), 'boşluklu hali de geçerli');
    assert.ok(!ortuValidIBAN('TR330006100519786457841327'));
});

test('kart numarası Luhn', () => {
    assert.ok(ortuValidLuhn('4242424242424242'));
    assert.ok(ortuValidLuhn('4242 4242 4242 4242'));
    assert.ok(!ortuValidLuhn('4242424242424243'));
});

test('vergi numarası sağlaması', () => {
    assert.ok(ortuValidVergiNo('1234567808'));
    assert.ok(!ortuValidVergiNo('1234567800'));
});

test('IPv4 aralığı', () => {
    assert.ok(ortuValidIPv4('192.168.1.55'));
    assert.ok(!ortuValidIPv4('999.1.1.1'));
});

// ─── Tespit ──────────────────────────────────────────────────────────────────

test('temiz metinde bulgu yok', () => {
    const f = detect('Bugün hava çok güzel, parkta yürüyüş yaptık ve kahve içtik.');
    assert.equal(f.length, 0);
});

test('kimliklendiriciler yakalanıyor', () => {
    const f = detect('TC 10000000146, IBAN TR330006100519786457841326, ' +
        'tel 0532 123 45 67, posta ada.yilmaz@ornek.com, IP 192.168.1.55');
    const k = kinds(f);
    for (const e of ['TC_KIMLIK', 'IBAN', 'TELEFON', 'EPOSTA', 'IP_ADRESI']) {
        assert.ok(k.has(e), e + ' bulunamadı');
    }
});

test('sağlaması tutan bulgu daha yüksek skor alır', () => {
    const iyi = detect('TC 10000000146').find(f => f.entity === 'TC_KIMLIK');
    const kotu = detect('TC 11111111111').find(f => f.entity === 'TC_KIMLIK');
    assert.ok(iyi.score > kotu.score);
});

test('sağlaması TUTMAYAN yüksek riskli biçimler yine de panele çıkar', () => {
    // Yazım hatalı bir TC ya da IBAN hâlâ kişisel veridir. Varsayılan eşiğin
    // altına düşerse kullanıcı hiç görmez ve veri sessizce sızar.
    for (const t of ['TC 11111111111', 'IBAN TR330006100519786457841327',
        'kart 4242424242424243']) {
        assert.ok(detect(t).length > 0, 'sessizce elendi: ' + t);
    }
});

test('sağlaması tutmayan gürültülü türler elenir', () => {
    // 10 haneli sipariş numarası ve sürüm numarası panelde yer kaplamamalı;
    // gürültü kullanıcıya "hepsini onayla" alışkanlığı kazandırıyor.
    assert.ok(!kinds(detect('sürüm 999.1.1.1')).has('IP_ADRESI'));
    assert.ok(!kinds(detect('sipariş 9999999999')).has('VERGI_NO'));
});

test('telefon kalıbı kart numarasının içinde eşleşmiyor', () => {
    const f = detect('kart 4242424242424243');
    assert.ok(!kinds(f).has('TELEFON'), 'kart numarası telefon diye etiketlendi');
    assert.ok(kinds(f).has('KREDI_KARTI'));
});

test('her bulgunun indisleri değeriyle birebir uyuşur', () => {
    // Bu değişmez bozulursa maskeleme metni yanlış yerden keser ve gerçek veri
    // maskeli metinde kalır. En sessiz sızıntı yolu bu.
    const orneler = [
        'Örnek Mahallesi Çınar Sokak No: 5 Düzce adresinde ikamet ediyor.',
        'Mahallesi. Örnek Mahallesi Çınar Sokak No: 5',
        'Ankara  Belediyesi  Müdürlüğü yazısı geldi',
        'Akdeniz Üniversitesi Hastanesi raporu ekte.',
        'Müvekkilim Ada Yılmaz (TC 10000000146), IBAN TR330006100519786457841326',
        'Sn. Kevork Bezciyan, 34 ABC 123, ada.yilmaz@ornek.com, 0532 123 45 67',
    ];
    for (const t of orneler) {
        for (const f of detect(t)) {
            assert.equal(t.slice(f.start, f.end), f.value, 'indis kayması: ' + f.entity);
        }
    }
});

test('maskeli metinde hiçbir gerçek değer kalmıyor', () => {
    const t = 'Müvekkilim Ada Yılmaz (TC 10000000146), IBAN TR330006100519786457841326, ' +
        'tel 0532 123 45 67, ada.yilmaz@ornek.com';
    const f = detect(t);
    const { text: masked } = ortuMask(t, f, { style: 'token', labels: ORTU_LABELS });
    for (const gizli of f.map(x => x.value)) {
        assert.ok(!masked.includes(gizli), 'sızdı: ' + gizli);
    }
});

test('ad cümle başındaki büyük harfli sözcüğe takılmıyor', () => {
    const f = detect('Müvekkilim Ada Yılmaz ile görüştüm.');
    const kisi = f.find(x => x.entity === 'KISI');
    assert.equal(kisi.value, 'Ada Yılmaz');
});

test('sözlükte olmayan ad ipucundan yakalanıyor', () => {
    const f = detect('Sn. Kevork Bezciyan aradı.');
    assert.ok(f.some(x => x.entity === 'KISI' && x.value.includes('Bezciyan')));
});

test('şehir adı kişi sayılmıyor', () => {
    const f = detect('Ankara Üniversitesi mezunuyum, İzmir merkezde oturuyorum.');
    assert.ok(!f.some(x => x.entity === 'KISI'));
    assert.ok(f.some(x => x.entity === 'YER' || x.entity === 'KURUM'));
});

test('adres bloğu tek bulgu olarak toplanıyor', () => {
    const f = detect('Örnek Mahallesi Çınar Sokak No: 5 Düzce adresinde ikamet ediyor.');
    const adres = f.filter(x => x.entity === 'ADRES');
    assert.equal(adres.length, 1);
    assert.ok(adres[0].value.includes('Çınar Sokak'));
});

test('kurum adı soldaki sözcüklerle birlikte alınıyor', () => {
    const f = detect('Akdeniz Üniversitesi Hastanesi raporu ekte.');
    const kurum = f.find(x => x.entity === 'KURUM');
    assert.equal(kurum.value, 'Akdeniz Üniversitesi Hastanesi');
});

test('çakışan bulgular teke iniyor ve uzun olan kazanıyor', () => {
    const f = detect('Örnek Mahallesi Çınar Sokak No: 5 Düzce');
    for (let i = 1; i < f.length; i++) assert.ok(f[i].start >= f[i - 1].end, 'çakışma kaldı');
});

test('eşik altındaki bulgu elenir', () => {
    const yuksek = detect('IP 192.168.1.55', { ...ORTU_DEFAULTS, threshold: 0.95 });
    assert.ok(!kinds(yuksek).has('MESLEK'));
});

// ─── Token ───────────────────────────────────────────────────────────────────

test('aynı değer aynı token\'ı alır', () => {
    const text = 'Ada Yılmaz dedi ki, Ada Yılmaz geldi.';
    const f = detect(text);
    const { text: out } = ortuTokenize(text, f, () => false);
    assert.equal(out.match(/\[KISI_1\]/g).length, 2);
    assert.ok(!out.includes('KISI_2'));
});

test('token round-trip metni geri getirir', () => {
    const text = 'Ada Yılmaz, TC 10000000146, ada.yilmaz@ornek.com';
    const f = detect(text);
    const { text: masked, map } = ortuTokenize(text, f, () => false);
    assert.ok(!masked.includes('10000000146'));
    assert.equal(ortuDecode(masked, map), text);
});

test('token adları ASCII', () => {
    assert.equal(ortuAsciiKey('TC_KIMLIK'), 'TC_KIMLIK');
    assert.equal(ortuAsciiKey('Sağlık Verisi'), 'SAGLIK_VERISI');
    const f = detect('Ada Yılmaz diyabet hastası.');
    const { text: masked } = ortuTokenize('Ada Yılmaz diyabet hastası.', f, () => false);
    assert.ok(/^[\x20-\x7e\p{L}\s.,]*$/u.test(masked));
    assert.ok(!/\[[^\]]*[çğıöşüÇĞİÖŞÜ][^\]]*\]/.test(masked), 'token içinde Türkçe karakter var');
});

test('[KISI_1] ile [KISI_11] karışmıyor', () => {
    const map = new Map([['[KISI_1]', 'Ada'], ['[KISI_11]', 'Zeynep']]);
    assert.equal(ortuDecode('[KISI_11] ve [KISI_1]', map), 'Zeynep ve Ada');
});

test('açık bırakılan bulgu maskelenmez', () => {
    const text = 'Ada Yılmaz, TC 10000000146';
    const f = detect(text);
    const tc = f.find(x => x.entity === 'TC_KIMLIK');
    const { text: out } = ortuTokenize(text, f, (i) => i === tc.index);
    assert.ok(out.includes('10000000146'), 'açık bırakılan veri metinde kalmalı');
    assert.ok(!out.includes('Ada Yılmaz'));
});

test('hasTokens yalnızca token biçimini tanır', () => {
    assert.ok(ortuHasTokens('merhaba [KISI_1]'));
    assert.ok(!ortuHasTokens('merhaba [Ada]'));
});

// ─── Profiller ───────────────────────────────────────────────────────────────

test('kapsam artan sırada: dar ⊂ dengeli ⊂ tumu', () => {
    const dar = ortuResolveEntities({ profile: 'dar' }, ORTU_ALL_ENTITIES);
    const dengeli = ortuResolveEntities({ profile: 'dengeli' }, ORTU_ALL_ENTITIES);
    const tumu = ortuResolveEntities({ profile: 'tumu' }, ORTU_ALL_ENTITIES);
    for (const e of dar) assert.ok(dengeli.has(e), e + ' dengeli profilde eksik');
    for (const e of dengeli) assert.ok(tumu.has(e), e + ' tumu profilinde eksik');
    assert.ok(dar.size < dengeli.size && dengeli.size < tumu.size);
});

test('dar profil isim ve adres maskelemez, adı bunu dürüst anlatır', () => {
    const dar = ortuResolveEntities({ profile: 'dar' }, ORTU_ALL_ENTITIES);
    assert.ok(!dar.has('KISI'));
    assert.ok(!dar.has('ADRES'));
    assert.ok(dar.has('TC_KIMLIK'));
    assert.match(ORTU_PROFILES.dar.hint, /MASKELENMEZ/);
});

test('dengeli profil zayıf niteleyicileri dışarıda bırakır', () => {
    const s = ortuResolveEntities({ profile: 'dengeli' }, ORTU_ALL_ENTITIES);
    for (const e of ORTU_WEAK_ATTRS.concat(ORTU_LOW_SIGNAL)) assert.ok(!s.has(e), e);
    assert.ok(s.has('KISI') && s.has('ADRES') && s.has('SAGLIK'));
});

test('kullanıcının kapattığı tür her profilde kapalı', () => {
    const s = ortuResolveEntities({ profile: 'tumu', disabledEntities: ['EPOSTA'] }, ORTU_ALL_ENTITIES);
    assert.ok(!s.has('EPOSTA'));
});

// ─── Ayar göçü ───────────────────────────────────────────────────────────────

test('eski profil adları taşınır', () => {
    assert.equal(ortuMigrate({ profile: 'guvenli' }).profile, 'dengeli');
    assert.equal(ortuMigrate({ profile: 'hepsi' }).profile, 'tumu');
    assert.equal(ortuMigrate({ profile: 'yok-böyle-bir-şey' }).profile, 'dengeli');
});

test('eski tek "mode" alanı yapıştırmaya taşınır', () => {
    const s = ortuMigrate({ mode: 'sessiz' });
    assert.equal(s.pasteMode, 'sessiz');
    assert.equal(s.mode, undefined);
});

test('tanımsız gönderim kapısı EN GÜVENLİ değerle açılır', () => {
    // Sessizce kapalı kalırsa kullanıcı korunduğunu sanır; bu kabul edilemez.
    assert.equal(ortuMigrate({}).sendMode, 'sor');
    assert.equal(ortuMigrate({ sendMode: 'saçma' }).sendMode, 'sor');
});

test('bozuk değerler varsayılana döner', () => {
    const s = ortuMigrate({ threshold: 9, minLength: -3, disabledEntities: 'x', perSite: 5, style: 'yok' });
    assert.equal(s.threshold, ORTU_DEFAULTS.threshold);
    assert.equal(s.minLength, ORTU_DEFAULTS.minLength);
    assert.deepEqual(s.disabledEntities, []);
    assert.deepEqual(s.perSite, {});
    assert.equal(s.style, 'token');
});

test('göç saf: girdiyi değiştirmez', () => {
    const input = { profile: 'guvenli' };
    ortuMigrate(input);
    assert.equal(input.profile, 'guvenli');
});

test('göç iç içe nesneleri paylaştırmaz', () => {
    // ORTU_DEFAULTS sığ yayılıyor. Kopyalanmazsa ayarı olmayan her çağrı AYNI
    // perSite nesnesini alır ve bir sitede yapılan kapatma her yere sızar.
    const a = ortuMigrate({});
    const b = ortuMigrate({});
    a.perSite['claude.ai'] = false;
    a.disabledEntities.push('EPOSTA');
    assert.deepEqual(b.perSite, {});
    assert.deepEqual(b.disabledEntities, []);
    assert.deepEqual(ORTU_DEFAULTS.perSite, {});
});

// ─── Koruma özeti ────────────────────────────────────────────────────────────

test('koruma özeti her durumu ayırt eder', () => {
    assert.equal(ortuProtectionSummary({ enabled: false }).level, 'kapali');
    assert.equal(ortuProtectionSummary({ sendMode: 'kapali', pasteMode: 'kapali' }).level, 'kapali');
    assert.equal(ortuProtectionSummary({ sendMode: 'sor', pasteMode: 'kapali' }).level, 'kismi');
    assert.equal(ortuProtectionSummary({ sendMode: 'kapali', pasteMode: 'sor' }).level, 'kismi');
    assert.equal(ortuProtectionSummary({}).level, 'tam');
    assert.match(ortuProtectionSummary({ sendMode: 'otomatik' }).text, /otomatik/);
});

test('yalnızca yapıştırma açıkken uyarı açık sözlü', () => {
    const t = ortuProtectionSummary({ sendMode: 'kapali', pasteMode: 'sor' }).text;
    assert.match(t, /denetlenmiyor/);
});

// ─── Site kapsamı ────────────────────────────────────────────────────────────

test('host ayrıştırma', () => {
    assert.equal(ortuHostOf('https://www.perplexity.ai/search?q=1'), 'perplexity.ai');
    assert.equal(ortuHostOf('bozuk'), '');
});

test('site açık/kapalı ve üst alan adı mirası', () => {
    const s = { ...ORTU_DEFAULTS, perSite: { 'claude.ai': false, 'google.com': false } };
    assert.ok(!ortuSiteEnabled(s, 'claude.ai'));
    assert.ok(!ortuSiteEnabled(s, 'gemini.google.com'), 'üst alan adı kaydı miras alınmalı');
    assert.ok(ortuSiteEnabled(s, 'chatgpt.com'));
    assert.ok(!ortuSiteEnabled({ ...s, enabled: false }, 'chatgpt.com'), 'ana şalter her şeyi kapatır');
});

// ─── Karışma kararı ──────────────────────────────────────────────────────────

test('kısa metne karışılmaz ama eşik sızıntı yapmaz', () => {
    assert.ok(!ortuShouldIntercept('abc', [{}], ORTU_DEFAULTS));
    // minLength en kısa kimliklendiriciden büyük olmamalı: "a@b.co" 6 karakter.
    assert.ok(ORTU_DEFAULTS.minLength <= 6);
    const kisa = 'a@b.co';
    assert.ok(ortuShouldIntercept(kisa, detect(kisa), ORTU_DEFAULTS));
});

test('bulgu yoksa karışılmaz', () => {
    assert.ok(!ortuShouldIntercept('uzun ama temiz bir cümle', [], ORTU_DEFAULTS));
});

// ─── Özet ────────────────────────────────────────────────────────────────────

test('özet gruplaması ve kısa metin', () => {
    const text = 'Ada Yılmaz ve Mehmet Demir, TC 10000000146';
    const s = ortuSummarize(detect(text), ORTU_LABELS);
    assert.equal(s.total, 3);
    assert.equal(s.groups[0].label, 'Kişi');
    assert.equal(s.groups[0].count, 2);
    assert.match(ortuGroupText(s.groups, 1), /^2 Kişi \+1$/);
});

// ─── Maskeleme stilleri ──────────────────────────────────────────────────────

test('üç stil de veriyi metinden çıkarır', () => {
    const text = 'Ada Yılmaz, TC 10000000146';
    const f = detect(text);
    for (const style of Object.keys(ORTU_STYLES)) {
        const { text: out } = ortuMask(text, f, { style, labels: ORTU_LABELS });
        assert.ok(!out.includes('10000000146'), style + ' sızdırdı');
        assert.ok(!out.includes('Ada Yılmaz'), style + ' sızdırdı');
    }
});

test('etiket stili okunur, yıldız stili tür sızdırmaz', () => {
    const text = 'Ada Yılmaz geldi';
    const f = detect(text);
    assert.match(ortuMask(text, f, { style: 'etiket', labels: ORTU_LABELS }).text, /<Kişi>/);
    assert.match(ortuMask(text, f, { style: 'yildiz' }).text, /^\*+ geldi$/);
});

test('yalnızca token stili geri çevrilebilir harita üretir', () => {
    const text = 'Ada Yılmaz geldi';
    const f = detect(text);
    assert.ok(ortuMask(text, f, { style: 'token' }).map.size > 0);
    assert.equal(ortuMask(text, f, { style: 'etiket' }).map.size, 0);
    assert.equal(ortuMask(text, f, { style: 'yildiz' }).map.size, 0);
});

test('yıldız maskesi uzunluk sızdırmaz', () => {
    assert.equal(ortuStarMask('a'.repeat(60)).length, 12);
    assert.ok(ortuStarMask('ab').length >= 3);
});

// ─── Depo bütünlüğü ──────────────────────────────────────────────────────────

const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));

test('manifest ile package.json sürümleri aynı', () => {
    assert.equal(manifest.version, pkg.version);
});

test('manifest\'te adı geçen her dosya var', () => {
    const files = [
        manifest.background.service_worker,
        manifest.action.default_popup,
        ...manifest.content_scripts[0].js,
        ...Object.values(manifest.icons),
    ];
    for (const f of files) assert.ok(fs.existsSync(path.join(__dirname, f)), f + ' yok');
});

test('content script document_start ve tek çerçevede', () => {
    const cs = manifest.content_scripts[0];
    // Sayfa kendi Enter dinleyicisini kaydetmeden önce kaydolmak zorundayız.
    assert.equal(cs.run_at, 'document_start');
    assert.equal(cs.all_frames, false);
});

test('<all_urls> istenmiyor', () => {
    const perms = JSON.stringify(manifest.host_permissions);
    assert.ok(!perms.includes('<all_urls>'));
    assert.ok(manifest.host_permissions.every(p => p.startsWith('https://')));
});

test('yükleme sırası bağımlılıkları karşılıyor', () => {
    const js = manifest.content_scripts[0].js;
    const at = (f) => js.indexOf(f);
    assert.ok(at('engine/dictionaries.js') < at('engine/detect.js'));
    assert.ok(at('engine/patterns.js') < at('engine/detect.js'));
    assert.ok(at('src/policy.js') < at('src/ui.js'));
    assert.ok(at('src/ui.js') < at('src/content.js'));
});

test('service worker ile manifest aynı dosya listesini kullanıyor', () => {
    // Dinamik kayıt eksik dosyayla yapılırsa ek sitelerde eklenti sessizce ölür.
    const bg = read('src/background.js');
    for (const f of manifest.content_scripts[0].js) assert.ok(bg.includes(f), f + ' background.js listesinde yok');
});

// ─── Gizlilik denetimleri ────────────────────────────────────────────────────

test('panel KAPALI shadow root içinde', () => {
    // Açık root olsaydı sayfa panelde görünen kişisel veriyi okuyabilirdi.
    assert.match(read('src/ui.js'), /attachShadow\(\{\s*mode:\s*'closed'\s*\}\)/);
});

test('şifre alanına dokunulmuyor', () => {
    assert.match(read('src/content.js'), /type === 'password'/);
});

test('hiçbir kaynak dosya konsola yazmıyor', () => {
    // Konsol, kişisel verinin en kolay sızdığı yer; tools/ dışında yasak.
    for (const f of ['src/content.js', 'src/ui.js', 'src/policy.js', 'src/popup.js',
        'src/background.js', 'engine/detect.js', 'engine/tokenize.js']) {
        assert.ok(!/console\.(log|warn|error|info|debug)/.test(read(f)), f + ' konsola yazıyor');
    }
});

test('ağ isteği yapan çağrı yok', () => {
    for (const f of ['src/content.js', 'src/ui.js', 'src/policy.js', 'src/popup.js',
        'src/background.js', 'engine/detect.js']) {
        assert.ok(!/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon/.test(read(f)), f + ' ağ isteği içeriyor');
    }
});

test('kalıcı depoya yalnızca ayar, sayaç ve ek site yazılıyor', () => {
    const src = read('src/background.js') + read('src/content.js') + read('src/popup.js');
    const keys = [...src.matchAll(/storage\.local\.set\(\{\s*([A-Za-z]+)/g)].map(m => m[1]);
    for (const k of keys) {
        assert.ok(['settings', 'maskedTotal', 'extraSites'].includes(k), 'beklenmeyen kalıcı anahtar: ' + k);
    }
});

test('token haritası oturum belleğinde tutuluyor', () => {
    const bg = read('src/background.js');
    assert.match(bg, /storage\.session\.set/);
    assert.ok(!/storage\.local\.set\(\{\s*\[?mapKey/.test(bg), 'harita diske yazılıyor');
});

// ─── Popup bütünlüğü ─────────────────────────────────────────────────────────

test('popup.js\'in aradığı her id popup.html\'de var', () => {
    const html = read('src/popup.html');
    const js = read('src/popup.js');
    const ids = new Set([...js.matchAll(/\$\('([A-Za-z]+)'\)/g)].map(m => m[1]));
    for (const id of ids) assert.ok(html.includes('id="' + id + '"'), 'eksik id: ' + id);
});

test('popup [hidden] kuralını yazar stiliyle geri getiriyor', () => {
    // .row { display: flex } tarayıcının [hidden] kuralını eziyor; bu satır
    // olmadan gizlenmesi gereken alanlar her zaman görünür.
    assert.match(read('src/popup.html'), /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test('popup gerekli betikleri doğru sırada yüklüyor', () => {
    const html = read('src/popup.html');
    const order = ['dictionaries.js', 'patterns.js', 'detect.js', 'tokenize.js', 'policy.js', 'popup.js'];
    let pos = -1;
    for (const f of order) {
        const at = html.indexOf(f);
        assert.ok(at > pos, f + ' yanlış sırada');
        pos = at;
    }
});

test('arayüz metinlerinde tire yerine düzgün noktalama', () => {
    // Uzun tire, kopyalanan metinde ve ekran okuyucuda sorun çıkarıyordu.
    const ui = read('src/ui.js');
    const texts = [...ui.matchAll(/el\('[a-z]+', [^,]+, '([^']*)'\)/g)].map(m => m[1]);
    for (const t of texts) assert.ok(!t.includes('--'), 'çift tire: ' + t);
});
