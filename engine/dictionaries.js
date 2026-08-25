// Örtü — sözlükler
//
// Motorun kural tabanlı kısmı biçimden tanınan verileri (TC, IBAN, telefon)
// yakalar. Ad, yer ve kurum ise biçimden tanınmaz; burada tutulan sözlükler ve
// ipucu sözcükleri o boşluğu doldurur.
//
// Sözlükler bilerek küçük ve denetlenebilir. Büyük bir ad listesi recall'ı
// yükseltir ama yanlış alarmı da yükseltir; kapsamı büyütmek isteyen
// ORTU_FIRST_NAMES setine ekleme yapar, geri kalan mantık aynı kalır.

const ORTU_FIRST_NAMES = new Set([
    'ada', 'adem', 'ahmet', 'ali', 'alper', 'arda', 'asya', 'aslı', 'ayşe', 'aylin',
    'ayla', 'aynur', 'bahar', 'barış', 'batuhan', 'berk', 'berkay', 'beril', 'betül',
    'bilge', 'burak', 'buse', 'büşra', 'canan', 'cem', 'cemal', 'ceren', 'cihan',
    'defne', 'deniz', 'derya', 'dilek', 'doğan', 'duygu', 'ebru', 'ece', 'eda',
    'efe', 'elif', 'emel', 'emin', 'emine', 'emre', 'enes', 'eren', 'esra', 'ezgi',
    'fatih', 'fatma', 'ferhat', 'feride', 'figen', 'filiz', 'furkan', 'gamze',
    'gizem', 'gökhan', 'gül', 'gülay', 'gülsüm', 'günay', 'hakan', 'halil', 'hande',
    'hasan', 'hatice', 'hüseyin', 'ibrahim', 'ilker', 'ilknur', 'irem', 'ismail',
    'kaan', 'kadir', 'kemal', 'kerem', 'kıvanç', 'levent', 'leyla', 'mahmut',
    'melek', 'melis', 'meltem', 'meral', 'merve', 'mehmet', 'mert', 'mine', 'murat',
    'mustafa', 'müge', 'naz', 'nazlı', 'nehir', 'nesrin', 'nihal', 'nur', 'nuray',
    'okan', 'oğuz', 'onur', 'orhan', 'osman', 'ozan', 'özge', 'özgür', 'özlem',
    'pelin', 'pınar', 'rabia', 'ramazan', 'recep', 'rüya', 'sabri', 'sadık',
    'salih', 'sema', 'selin', 'selim', 'serap', 'serkan', 'sevgi', 'sevil', 'sibel',
    'sinem', 'sinan', 'songül', 'suat', 'şafak', 'şebnem', 'şenol', 'şeyma',
    'tarık', 'tolga', 'tuba', 'tuğba', 'tuğçe', 'ufuk', 'umut', 'utku', 'ülkü',
    'ümit', 'veli', 'volkan', 'yağmur', 'yasemin', 'yavuz', 'yiğit', 'yusuf',
    'zehra', 'zeynep', 'ziya',
]);

// Ad ipucu veren sözcükler: sözlükte olmayan adları da yakalamayı sağlar.
// "Müvekkilim Ada Yılmaz" → sözlükten; "Sn. Kevork Bezciyan" → ipucundan.
const ORTU_NAME_CUES = [
    'sayın', 'sn', 'bay', 'bayan', 'müvekkil', 'müvekkilim', 'müvekkili',
    'davacı', 'davalı', 'sanık', 'mağdur', 'tanık', 'hasta', 'öğrenci',
    'adı', 'ismi', 'adına', 'imzalayan', 'yetkili', 'kişi', 'dr', 'av', 'prof',
];

// 81 il. Yer tespitinin çekirdeği; ilçe ve mahalle adları adres bloğu
// kuralıyla (mahallesi/sokak/cadde ipuçları) yakalanır.
const ORTU_CITIES = new Set([
    'adana', 'adıyaman', 'afyonkarahisar', 'ağrı', 'aksaray', 'amasya', 'ankara',
    'antalya', 'ardahan', 'artvin', 'aydın', 'balıkesir', 'bartın', 'batman',
    'bayburt', 'bilecik', 'bingöl', 'bitlis', 'bolu', 'burdur', 'bursa',
    'çanakkale', 'çankırı', 'çorum', 'denizli', 'diyarbakır', 'düzce', 'edirne',
    'elazığ', 'erzincan', 'erzurum', 'eskişehir', 'gaziantep', 'giresun',
    'gümüşhane', 'hakkari', 'hatay', 'ığdır', 'ısparta', 'istanbul', 'izmir',
    'kahramanmaraş', 'karabük', 'karaman', 'kars', 'kastamonu', 'kayseri',
    'kilis', 'kırıkkale', 'kırklareli', 'kırşehir', 'kocaeli', 'konya', 'kütahya',
    'malatya', 'manisa', 'mardin', 'mersin', 'muğla', 'muş', 'nevşehir', 'niğde',
    'ordu', 'osmaniye', 'rize', 'sakarya', 'samsun', 'siirt', 'sinop', 'sivas',
    'şanlıurfa', 'şırnak', 'tekirdağ', 'tokat', 'trabzon', 'tunceli', 'uşak',
    'van', 'yalova', 'yozgat', 'zonguldak',
]);

