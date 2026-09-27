/**
 * Экранирование для Telegram HTML. Все ответы бота идут с parse_mode HTML, и
 * любое динамическое значение (имя, ник, подпись метки) проходит через эту
 * функцию: в имени участника вполне может оказаться «<», «>» или «&».
 */
export function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
