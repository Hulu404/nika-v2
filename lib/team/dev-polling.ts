import type { Bot, PollingOptions } from "grammy";
import { isProdWebhook } from "../databot/dev-guard";

/** Проверяем до start(): grammY удаляет вебхук при переходе на polling. */
export async function startTeamPolling(
  bot: Pick<Bot, "api" | "start">,
  options: PollingOptions = {},
): Promise<void> {
  const info = await bot.api.getWebhookInfo();
  if (isProdWebhook(info.url ?? "", process.env.NEXT_PUBLIC_APP_URL)) {
    throw new Error("Это боевой бот: polling отключит его вебхук. Используй токен отдельного тестового бота в .env.");
  }
  await bot.start({ ...options, allowed_updates: ["message", "callback_query"] });
}
