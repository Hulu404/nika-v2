import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, type Context } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { databotToken, databotTaskConfig } from "./config";
import type { DatabotStore } from "./data/store";
import { createSupabaseStore } from "./data/supabase-store";
import { createPipeline } from "./pipeline";

/**
 * Бот данных команды: цифры из Supabase по кнопке или вопросу, с учётом зоны
 * доступа (ТЗ nika-team-data-bot-spec.md). Устроен как lib/team/bot.ts: один
 * ленивый экземпляр на процесс, вебхук в проде и polling в dev.
 *
 * Отличие от командного бота — повтор запросов к Telegram: при 429 и сетевых
 * сбоях запрос повторяется с паузой из retry_after (@grammyjs/auto-retry). В
 * lib/team такого механизма нет, там 429 только возвращается наверх.
 */

export interface CreateDatabotOptions {
  /** Готовый getMe — в тестах, чтобы не ходить в сеть за bot.init(). */
  botInfo?: UserFromGetMe;
  /**
   * Печатать chat_id входящих апдейтов. Только для dev: так владелец узнаёт свой
   * chat_id для DATABOT_OWNER_IDS. В проде chat_id в логи не писать.
   */
  logChatIds?: boolean;
  /** Хранилище; по умолчанию — Supabase. В тестах — MemoryStore. */
  store?: DatabotStore;
  /** Часы — в тестах (срок приглашения). */
  now?: () => Date;
}

/**
 * Повтор не дольше 10 секунд паузы и не больше трёх раз: апдейт в вебхуке
 * ждёт ответа, и минутное ожидание retry_after хуже, чем честный сбой в логе.
 */
const RETRY = { maxRetryAttempts: 3, maxDelaySeconds: 10 };

export function createDatabot(token: string, opts: CreateDatabotOptions = {}): Bot<Context> {
  const bot = new Bot<Context>(token, opts.botInfo ? { botInfo: opts.botInfo } : undefined);
  const retry = autoRetry(RETRY);
  bot.api.config.use((prev, method, payload, signal) => {
    // A group publication cannot be retried safely after an ambiguous network failure.
    if (method === "sendMessage" && "chat_id" in payload &&
        (payload.chat_id === databotTaskConfig()?.chatId ||
          ("text" in payload && typeof payload.text === "string" && payload.text.startsWith("<b>Новая задача от команды</b>")))) {
      return prev(method, payload, signal);
    }
    return retry(prev, method, payload, signal);
  });

  if (opts.logChatIds) {
    bot.use(async (ctx, next) => {
      const chat = ctx.chat ?? ctx.myChatMember?.chat;
      const who = ctx.from?.username ? ` @${ctx.from.username}` : "";
      console.log(`[databot:dev] chat_id=${chat?.id ?? "—"} message_thread_id=${ctx.msg?.message_thread_id ?? "—"} (${chat?.type ?? "?"})${who}`);
      await next();
    });
  }

  bot.use(createPipeline({ store: opts.store ?? createSupabaseStore(), now: opts.now }));

  bot.catch((err) => {
    const e = err.error;
    console.error("[databot] handler:", e instanceof Error ? e.message : String(e));
  });

  return bot;
}

let _bot: Bot<Context> | null = null;

/** Экземпляр для вебхука. Нет DATABOT_TOKEN — null: бота в окружении нет. */
export function getDatabot(): Bot<Context> | null {
  if (_bot) return _bot;
  const token = databotToken();
  if (!token) return null;
  _bot = createDatabot(token);
  return _bot;
}

/** Обработать один апдейт. Без токена тихо выходит. */
export async function handleUpdate(update: Update): Promise<void> {
  const bot = getDatabot();
  if (!bot) return;
  if (!bot.isInited()) await bot.init();
  await bot.handleUpdate(update);
}
