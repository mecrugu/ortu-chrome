# Değişiklik günlüğü

## 0.2.0 — hata avı

DOM katmanı için jsdom tabanlı bir test takımı yazıldı (`npm run test:dom`) ve
tüm kod bir kez daha okundu. Bulunan 14 hata aşağıda; her biri için bir gerileme
testi eklendi. Birim testi 56 → 63, DOM testi 0 → 32.

### Sızıntıya yol açan hatalar

- **Sağlaması tutmayan TC/IBAN/kart sessizce eleniyordu.** Doğrulayıcı
  başarısız olduğunda skor `score * 0.5` ile hesaplanıyor ve varsayılan 0.40
  eşiğinin altına düşüyordu; yazım hatalı bir TC kimlik numarası kullanıcıya
  hiç gösterilmeden gidiyordu. Artık her tanıyıcının açık bir `invalid` skoru
  var: yüksek riskli biçimler eşiğin üstünde kalıp panelde düşük güven
  çubuğuyla görünüyor, gürültülü türler (vergi no, IP) eleniyor.
- **Telefon kalıbı kart numarasının içinde eşleşiyordu.** Başında rakam sınırı
  olmadığı için 16 haneli bir kart numarasının ortasından bir parça "telefon"
  diye etiketleniyordu; sağlaması tutmayan kart da elendiği için numaranın
  tamamı hiç maskelenmiyordu. Kalıba `(?<![\d+])` ve `(?!\d)` eklendi.
- **Adres bulgusunun indisleri `indexOf` ile geri aranıyordu.** Aynı metin daha
  erken geçtiğinde indis kayıyor ve maskeleme yanlış yerden kesiyordu, yani
  gerçek veri maskeli metinde kalıyordu. Sınırlar artık doğrudan kaydırılıyor.
  Kurum bulgusunda da aynı kayma vardı (`trim()` sonrası indis düzeltmesi
  eksikti). `value === text.slice(start, end)` değişmezini denetleyen bir test
  eklendi.
- **Gönder düğmesi yolu yalnızca `lastTyped` alanına bakıyordu.** Kullanıcı
  metni yapıştırıp hiç yazmadan düğmeye tıkladığında alan bulunamıyor ve
  gönderim hiç denetlenmeden çıkıyordu. Artık odaktaki alan ve düğmenin
  çevresindeki editör de aranıyor.
- **`btn.type` özelliği sayfadaki her düğmeyi gönder düğmesi sayıyordu.**
  Nitelik yazılmamış her `<button>` için bu özellik `"submit"` döner; "kopyala"
  ve "yeni sohbet" düğmeleri de gönderim koruması tetikliyordu. Artık
  `getAttribute('type')` okunuyor.
- **`ortuMigrate` iç içe nesneleri paylaştırıyordu.** `ORTU_DEFAULTS` sığ
  yayıldığı için ayarı olmayan her çağrı aynı `perSite` ve `disabledEntities`
  nesnesini alıyordu; bir sitede yapılan kapatma her yere sızıyordu.

### Kullanılamayan ya da bozuk arayüz

- **Rozet görünüyor ama tıklanamıyordu.** Tıklama önce metin alanını
  bulanıklaştırıyor, `blur` dinleyicisi rozeti kaldırıyor ve `click` hiç
  ateşlenmiyordu. Rozetin `mousedown` olayı artık iptal ediliyor.
- **"Bu siteyi ekle" satırı hiç görünmüyordu.** `refreshAddRow()` tanımlıydı ama
  hiçbir yerden çağrılmıyordu; allowlist dışındaki bir sitede eklentiyi açmanın
  yolu yoktu.
- **`[hidden]` niteliği çalışmıyordu.** `.row { display: flex }` yazar stili
  tarayıcının `[hidden] { display: none }` kuralını eziyordu; gizlenmesi gereken
  satır her zaman görünüyordu.
- **Uzun bulgu listesinde gönder düğmeleri ekranın dışında kalıyordu.** Panelin
  gövdesi flex çocuğuydu ve `min-height: 0` verilmemişti.
- **Token çözme paneli maskeleme paneli gibi görünüyordu.** Çözülmüş gerçek
  veriyi listeliyor, birincil düğmede "Maskele ve gönder" yazıyor ama panoya
  kopyalıyordu. Ayrı bir `decode` görünümü eklendi: liste ve "maskesiz gönder"
  gizli, tek düğme "Panoya kopyala".
- **Gönderim yeniden tetiklenemediğinde yedek yol atlanıyordu.** Olay iptal
  edildiğinde sayfanın mesajı gönderdiği varsayılıyordu; düğme pasifse mesaj
  sessizce asılı kalıyordu. Denetim artık her durumda yapılıyor.
- **`isEditable` iç düğüm odaklandığında yanlış cevap veriyordu.** Editörler
  çoğu zaman `contenteditable` kökünün içindeki bir düğümü odaklıyor; artık üst
  elemanlar da taranıyor ve metin düğümleri eleniyor.
- **`setSelectionRange` bazı input tiplerinde istisna atıyordu** (`email`,
  `url`); maskeli metin yazılamıyordu.

### Ayrıca

- Sözlük regexleri her çağrıda yeniden derleniyordu (81 il + 24 sağlık terimi +
  14 meslek). Yazarken tarama her 600 ms'de bir çalıştığı için uzun metinde
  gözle görülür takılma yapıyordu; artık bir kez derleniyor. Açık tür kümesi de
  yalnızca ayar değişince yeniden kuruluyor.
- Popup'taki sayaç arka planda artarken güncellenmiyordu.
- `panel KAPALI shadow root ile açılıyor` testi paneli hiç açmadan denetim
  yapıyor ve `null` üzerinden patlıyordu.

## 0.1.0 — ilk sürüm

İlk çalışan iskelet. Mimari [perde-chrome](https://github.com/ersancetin/perde-chrome)
örnek alınarak kuruldu; kod ve motor bu depoya ait.

- Gönderim koruması: `Enter` ve tanınan gönder düğmeleri, üç mod (önce sor ·
  otomatik · kapalı).
- Yapıştırma koruması: `paste` olayı, üç mod (önce sor · sessiz · kapalı).
- Yazarken rozet: metne dokunmadan ne bulunduğunu gösterir.
- Kapalı shadow DOM içinde panel, "gidecek metin" canlı önizlemesi, panel içi
  stil ayarı.
- Kural + sözlük tabanlı Türkçe tespit motoru: 21 tür, sağlama doğrulaması olan
  TC / IBAN / kart / VKN / IPv4.
- Geri çevrilebilir token stili ve `Alt`+`Shift`+`D` ile cevabı çözme.
- Popup: ayarlar, koruma özeti şeridi ve "Dene" alanı.
- Bağımlılıksız PNG ikon üretici.

İlk sürümde yakalanan iki hata: ad tespiti cümle başındaki büyük harfli sözcüğe
takılıyordu ("Müvekkilim Ada Yılmaz"), vergi numarası sağlamasında kalanı sıfır
olan basamak yanlış hesaplanıyordu.

## Yol haritası

- Playwright ile gerçek Chromium testleri; jsdom `execCommand`'ın React ve
  ProseMirror üzerindeki etkisini doğrulayamıyor.
- `drop` olayının denetlenmesi (bugün yalnızca `paste` denetleniyor).
- Sözlüklerin genişletilmesi ve yanlış alarm ölçümü için bir holdout seti.
