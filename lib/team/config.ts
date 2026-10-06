/**
 * Переменные окружения командного бота — в одном месте.
 *
 * Отдельным файлом, а не внутри bot.ts, ради развязки импортов: рассылка
 * сводок должна уметь спросить «а бот вообще настроен?», не втягивая за собой
 * весь бот, — иначе выходит кольцо bot → digest → send → bot. Кольца в ESM
 * обычно работают, но ломаются ровно тогда, когда модуль читают на этапе
 * загрузки, и отлаживать это в проде не хочется.
 */

/** Токен командного бота. Отдельный — это другой бот в BotFather. */
export function teamToken(): string {
  const t = process.env.TEAM_BOT_TOKEN;
  if (!t) throw new Error("TEAM_BOT_TOKEN не задан");
  return t;
}

/** Есть ли вообще смысл поднимать командного бота в этом окружении. */
export function teamBotConfigured(): boolean {
  return !!process.env.TEAM_BOT_TOKEN;
}

/**
 * Фаундеры — Telegram ID из TEAM_FOUNDER_IDS через запятую. Права в боте у всех
 * равные, кроме двух вещей, которые остаются за фаундерами: /kick, правка и
 * отмена любого события, исправление уже внесённой явки.
 *
 * Список в переменной, а не роль в базе: раньше владельцем становился тот, кто
 * первым набрал /join, и права зависели от того, кто успел.
 */
export function founderIds(env: string | undefined = process.env.TEAM_FOUNDER_IDS): Set<number> {
  return new Set(
    (env ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^-?\d+$/.test(s))
      .map(Number),
  );
}

export function isFounder(chatId: number, env?: string): boolean {
  return founderIds(env).has(chatId);
}
