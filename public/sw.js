// Минимальный service worker — нужен для срабатывания beforeinstallprompt на Android.
// fetch-обработчик обязателен (Chrome проверяет его наличие как часть критерия установки).
self.addEventListener('fetch', () => {});
