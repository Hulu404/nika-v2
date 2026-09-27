/**
 * Защита dev-режима от боевого токена. Long-polling снимает вебхук: запусти
 * `npm run databot:dev` с боевым токеном — и бот команды замолчит в проде,
 * пока жив локальный процесс.
 *
 * Признак боевого бота — вебхук на прод-домен (или на хост из
 * NEXT_PUBLIC_APP_URL, если это не localhost).
 */
const PROD_HOSTS = ["www.mynika.online", "mynika.online"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

export function isProdWebhook(webhookUrl: string, appUrl?: string): boolean {
  if (!webhookUrl) return false;

  const hosts = new Set(PROD_HOSTS);
  const appHost = hostOf(appUrl);
  if (appHost && !LOCAL_HOSTS.has(appHost)) hosts.add(appHost);

  const host = hostOf(webhookUrl);
  // Нечитаемый адрес вебхука — не угадываем, считаем боевым.
  if (!host) return true;
  return hosts.has(host);
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}
