# Örtü — Chrome eklentisi

Yapay zeka sitelerine **yazdığın ve yapıştırdığın kişisel verileri, tarayıcıdan
çıkmadan** maskeler. Bütün analiz sayfanın içinde, yerelde çalışır: **ağ isteği
yok**, hiçbir şey sunucuya gitmez.

> **Durum:** çalışan iskelet (v0.1.0). Chrome Web Store'a yüklenmedi, elle
> "paketlenmemiş öğe" olarak kurulur. Aşağıdaki **Bilinen sınırlar** bölümünü
> okumadan güvenme.

Bu depo [perde-chrome](https://github.com/ersancetin/perde-chrome) mimarisi örnek
alınarak sıfırdan kuruldu. Kod, motor ve sözlükler bu depoya ait; ortak olan
yaklaşım: iki koruma noktası, saf karar katmanı ve kapalı shadow DOM.

## İki koruma noktası

Verinin dışarı çıkabileceği iki an var. İkisi ayrı ayrı ayarlanır, popup'taki
şerit hangisinin açık olduğunu tek bakışta söyler.

### 1. Gönderim koruması (en önemlisi)

`Enter`'a bastığında veya gönder düğmesine tıkladığında gönderim durur ve ne
maskeleneceğini gösteren tek bir pencere açılır:

```
 ⬤ Örtü  gönderim kontrolü                                ✕

  5   3 Kişi, TC Kimlik, IBAN +2
      Tümü maskelenecek        tümünü maskele · tümünü açık bırak

 ☑  Ada Yılmaz
    Kişi        ▬▬▬▬▬ %90                                 KISI
 ☑  10000000146
    TC Kimlik   ▬▬▬▬▬ %95                            TC_KIMLIK
 ☑  Örnek Mahallesi Çınar Sokak No: 5 Düzce
    Adres       ▬▬▬▬▭ %85                                ADRES

 ▾ Gidecek metin
   Müvekkilim [KISI_1] (TC [TC_KIMLIK_1]), [ADRES_1] adresinde
   ikamet ediyor. IBAN [IBAN_1], tel [TELEFON_1]

 Ayarlar                    Maskesiz gönder    Maskele ve gönder
```

Yukarıdaki veriler kurgusaldır.

**Gidecek metin** bloğu son kontroldür: yapay zekâya tam olarak ne ulaşacağını
gösterir. Bir satırın işaretini kaldırdığın anda blok yeniden hesaplanır, o veri
üstü çizili görünür ve kırmızı **açık gidecek** uyarısı alır. Yani göndermeden
önce hem "ne bulundu" hem "ne gidiyor" listesini görürsün.

**Neden gönderim anı?** Elle yazdığın veri yalnızca buradan geçer ve veri tam o
an gerçekten dışarı çıkar. Alternatifi, yazarken metni anında yeniden yazmaktı;
o yol imleci kaydırıyor ve ProseMirror/Lexical gibi editörlerin durumunu bozuyor.
Gönderim anında durdurmak hem daha güvenli (denetlenmeden hiçbir şey çıkamaz)
hem daha az müdahaleci (yazarken hiç karışılmaz).

| Mod | Davranış |
| --- | --- |
| **Önce sor** *(varsayılan)* | Gönderim durur, panelde onaylarsın. En güvenli. |
| **Otomatik** | Sormadan maskeler ve gönderir, köşede kısa bildirim çıkar. |
| **Kapalı** | Gönderime karışılmaz. |

Paneldeki **Ayarlar** düğmesi maskeleme stilini **panelin içinde** açar; değişiklik
"gidecek metin" önizlemesine anında yansır. Sayfadan ayrılmak gerekmiyor.

### 2. Yapıştırma koruması

`paste` olayı yakalanır, panodaki metin **sayfaya girmeden** analiz edilir.
Kişisel veri varsa yapıştırma durur ve aynı panel açılır.
Modlar: **Önce sor** (varsayılan) · **Sessiz** (sormadan maskeler, "geri al"
çıkar) · **Kapalı**.

### Ayrıca

- **Yazarken rozet.** Elle yazdığın metni arka planda tarar (600 ms gecikmeyle)
  ve alanın yanında `⬤ 3 · Kişi, TC Kimlik` gibi bir rozet gösterir. Metne
  dokunmaz. Tıklayınca panel açılır.
- **Sağ tık menüsü.** Bir alana sağ tıklayıp *Örtü: bu alanı maskele*, ya da
  seçili metne sağ tıklayıp *Örtü: token'ları çöz*. Aynı işler `Alt`+`Shift`+`M`
  ve `Alt`+`Shift`+`D` kısayollarıyla da yapılır.
- **Cevabı geri çözme.** Varsayılan stil geri çevrilebilir token üretir
  (`[KISI_1]`). Yapay zekânın cevabını seçip `Alt`+`Shift`+`D` dersen gerçek
  değerlere döner. Veri dışarı çıkmaz ama cevap okunur kalır.
- **"Dene" alanı.** Popup'ta metni yaz (ya da *Örnek metin doldur*). Mevcut
  ayarlarla neyin yakalandığını, maskeli halini ve daha geniş bir kapsamın ne
  ekleyeceğini gösterir. "Neden maskelemedi?" sorusunun cevabı burada.

## GitHub'a yükleme

Depo git geçmişiyle birlikte geliyor (`v0.1.0` ilk sürüm, `v0.2.0` hata avı).
Kendi hesabında boş bir depo açıp:

```
git remote add origin git@github.com:KULLANICI/ortu-chrome.git
git push -u origin main --tags
```

CI (`.github/workflows/ci.yml`) her push'ta birim testlerini, DOM testlerini ve
ikonların depodakiyle aynı üretildiğini denetler.

## Kurulum

```
git clone <bu-depo> ortu-chrome
cd ortu-chrome
npm test          # 63 birim testi, bağımlılık yok
```

Chrome'da: `chrome://extensions` → **Geliştirici modu** aç → **Paketlenmemiş öğe
yükle** → bu klasörü seç. Build adımı yok; `engine/` ve `icons/` depoda hazır.

İkonları yeniden üretmek için `npm run icons` (bağımlılık gerekmez, PNG elle
kodlanır).

## Ayarlar

| Ayar | Seçenekler | Varsayılan |
| --- | --- | --- |
| **Gönderirken** | Önce sor · Otomatik · Kapalı | Önce sor |
| **Yapıştırınca** | Önce sor · Sessiz · Kapalı | Önce sor |
| **Kapsam** | Dar · Dengeli · Tümü | Dengeli |
| **Maskeleme stili** | `[KISI_1]` · `<Kişi>` · `****` | `[KISI_1]` |
| **Yazarken de uyar** | açık / kapalı | açık |
| **Site** | site site açılıp kapatılabilir | hepsi açık |

### Kapsam profilleri

Kapsam **artan** sırada: `dar ⊂ dengeli ⊂ tumu`. Bir test bu içerme ilişkisini
denetliyor. Profil adı kapsamı dürüst anlatmalı; bir gizlilik aracında isim,
korumayı olduğundan geniş göstermemeli — bu yüzden en dar profilin adı "Dar",
"Güvenli" değil.

- **Dar** — yalnızca biçiminden tanınan kesin kimliklendiriciler: TC, vergi no,
  pasaport, telefon, e-posta, IBAN, kart, plaka, IP, MAC.
  **İsim, adres ve kurum maskelenmez.**
- **Dengeli** *(varsayılan)* — dar profildeki her şey, ayrıca kişi adı, kurum,
  yer, adres, sağlık verisi ve dosya numarası.
- **Tümü** — hepsi. Bağlantı, tarih, tutar, meslek, yaş dahil. En kapsamlı ama en
  çok yanlış alarm veren seçenek.

Dengeli profilin dışarıda bıraktığı iki grup: `URL`/`TARIH` (genel metinde
sürekli tetiklenir, tek başına kimseyi işaret etmez) ve zayıf niteleyiciler
`YAS`/`MESLEK`/`TUTAR`.

## Hangi sitelerde çalışır

`chatgpt.com`, `chat.openai.com`, `claude.ai`, `gemini.google.com`,
`aistudio.google.com`, `copilot.microsoft.com`, `perplexity.ai`, `grok.com`,
`chat.mistral.ai`, `chat.deepseek.com`, `huggingface.co/chat`.

Bilerek `<all_urls>` istenmiyor ve bir test bunu denetliyor. Sebep sadece mağaza
incelemesi değil: kullanıcının kendi bankasında yazdığı veriyi maskelemek
anlamsız, çünkü veri zaten ait olduğu yere gidiyor. Eklentinin tezi şu: veriyi
**üçüncü taraf bir yapay zekâya** taşırken koru.

Başka site eklemek istersen izin çalışma anında istenir ve content script o
origin için dinamik kaydedilir (`chrome.storage.local` → `extraSites`).

## Gizlilik

- Bütün analiz content script içinde, yerelde çalışır. **Ağ isteği yok** — bir
  test kaynak dosyalarda `fetch`/`XMLHttpRequest`/`sendBeacon` olmadığını
  denetliyor.
- Token → gerçek değer haritası `chrome.storage.session` içinde tutulur:
  **yalnızca bellekte**, diske yazılmaz, tarayıcı kapanınca silinir, popup'tan
  temizlenebilir.
- Kalıcı depoda (`chrome.storage.local`) yalnızca `settings`, `maskedTotal` ve
  `extraSites` var. Bir test başka anahtar yazılmadığını denetliyor. Sayaç
  yalnızca *kaç veri maskelendi* toplamını tutar, içerik saklanmaz.
- Şifre alanlarına (`input[type=password]`) hiç dokunulmaz.
- Panel **kapalı** shadow root içinde (`mode: 'closed'`). Content script'ler
  yalıtık dünyada çalıştığı için sayfa `attachShadow`'u ele geçiremiyor; kapalı
  root, sayfanın panelde görünen kişisel veriyi okumasını gerçekten engelliyor.
- Hiçbir kaynak dosya konsola yazmıyor; konsol kişisel verinin en kolay sızdığı
  yer ve bunu da bir test denetliyor.
- **Tek istisna:** çözülmüş metni panoya kopyalama. Bunu sen istiyorsun ve
  gereklidir, ama pano başka uygulamalara açıktır; ortak bilgisayarda dikkat.

## Bilinen sınırlar

- **Tespit eksik kalabilir.** Motor kural ve sözlük tabanlı. Sözlükler bilerek
  küçük ve denetlenebilir tutuldu; listede olmayan bir ad, ipucu sözcüğü de
  yoksa yakalanmaz. **Kaçan bir kimliklendirici yine sızar** — panel listesini
  kendin de gözden geçir.
- **Maskelemek anonimleştirmek değildir.** İsimler maskeli olsa bile olayın
  anlatısı kişiyi tanınabilir kılabilir. Bu araç KVKK uyumluluğu garanti etmez.
- **Olay yakalama `window` üzerinde ve capture fazında; content script
  `document_start` ile yükleniyor.** ChatGPT gibi editörler Enter'ı `window` +
  capture fazında yakalayıp `stopImmediatePropagation` çağırıyor; dinleyici
  `document` üzerinde olduğunda sıra hiç gelmiyor ve mesaj maskelenmeden gidiyor.
  Aynı hedef ve fazda sıralama kayıt sırasına göre olduğu için sayfanın kendi
  betiğinden önce kaydolmak gerekiyor.
- **Gönderim koruması Enter ve tanıdığı gönder düğmelerini kapsar.** Düğme
  eşleştirmesi `data-testid`, `aria-label` ve `type=submit` kalıplarına bakar;
  tanımadığı düğmeye karışmaz. Bir site arayüzünü değiştirirse o yol atlanabilir,
  bu yüzden Enter yolu birincil.
- **Gönderim yeniden tetiklenemezse mesaj gitmez, kaybolmaz.** Maskeli metin
  alanda hazır bekler ve "göndermek için Enter'a bas" bildirimi çıkar. Analiz
  `preventDefault`'tan önce çalışır: metin temizse veya motor hata verirse
  gönderim hiç kesilmez. Kullanıcının mesajını rehin almıyoruz.
- **Zengin metin kaybolur.** Yapıştırma `text/plain` olarak yeniden yazıldığı
  için biçimlendirme düşer.
- **Metin yazma yöntemi kırılgan.** `document.execCommand('insertText')`
  kullanılıyor; deprecated ama React/ProseMirror/Lexical'ın duyduğu input
  olaylarını doğru üreten tek güvenilir yol. Native setter yedeği var, yine de
  bir editör güncellemesi bunu bozabilir.
- **Sürükle bırak yakalanmıyor.** Yalnızca `paste` denetlenir, `drop` denetlenmez.
- **Yalnızca üst çerçeve.** `all_frames: false`, iframe içindeki editörler kapsam
  dışı.
- **Dosya yükleme kapsam dışı.** Siteye dosya olarak eklenen belge denetlenmez.
- **DOM testleri jsdom'da koşuyor, gerçek Chromium'da değil.** Olay sırası,
  capture fazı ve panel akışı doğrulanıyor; `execCommand('insertText')`in React
  ve ProseMirror üzerindeki gerçek etkisi doğrulanamıyor. O katman hâlâ elle
  deneniyor, Playwright tabanlı e2e yol haritasında.

## Mimari

```
manifest.json           MV3, sabit yapay zeka sitesi allowlist'i
engine/dictionaries.js  Ad, şehir, kurum, adres ve sağlık sözlükleri + etiketler
engine/patterns.js      Biçimden tanınan veriler + sağlama doğrulayıcıları
engine/detect.js        İki katmanı birleştirir, çakışmaları çözer
engine/tokenize.js      Token üretimi ve geri çözme
src/policy.js           Saf karar mantığı: profiller, modlar, ayar göçü, maskeleme
src/ui.js               Panel, rozet, bildirim — kapalı shadow DOM içinde yalıtılmış
src/content.js          Gönderim koruması, yapıştırma koruması, yazarken rozet
src/background.js       Service worker: token haritası, menü, kısayol, sayaç
src/popup.html/.js      Ayarlar ve "Dene" alanı
tools/make-icons.js     Bağımlılıksız PNG ikon üretici
test.js                 Birim testleri
```

Katmanlar arasındaki sınır bilinçli: `policy.js` ve `engine/` DOM'a ve `chrome.*`
API'lerine hiç dokunmaz. Bu yüzden node içinde doğrudan yüklenip test edilebiliyor
ve eklentinin en çok test edilen yeri orası.

### Motor neden bu depoda?

`engine/` bu depoya ait ve commit'li: `git clone` yeter, build adımı yok. Motoru
büyütmek isteyen `dictionaries.js` içindeki setlere ekleme yapar; `detect.js`
mantığı aynı kalır.

## Test

```
npm test              # 63 birim testi, bağımlılık yok
npm i -D jsdom
npm run test:dom      # 32 DOM testi
```

**Birim testleri** (`test.js`): sağlama doğrulayıcıları (TC, IBAN, Luhn, VKN),
tespit davranışı, indis değişmezi, çakışma çözme, token round-trip, profil
içerme ilişkisi, ayar göçü, koruma özeti, site kapsamı, maskeleme stilleri,
manifest ↔ dosya bütünlüğü, popup.html ↔ popup.js eşleşmesi ve gizlilik
denetimleri (ağ isteği yok, konsol yok, kalıcı depoda kişisel veri yok, panel
kapalı shadow root'ta).

**DOM testleri** (`tools/dom-test.js`, jsdom gerektirir): gönderim korumasının
bütün yolları (temiz mesaj geçer, kirli mesaj durur, maskeli gider, maskesiz
gönder, iptal, Shift+Enter, IME, gönder düğmesi, otomatik mod, kapalı mod,
**olayı tüketen editörde** — ChatGPT davranışı — gönderimin yine kesilmesi),
gidecek metin önizlemesinin canlılığı, yapıştırma koruması, contenteditable,
şifre alanı, panel içi stil değişikliği, Esc, yazarken rozet, token çözme ve
ayrı bir **sızıntı denetimi**: 5 gerçek değer tek tek aranıp giden metinde,
önizlemede, sayfanın okuyabildiği DOM'da, kalıcı depoda ve konsolda
bulunmadığı doğrulanıyor.

## Lisans

MIT, bkz. [LICENSE](LICENSE).
