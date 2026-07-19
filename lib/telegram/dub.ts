import { tgAdmin } from "./supabase";
import { canReceiveBotMessages } from "./gate";
import { sendBotMessage } from "./send";
import { siteKeyboard } from "./cta";

/**
 * Пуш-дубль в Telegram: шлёт тот же текст уведомления пользователю, если у него
 * активная привязка И согласие (единый гейт opt-in). Используется из web-push
 * рассылки (app/api/push/send) — «дублирует» пуш в Telegram для тех, кто
 * подключил бота.
 *
 * ИЗОЛИРОВАНА: любые сбои (таблиц нет / бот не настроен / бот заблокирован) не
 * должны ронять основную рассылку — всегда возвращаем boolean, не бросаем.
 */
export async function dubToTelegram(userId: string, text: string): Promise<boolean> {
  try {
    const { data: binding } = await tgAdmin()
      .from("tg_bindings")
      .select("chat_id, is_active, tg_opt_in")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    if (!canReceiveBotMessages(binding)) return false;

    const chatId = Number((binding as { chat_id: number | string }).chat_id);
    // Уведомление с кнопкой перехода на сайт (как и все бот-сообщения).
    const res = await sendBotMessage(chatId, text, siteKeyboard());
    return res.ok;
  } catch (err) {
    console.error("[tg-dub] failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
}
