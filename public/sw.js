// Service Worker для NIKA PWA.
// fetch-обработчик обязателен для критерия установки на Android.
self.addEventListener('fetch', () => {});

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
