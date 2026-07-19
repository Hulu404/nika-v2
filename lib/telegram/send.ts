import { GrammyError, type InlineKeyboard } from "grammy";
import { getBot } from "./bot";
import { tgAdmin } from "./supabase";

/**
 * Транспорт бот-инициированных сообщений. ЕДИНАЯ точка отправки — её
 * переиспользуют чек-ины и (позже) пуш-дубли/рассылки, чтобы обработка
 * ошибок Telegram была в одном месте.
 *
 * 403 (бот заблокирован / чат недоступен) → деактивируем связку (больше не шлём).
 * 429 (rate limit) → возвращаем retry_after, решение о повторе за вызывающим.
 *
 * ПРИВАТНОСТЬ: текст сообщения не логируем, только коды ошибок.
 */
export interface SendResult {
  ok: boolean;
  messageId?: number;
  blocked?: boolean;
  retryAfter?: number;
}

export async function sendBotMessage(
  chatId: number,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<SendResult> {
  try {
    const bot = getBot();
    if (!bot.isInited()) await bot.init();
    const msg = await bot.api.sendMessage(
      chatId,
      text,
      keyboard ? { reply_markup: keyboard } : undefined,
    );
    return { ok: true, messageId: msg.message_id };
  } catch (err) {
    if (err instanceof GrammyError) {
      if (err.error_code === 403) {
        await tgAdmin()
          .from("tg_bindings")
          .update({
            is_active: false,
            unlinked_at: new Date().toISOString(),
            unlink_reason: "blocked",
          })
          .eq("chat_id", chatId)
          .eq("is_active", true);
        return { ok: false, blocked: true };
      }
      if (err.error_code === 429) {
        const retryAfter = err.parameters?.retry_after;
        console.error("[tg-send] 429 rate limited, retry_after=", retryAfter);
        return { ok: false, retryAfter };
      }
      console.error("[tg-send] GrammyError", err.error_code, err.description);
      return { ok: false };
    }
    console.error("[tg-send] failed:", err instanceof Error ? err.message : String(err));
    return { ok: false };
  }
}
