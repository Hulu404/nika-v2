/**
 * Тест-режим Telegram-уведомлений: подключить бота можно только этим юзерам.
 * Остальные видят кнопку как «soon» и не могут заминтить токен привязки.
 *
 * База — фиксированный список. Дополнительно можно расширить через env
 * TELEGRAM_TEST_ALLOWLIST (email через запятую), не трогая код. Когда бот
 * выходит из теста — снять гейт (вернуть кнопку всем и убрать проверку в
 * /api/telegram/link), либо оставить allowlist пустым эффектом.
 */
const BASE_ALLOWLIST = ["bnayat@mail.ru", "ceo@mynika.ru"];

function allowSet(): Set<string> {
  const extra = (process.env.TELEGRAM_TEST_ALLOWLIST ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...BASE_ALLOWLIST, ...extra]);
}

/** Разрешено ли пользователю подключать Telegram в текущем тест-режиме. */
export function isTelegramAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  return allowSet().has(email.trim().toLowerCase());
}
