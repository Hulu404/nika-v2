/**
 * Сеть до Yandex AI Studio: разбор сетевых ошибок и их память в процессе.
 *
 * `fetch failed` в Node (undici) прячет настоящую причину в err.cause:
 * ECONNRESET, ETIMEDOUT, ENETUNREACH, UND_ERR_SOCKET («other side closed»),
 * UND_ERR_CONNECT_TIMEOUT, EAI_AGAIN… Без неё чинить вслепую — поэтому каждая
 * сетевая ошибка пишется в лог одной строкой и в кольцевой буфер (для /ai_check).
 */

export interface NetErrorInfo {
  name: string;
  code: string | null;
  message: string;
}

/** Причина сетевой ошибки: код и сообщение из err.cause, если есть. */
export function describeNetError(err: unknown): NetErrorInfo {
  const e = err as { name?: unknown; message?: unknown; code?: unknown; cause?: { code?: unknown; message?: unknown; errno?: unknown } } | null;
  const cause = e?.cause;
  const code = typeof cause?.code === "string" ? cause.code : typeof e?.code === "string" ? e.code : null;
  const message = typeof cause?.message === "string" && cause.message ? cause.message : typeof e?.message === "string" ? e.message : String(err);
  return { name: typeof e?.name === "string" ? e.name : "Error", code, message: message.replace(/\s+/g, " ").slice(0, 300) };
}

/** Сеть оборвала уже открытое соединение: повтор — сразу и на новом. */
export const isStaleSocket = (code: string | null) => code === "ECONNRESET" || code === "UND_ERR_SOCKET" || code === "EPIPE";

export interface NetErrorRecord {
  at: number;
  host: string;
  code: string;
}

const RING_SIZE = 50;
const ring: NetErrorRecord[] = [];

export function rememberNetError(rec: NetErrorRecord): void {
  ring.push(rec);
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
}

/** Ошибки за последние ms (по умолчанию сутки) и самый частый код. */
export function recentNetErrors(now = Date.now(), ms = 24 * 3_600_000): { count: number; top: string | null } {
  const fresh = ring.filter((r) => r.at >= now - ms);
  const counts = new Map<string, number>();
  for (const r of fresh) counts.set(r.code, (counts.get(r.code) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { count: fresh.length, top };
}

/** Для тестов. */
export function resetNetErrors(): void {
  ring.length = 0;
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
