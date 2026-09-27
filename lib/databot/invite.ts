/**
 * Приглашения: одноразовый токен из 32 hex-символов, живёт 48 часов. Зона
 * задаётся в момент приглашения — поэтому нет гонки «кто первым вошёл, тот и
 * владелец», а утёкшая ссылка срабатывает один раз.
 */
export const INVITE_TTL_MS = 48 * 60 * 60 * 1000;
export const INVITE_PREFIX = "inv_";
const TOKEN_RE = /^[0-9a-f]{32}$/;

/**
 * 16 случайных байт = 128 бит. Web Crypto, а не node:crypto: instrumentation.ts
 * собирается и под edge, а webpack Next не понимает схему «node:» — импорт
 * ронял сборку через цепочку ensure-webhook → bot → pipeline → invite.
 */
export function newInviteToken(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function inviteExpiresAt(now: Date): string {
  return new Date(now.getTime() + INVITE_TTL_MS).toISOString();
}

export function inviteLink(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${INVITE_PREFIX}${token}`;
}

/** Токен из payload команды /start, если это приглашение правильного вида. */
export function inviteTokenFromStart(payload: string | undefined | null): string | null {
  const p = payload?.trim() ?? "";
  if (!p.startsWith(INVITE_PREFIX)) return null;
  const token = p.slice(INVITE_PREFIX.length).toLowerCase();
  return TOKEN_RE.test(token) ? token : null;
}
