import { getDatabot } from "./bot";
import { databotToken } from "./config";
import { DATABOT_DEFAULT_COMMANDS } from "./copy";
import { createSupabaseStore } from "./data/supabase-store";
import { setChatCommands } from "./menu";
import { publicOriginFromEnv } from "../public-origin";

/**
 * Регистрация вебхука бота данных при старте прод-процесса — как
 * lib/team/ensure-webhook.ts: бот, которого надо «не забыть подключить руками»,
 * однажды молчит.
 *
 * Свой секрет DATABOT_WEBHOOK_SECRET, не равный секретам двух других ботов:
 * иначе роут одного бота принял бы апдейты другого.
 *
 * Нет DATABOT_TOKEN — статус "absent": бота в окружении нет, и instrumentation
 * об этом молчит, чтобы в логе не было строк [databot].
 */
export interface EnsureDatabotWebhookResult {
  status: "registered" | "absent" | "skipped" | "failed";
  detail?: string;
}

/** my_chat_member — чтобы узнать, что бота добавили в группу, и выйти. */
export const DATABOT_ALLOWED_UPDATES = ["message", "edited_message", "callback_query", "my_chat_member"] as const;

export async function ensureDatabotWebhook(): Promise<EnsureDatabotWebhookResult> {
  // Один Telegram-токен может иметь только один webhook. Когда «Пятница»
  // обслуживает и задачи, оставляем её на team-webhook.
  if (process.env.TEAM_BOT_TOKEN?.trim() && databotToken() === process.env.TEAM_BOT_TOKEN.trim())
    return { status: "skipped", detail: "общий токен с командным ботом" };
  const bot = getDatabot();
  if (!bot) return { status: "absent" };

  const secret = process.env.DATABOT_WEBHOOK_SECRET;
  const origin = publicOriginFromEnv();
  if (!origin || !secret) {
    const missing = [!origin && "NEXT_PUBLIC_APP_URL", !secret && "DATABOT_WEBHOOK_SECRET"].filter(Boolean);
    return { status: "skipped", detail: `env не задан: ${missing.join(", ")}` };
  }

  const target = `${origin}/api/telegram/databot-webhook`;

  try {
    if (!bot.isInited()) await bot.init();
    await bot.api.setWebhook(target, {
      secret_token: secret,
      allowed_updates: [...DATABOT_ALLOWED_UPDATES],
    });
    // Меню по умолчанию приезжает с кодом. Меню зоны ставится человеку
    // отдельно (scope chat), когда он входит.
    await bot.api.setMyCommands(process.env.TEAM_BOT_TOKEN ? [DATABOT_DEFAULT_COMMANDS[0]] : [...DATABOT_DEFAULT_COMMANDS]).catch((err) => {
      console.warn("[databot] setMyCommands:", err instanceof Error ? err.message : String(err));
    });
    // Telegram сохраняет команды scope=chat между релизами. Обновляем меню
    // уже вошедших участников при каждом старте, иначе они видят старый набор
    // до следующего /start.
    try {
      const members = await createSupabaseStore().listMembers();
      for (const member of members) await setChatCommands(bot.api, member.chat_id, member.zone);
    } catch (err) {
      console.warn("[databot] sync member commands:", err instanceof Error ? err.message : String(err));
    }
    return { status: "registered", detail: target };
  } catch (err) {
    return { status: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
