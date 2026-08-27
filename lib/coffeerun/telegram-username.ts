/**
 * Нормализация ника Telegram. Контакт на кофе-ране теперь строго телеграм —
 * значит по нику мы должны находить заявку, а для этого он должен храниться в
 * ОДНОМ виде: нижний регистр, без «@», без ссылки.
 *
 * Правила Telegram: 5–32 символа, латиница/цифры/подчёркивания, первый символ —
 * буква, последний — не подчёркивание.
 */
const USERNAME_RE = /^[a-z][a-z0-9_]{3,30}[a-z0-9]$/;

/**
 * Приводит ввод к канону или возвращает null, если это не ник Telegram.
 * Принимает «@nick», «nick», «t.me/nick», «https://telegram.me/nick».
 */
export function normalizeTelegramUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\//, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
    .trim();

  return USERNAME_RE.test(cleaned) ? cleaned : null;
}

/** Ник в виде, пригодном для показа человеку. */
export function formatTelegramUsername(username: string): string {
  return `@${username}`;
}
