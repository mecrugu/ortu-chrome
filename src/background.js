// Örtü — service worker
//
// Görevleri:
//   • token → gerçek değer haritasını tutmak (chrome.storage.session: yalnızca
//     bellekte, diske YAZILMAZ, tarayıcı kapanınca kaybolur)
//   • sağ tık menüsü ve klavye kısayollarını sayfaya iletmek
//   • kullanıcının eklediği ek siteler için content script'i dinamik kaydetmek
//   • yalnızca "kaç veri maskelendi" sayacını tutmak (içerik asla saklanmaz)
//
// Haritanın kalıcı olmaması bilinçli. Diske yazmak, tarayıcı yenilendikten
// sonra da çözebilmeyi sağlardı ama kişisel veriyi diske indirirdi. Oturum
// belleği bu iş için yeterli.

importScripts('/src/policy.js');

const MAP_LIMIT = 4000;      // site başına en fazla token
const SCRIPT_ID = 'ortu-extra';

const CORE_FILES = [
    'engine/dictionaries.js',
    'engine/patterns.js',
    'engine/detect.js',
    'engine/tokenize.js',
    'src/policy.js',
    'src/ui.js',
    'src/content.js',
];

// ─── Kurulum ─────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    // Sürüm yükseltmesinde eski ayarları taşı ve diske geri yaz; yoksa her
    // okumada tekrar çevirmek gerekir ve bir yerde unutulur.
    const migrated = ortuMigrate(settings);
    await chrome.storage.local.set({ settings: migrated });

    chrome.contextMenus.create({
        id: 'ortu-mask',
        title: 'Örtü: bu alanı maskele',
        contexts: ['editable'],
    }, () => void chrome.runtime.lastError);

    chrome.contextMenus.create({
        id: 'ortu-decode',
        title: 'Örtü: seçili metindeki token\'ları çöz',
        contexts: ['selection'],
    }, () => void chrome.runtime.lastError);

    registerExtraSites();
});

chrome.runtime.onStartup.addListener(registerExtraSites);

// ─── Menü ve kısayollar ──────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab || tab.id == null) return;
    send(tab.id, info.menuItemId === 'ortu-decode' ? 'ortu:decode-selection' : 'ortu:mask-field');
});

chrome.commands.onCommand.addListener(async (command) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) return;
    if (command === 'ortu-mask-field') send(tab.id, 'ortu:mask-field');
    else if (command === 'ortu-decode') send(tab.id, 'ortu:decode-selection');
});

function send(tabId, type) {
    chrome.tabs.sendMessage(tabId, { type }, () => void chrome.runtime.lastError);
}

// ─── Mesajlar ────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'ortu:store-map') {
        storeMap(msg.host, msg.entries).then(() => respond({ ok: true }));
        return true;
    }

    if (msg.type === 'ortu:get-map') {
        getMap(msg.host).then(entries => respond({ entries }));
        return true;
    }

    if (msg.type === 'ortu:clear-maps') {
        chrome.storage.session.clear().then(() => respond({ ok: true }));
        return true;
    }

    if (msg.type === 'ortu:count') {
        bump(msg.n).then(total => respond({ total }));
        return true;
    }

    if (msg.type === 'ortu:register-sites') {
        registerExtraSites().then(() => respond({ ok: true }));
        return true;
    }
});

// ─── Token haritası (oturum belleği) ─────────────────────────────────────────

function mapKey(host) {
    return 'map:' + String(host || '').toLowerCase();
}

async function storeMap(host, entries) {
    if (!host || !Array.isArray(entries) || !entries.length) return;
    const key = mapKey(host);
    const store = await chrome.storage.session.get(key);
    const merged = new Map(store[key] || []);
    for (const [token, value] of entries) merged.set(token, value);
    // Sınırı aşarsa en eskiler düşer: oturum belleği sonsuz büyümemeli.
    const trimmed = [...merged.entries()].slice(-MAP_LIMIT);
    await chrome.storage.session.set({ [key]: trimmed });
}

async function getMap(host) {
    const key = mapKey(host);
    const store = await chrome.storage.session.get(key);
    return store[key] || [];
}

// ─── Sayaç ───────────────────────────────────────────────────────────────────

async function bump(n) {
    const count = Number(n) || 0;
    if (count <= 0) return 0;
    const { maskedTotal = 0 } = await chrome.storage.local.get('maskedTotal');
    const total = maskedTotal + count;
    await chrome.storage.local.set({ maskedTotal: total });
    chrome.action.setBadgeText({ text: total > 999 ? '999+' : String(total) });
    chrome.action.setBadgeBackgroundColor({ color: '#1f7a63' });
    return total;
}

// ─── Ek siteler ──────────────────────────────────────────────────────────────
//
// Manifest'te bilerek <all_urls> istenmiyor. Sebep yalnızca mağaza incelemesi
// değil: kullanıcının kendi bankasında yazdığı veriyi maskelemek anlamsız,
// veri zaten ait olduğu yere gidiyor. Tez şu: veriyi ÜÇÜNCÜ TARAF bir yapay
// zekâya taşırken koru. Başka site eklemek isteyen izni çalışma anında verir.

async function registerExtraSites() {
    const { extraSites = [] } = await chrome.storage.local.get('extraSites');
    const matches = extraSites
        .map(h => String(h).replace(/^www\./, ''))
        .filter(Boolean)
        .map(h => 'https://*.' + h + '/*');

    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })
        .catch(() => []);

    if (!matches.length) {
        if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
        return;
    }

    const script = {
        id: SCRIPT_ID,
        matches,
        js: CORE_FILES,
        runAt: 'document_start',
        allFrames: false,
    };

    if (existing.length) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
}
