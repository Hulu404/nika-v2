import { getTeamBot, TEAM_COMMANDS } from "./bot";
import { teamBotConfigured } from "./config";
import { publicOriginFromEnv } from "../public-origin";

/**
 * Регистрация вебхука командного бота при старте приложения — по образцу
 * lib/telegram/ensure-webhook.ts и ровно по той же причине: бот, которого надо
 * «не забыть подключить руками», однажды обязательно молчит, и замечают это в
 * день забега.
 *
 * Отличия от основного: свой токен (TEAM_BOT_TOKEN), свой секрет
 * (TEAM_WEBHOOK_SECRET) и свой путь. Разные секреты — не педантизм: один и тот
 * же секрет на двух вебхуках означает, что апдейты одного бота примет роут
 * другого, а дальше пойдут «чужие» команды с чужими правами.
 *
 * Переменных нет — не ошибка, а «командного бота в этом окружении нет».
 * Молча пропускаем: приложение и основной бот к нему не привязаны.
 */
export interface EnsureTeamWebhookResult {
  status: "registered" | "skipped" | "failed";
  detail?: string;
}

export async function ensureTeamWebhook(): Promise<EnsureTeamWebhookResult> {
  const secret = process.env.TEAM_WEBHOOK_SECRET;
  const origin = publicOriginFromEnv();

  if (!teamBotConfigured() || !origin || !secret) {
    const missing = [
      !teamBotConfigured() && "TEAM_BOT_TOKEN",
      !origin && "NEXT_PUBLIC_APP_URL",
      !secret && "TEAM_WEBHOOK_SECRET",
    ].filter(Boolean);
    return { status: "skipped", detail: `env не задан: ${missing.join(", ")}` };
  }

  const target = `${origin}/api/telegram/team-webhook`;

  try {
    const bot = getTeamBot();
    if (!bot.isInited()) await bot.init();
    await bot.api.setWebhook(target, {
      secret_token: secret,
      // Командный бот читает только текст и нажатия — на остальное он всё
      // равно не реагирует, и незачем гонять это через сеть.
      allowed_updates: ["message", "callback_query"],
    });
    // Меню команд ставим здесь же: оно должно приезжать вместе с кодом, а не
    // настраиваться руками в BotFather после каждой новой команды.
    await bot.api.setMyCommands(TEAM_COMMANDS).catch((err) => {
      console.warn("[team] setMyCommands:", err instanceof Error ? err.message : String(err));
    });
    return { status: "registered", detail: target };
  } catch (err) {
    return { status: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