// Kurum adının SONUNDA duran sözcükler. "Akdeniz Üniversitesi", "Yılmaz İnşaat
// A.Ş." — soldaki büyük harfli sözcükler kuruma dahil edilir.
const ORTU_ORG_TAILS = [
    'a.ş.', 'a.ş', 'anonim şirketi', 'ltd. şti.', 'ltd. şti', 'ltd şti',
    'limited şirketi', 'üniversitesi', 'fakültesi', 'hastanesi', 'kliniği',
    'bakanlığı', 'belediyesi', 'müdürlüğü', 'başkanlığı', 'kaymakamlığı',
    'valiliği', 'mahkemesi', 'noterliği', 'bankası', 'holding', 'vakfı',
    'derneği', 'kooperatifi', 'okulu', 'lisesi', 'ortaokulu', 'ilkokulu',
    'enstitüsü', 'odası', 'birliği', 'sendikası', 'ajansı',
];

// Adres bloğunun parçaları. Bir cümlede bunlardan biri geçiyorsa çevresindeki
// metin adres olarak toplanır.
const ORTU_ADDRESS_CUES = [
    'mahallesi', 'mahalle', 'mah.', 'mah', 'sokak', 'sokağı', 'sok.', 'sk.',
    'caddesi', 'cadde', 'cad.', 'cd.', 'bulvarı', 'bulvar', 'blv.', 'apartmanı',
    'apt.', 'sitesi', 'blok', 'daire', 'kat', 'no:', 'no.',
];

// Sağlık ve KVKK açısından özel nitelikli veriye işaret eden sözcükler.
// Tek başlarına kimlik değil ama kişiyle birleşince en hassas veri bunlar.
const ORTU_HEALTH_TERMS = [
    'kanser', 'tümör', 'diyabet', 'şeker hastalığı', 'hipertansiyon', 'astım',
    'depresyon', 'anksiyete', 'şizofreni', 'bipolar', 'epilepsi', 'hepatit',
    'hiv', 'aids', 'alzheimer', 'parkinson', 'ms hastalığı', 'kemoterapi',
    'ameliyat', 'engelli raporu', 'sağlık raporu', 'reçete', 'teşhis', 'tanı',
];

// Ekran adı → kullanıcıya gösterilen etiket. Panelde ve önizlemede bu görünür.
const ORTU_LABELS = {
    KISI: 'Kişi',
    TC_KIMLIK: 'TC Kimlik',
    VERGI_NO: 'Vergi No',
    PASAPORT: 'Pasaport',
    TELEFON: 'Telefon',
    EPOSTA: 'E-posta',
    IBAN: 'IBAN',
    KREDI_KARTI: 'Kart No',
    PLAKA: 'Plaka',
    IP_ADRESI: 'IP Adresi',
    MAC_ADRESI: 'MAC Adresi',
    ADRES: 'Adres',
    YER: 'Yer',
    KURUM: 'Kurum',
    SAGLIK: 'Sağlık Verisi',
    DOSYA_NO: 'Dosya No',
    URL: 'Bağlantı',
    TARIH: 'Tarih',
    TUTAR: 'Tutar',
    YAS: 'Yaş',
    MESLEK: 'Meslek',
};

// Motorun bildiği bütün türler. policy.js profilleri bunun üzerinden kurar.
const ORTU_ALL_ENTITIES = Object.keys(ORTU_LABELS);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ORTU_FIRST_NAMES, ORTU_NAME_CUES, ORTU_CITIES, ORTU_ORG_TAILS,
        ORTU_ADDRESS_CUES, ORTU_HEALTH_TERMS, ORTU_LABELS, ORTU_ALL_ENTITIES,
    };
}
