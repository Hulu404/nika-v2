import { GrammyError, type InlineKeyboard } from "grammy";
import { getBot } from "./bot";
import { tgAdmin } from "./supabase";
import { trackServer } from "../track-server";

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
    return sendFailure(chatId, err);
  }
}

/**
 * Копия чужого сообщения в чат — для общей рассылки организатора (/say).
 * copyMessage, а не пересылка: у получателя нет плашки «переслано от», а
 * форматирование, фото и подпись приезжают как есть. Ошибки — как у sendBotMessage.
 */
export async function copyBotMessage(
  chatId: number,
  fromChatId: number,
  messageId: number,
): Promise<SendResult> {
  try {
    const bot = getBot();
    if (!bot.isInited()) await bot.init();
    const msg = await bot.api.copyMessage(chatId, fromChatId, messageId);
    return { ok: true, messageId: msg.message_id };
  } catch (err) {
    return sendFailure(chatId, err);
  }
}

/** Общий разбор ошибки отправки: 403 гасит связку, 429 отдаёт retry_after. */
async function sendFailure(chatId: number, err: unknown): Promise<SendResult> {
  if (err instanceof GrammyError) {
    if (err.error_code === 403) {
      const { data: gased } = await tgAdmin()
        .from("tg_bindings")
        .update({
          is_active: false,
          unlinked_at: new Date().toISOString(),
          unlink_reason: "blocked",
        })
        .eq("chat_id", chatId)
        .eq("is_active", true)
        .select("user_id");
      const userId = (gased?.[0] as { user_id: string } | undefined)?.user_id;
      if (userId) trackServer(userId, "tg_unlinked", { reason: "blocked" });
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
