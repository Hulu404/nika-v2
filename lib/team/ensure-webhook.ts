import { getTeamBot, setTeamCommands, TEAM_COMMANDS } from "./bot";
import { listTeam } from "./access";
import { teamBotConfigured } from "./config";
import { publicOriginFromEnv } from "../public-origin";
import { rejectedRecently } from "./webhook-guard";

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

export const TEAM_ALLOWED_UPDATES = ["message", "callback_query"] as const;

/** checkFirst — проверить и при необходимости восстановить; без синхронизации меню. */
export async function ensureTeamWebhook(checkFirst: true): Promise<EnsureTeamWebhookResult | { status: "healthy" }>;
export async function ensureTeamWebhook(checkFirst?: false): Promise<EnsureTeamWebhookResult>;
export async function ensureTeamWebhook(checkFirst = false): Promise<EnsureTeamWebhookResult | { status: "healthy" }> {
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
    if (checkFirst) {
      const info = await bot.api.getWebhookInfo();
      const missingUpdates = info.allowed_updates?.length
        ? TEAM_ALLOWED_UPDATES.some((type) => !info.allowed_updates!.includes(type))
        : false;
      // Telegram хранит последнюю ошибку и после успешной доставки. Старый
      // 401 без очереди не повод регистрировать вебхук заново на каждом тике.
      const unauthorized = info.pending_update_count > 0 && /\b401\b/.test(info.last_error_message ?? "");
      // 401 возвращаем себе, только если отклонял именно этот экземпляр: иначе
      // два сервера с одним токеном перетягивают вебхук по кругу (webhook-guard.ts).
      if (info.url === target && !missingUpdates && unauthorized && !rejectedRecently()) {
        return { status: "failed", detail: `доставка: ${info.last_error_message}; апдейты приходят не сюда — вебхук не трогаю` };
      }
      if (info.url === target && !missingUpdates && !unauthorized) {
        if (info.pending_update_count > 0 && info.last_error_message) {
          return { status: "failed", detail: `доставка: ${info.last_error_message}; в очереди: ${info.pending_update_count}` };
        }
        return { status: "healthy" };
      }
    }
    if (!bot.isInited()) await bot.init();
    await bot.api.setWebhook(target, {
      secret_token: secret,
      // Командный бот читает только текст и нажатия — на остальное он всё
      // равно не реагирует, и незачем гонять это через сеть.
      allowed_updates: [...TEAM_ALLOWED_UPDATES],
      drop_pending_updates: false,
    });
    if (checkFirst) return { status: "registered", detail: target };
    // Меню команд ставим здесь же: оно должно приезжать вместе с кодом, а не
    // настраиваться руками в BotFather после каждой новой команды.
    await bot.api.setMyCommands(TEAM_COMMANDS).catch((err) => {
      console.warn("[team] setMyCommands:", err instanceof Error ? err.message : String(err));
    });
    // Старые scope=chat перекрывают общее меню. Обновляем их после деплоя.
    try {
      for (const member of await listTeam()) await setTeamCommands(bot.api, member);
    } catch (err) {
      // Ошибка меню не означает, что уже установленный вебхук не работает.
      console.warn("[team] sync member commands:", err instanceof Error ? err.message : String(err));
    }
    return { status: "registered", detail: target };
  } catch (err) {
    return { status: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
