import { tgAdmin } from "./supabase";

/**
 * ЕДИНЫЙ гейт бот-инициированных сообщений (разделы 3.1, 10 ТЗ).
 * Слать чек-ины, рекомендации, маркетинг и пуш-дубли в Telegram можно ТОЛЬКО
 * тем, у кого связка активна И есть явное согласие.
 *
 * Ответы на действия пользователя (callback_query, /команды) под гейт НЕ
 * попадают — на них отвечаем всегда, это не бот-инициатива.
 */
export function canReceiveBotMessages(
  binding: { is_active?: boolean | null; tg_opt_in?: boolean | null } | null | undefined,
): boolean {
  return binding?.is_active === true && binding?.tg_opt_in === true;
}

/** Получатель бот-инициированной рассылки. */
export interface BotRecipient {
  user_id: string;
  chat_id: number;
}

/**
 * Список чатов, которым можно слать (is_active AND tg_opt_in). Единственный
 * источник получателей для всех бот-инициированных рассылок.
 */
export async function listBotRecipients(): Promise<BotRecipient[]> {
  const { data, error } = await tgAdmin()
    .from("tg_bindings")
    .select("user_id, chat_id")
    .eq("is_active", true)
    .eq("tg_opt_in", true);
  if (error) {
    console.error("[tg-gate] listBotRecipients failed:", error.message);
    return [];
  }
  return (data ?? []) as BotRecipient[];
}
