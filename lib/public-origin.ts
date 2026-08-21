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
export function getPublicOrigin(req: Request | { headers: { get(name: string): string | null } }): string {
  // 1. Явная переменная окружения
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) return appUrl.replace(/\/$/, "");

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
