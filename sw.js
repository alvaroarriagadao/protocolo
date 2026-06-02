const CACHE = 'protocolo-v4';
const APP_URL = '/protocolo/';

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.add(APP_URL)).then(() => self.skipWaiting())
  );
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => scheduleAllNotifications())
  );
});

// ── Fetch (cache-first) ───────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request)
      .then(r => r || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(APP_URL)))
  );
});

// ── Messages from page ────────────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data.type === 'SCHEDULE_NOTIFS') {
    scheduleAllNotifications(e.data.config);
  }
});

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      const existing = cs.find(c => c.url.includes('/protocolo'));
      if (existing) return existing.focus();
      return clients.openWindow(APP_URL);
    })
  );
});

// ── Scheduling ────────────────────────────────────────────────────────────────
let _timers = [];

function clearTimers() {
  _timers.forEach(id => clearTimeout(id));
  _timers = [];
}

async function scheduleAllNotifications(config) {
  clearTimers();

  // Read config from IndexedDB if not passed
  if (!config) config = await readConfig();
  if (!config) return;

  const sections = ['morning', 'afternoon', 'night'];
  const labels   = { morning: 'Mañana ☀️', afternoon: 'Tarde 🌤️', night: 'Noche 🌙' };
  const bodies   = {
    morning:   '¡Buenos días! Revisa tus tareas de la mañana 💊',
    afternoon: '¡A mitad del día! Tareas de la tarde pendientes 🌤️',
    night:     '¡Casi termina el día! Completa tu protocolo nocturno 🌙'
  };

  sections.forEach(k => {
    const cfg = config[k];
    if (!cfg || !cfg.on) return;

    const [h, m] = cfg.time.split(':').map(Number);
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    const ms = target - now;

    const tid = setTimeout(async () => {
      await self.registration.showNotification('Protocolo Diario — ' + labels[k], {
        body: bodies[k],
        icon: '/protocolo/icon-192.png',
        badge: '/protocolo/icon-192.png',
        tag: 'protocolo-' + k,
        renotify: true,
        requireInteraction: false,
        vibrate: [200, 100, 200]
      });
      // Reschedule for tomorrow
      const latest = await readConfig();
      scheduleAllNotifications(latest);
    }, ms);

    _timers.push(tid);
  });
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('protocolo-db', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('kv');
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => reject();
  });
}

async function readConfig() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction('kv', 'readonly');
      const req = tx.objectStore('kv').get('notifConfig');
      req.onsuccess = e => resolve(e.target.result || null);
      req.onerror   = () => resolve(null);
    });
  } catch { return null; }
}
