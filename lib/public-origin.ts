/**
 * Возвращает публичный origin (scheme + host) запроса.
 *
 * Railway проксирует трафик через внутренний localhost:8080, поэтому
 * req.url / request.url содержит внутренний хост, а не реальный домен.
 * Реальный хост Railway передаёт в X-Forwarded-Host, а схему — в X-Forwarded-Proto.
 *
 * Порядок приоритетов:
 *   1. NEXT_PUBLIC_APP_URL из env (явно задан — самый надёжный вариант)
 *   2. X-Forwarded-Host + X-Forwarded-Proto (Railway / любой реверс-прокси)
 *   3. Host + схема из NODE_ENV
 *   4. Жёстко зашитый дефолт "https://www.mynika.online"
 */
/**
 * Публичный origin из переменной окружения, без запроса.
 *
 * Берём ТОЛЬКО scheme+host. На проде NEXT_PUBLIC_APP_URL однажды приехала с
 * хвостом «/api/telegram/webhook»: вебхук зарегистрировался по задвоенному пути
 * и Telegram получал 404 на каждый апдейт, а кнопки «Открыть НИКУ» в сообщениях
 * бота вели в никуда. Нормализация к origin закрывает весь этот класс ошибок.
 *
 * null — если переменная не задана или не парсится как URL.
 */
export function publicOriginFromEnv(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function getPublicOrigin(req: Request | { headers: { get(name: string): string | null } }): string {
  // 1. Явная переменная окружения (нормализованная к origin)
  const fromEnv = publicOriginFromEnv();
  if (fromEnv) return fromEnv;

  const headers = "headers" in req && typeof (req as { headers: unknown }).headers === "object"
    ? (req as { headers: { get(name: string): string | null } }).headers
    : (req as Request).headers;

  // 2. Railway / nginx заголовки
  const forwardedHost = headers.get("x-forwarded-host");
  const forwardedProto = headers.get("x-forwarded-proto");
  if (forwardedHost) {
    const proto = forwardedProto ?? (process.env.NODE_ENV === "production" ? "https" : "http");
    return `${proto}://${forwardedHost}`;
  }

  // 3. Заголовок Host
  const host = headers.get("host");
  if (host) {
    const proto = process.env.NODE_ENV === "production" ? "https" : "http";
    return `${proto}://${host}`;
  }

  // 4. Дефолт
  return "https://www.mynika.online";
}
