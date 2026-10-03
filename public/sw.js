// Service Worker для NIKA PWA.
// fetch-обработчик обязателен для критерия установки на Android.
// CACHE_VERSION поднимается перед каждым деплоем правок вёрстки (docs/bottom-gap-log.md):
// новая версия воркера сразу активируется и стирает старые кэши.
const CACHE_VERSION = 'nika-bottom-gap-1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// HTML и манифест: network-first, кэш только на случай офлайна. Остальное идёт в сеть как раньше.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isDoc = req.mode === 'navigate' || url.pathname === '/app/index.html' || url.pathname.endsWith('.webmanifest');
  if (!isDoc) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || Response.error()))
  );
});

// ── Push-уведомления ──────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  let data = { title: 'НИКА', body: 'Напоминание от НИКИ', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/apple-touch-icon.png',
      badge: '/favicon-32x32.png',
      tag: 'nika-push',
      renotify: true,
      data: { url: data.url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
