import { getDatabot } from "../bot";
import { defaultSocialDeps, dispatchSocialDaily } from "./social";

/**
 * Точка входа 15-минутного тикера (instrumentation.ts) для того, что «Цифры
 * команды» присылают фаундерам сами: снимок Telegram-канала и вопрос про
 * Instagram в 21:00 МСК. Без DATABOT_TOKEN — absent: бота в окружении нет.
 */
export async function dispatchFounderReports(now = new Date()): Promise<{ status: "absent" | "done"; done?: string[] }> {
  const bot = getDatabot();
  if (!bot) return { status: "absent" };
  if (!bot.isInited()) await bot.init();
  const done = await dispatchSocialDaily(defaultSocialDeps(bot.api), now);
  return { status: "done", done };
}
