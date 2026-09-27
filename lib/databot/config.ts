/**
 * Переменные окружения бота данных команды — в одном месте, по образцу
 * lib/team/config.ts: модулям, которым нужно только «а бот вообще настроен?»,
 * незачем втягивать за собой весь бот.
 */

/** Токен бота данных. Это третий бот в BotFather, не командный и не основной. */
export function databotToken(): string | null {
  return process.env.DATABOT_TOKEN?.trim() || null;
}

/** Есть ли вообще смысл поднимать бота данных в этом окружении. */
export function databotConfigured(): boolean {
  return databotToken() !== null;
}
