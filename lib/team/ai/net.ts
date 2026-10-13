import type { Agent as UndiciAgent } from "undici";

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

// ── Соединение с Яндексом ────────────────────────────────────────────────────
// Прерывистый «fetch failed» из-за рубежа: (а) сервер закрывает простаивающее
// keep-alive-соединение, а Node берёт его снова; (б) DNS отдаёт IPv6 без
// маршрута; (в) медленное установление соединения. Свой Agent закрывает все три:
// короткий keep-alive, IPv4 (YANDEX_FORCE_IPV4, по умолчанию да), таймаут connect.


export const forceIPv4 = (env: Record<string, string | undefined> = process.env) =>
  (env.YANDEX_FORCE_IPV4 ?? "true").trim().toLowerCase() !== "false";

export const CONNECT_TIMEOUT_MS = 10_000;

async function makeAgent(): Promise<UndiciAgent> {
  const { Agent } = await import("undici");
  return new Agent({
    keepAliveTimeout: 4_000,
    keepAliveMaxTimeout: 10_000,
    // Заголовки и тело — в пределах таймаута самого запроса (LLM — 20 с).
    headersTimeout: 20_000,
    bodyTimeout: 20_000,
    connect: { timeout: CONNECT_TIMEOUT_MS, ...(forceIPv4() ? { family: 4 } : {}) },
  });
}

let shared: Promise<UndiciAgent> | null = null;

export interface YandexFetchInit {
  method: string;
  headers: Record<string, string>;
  body: string | Uint8Array;
  signal: AbortSignal;
  /** Прошлое соединение оборвалось: открыть новое, старые сокеты не брать. */
  fresh?: boolean;
}

/** fetch из undici со своим Agent для stt.api / ai.api.cloud.yandex.net. */
export async function yandexFetch(url: string, init: YandexFetchInit) {
  if (init.fresh || !shared) {
    const old = shared;
    shared = makeAgent();
    void old?.then((a) => a.close()).catch(() => {});
  }
  const { fetch } = await import("undici");
  const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: init.signal, dispatcher: await shared });
  return { ok: res.ok, status: res.status, json: () => res.json(), text: () => res.text() };
}
