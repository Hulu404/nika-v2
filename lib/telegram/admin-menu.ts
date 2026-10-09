import type { Api } from "grammy";
import { ADMIN_COMMANDS } from "./broadcast-copy";

/**
 * Меню команд организатора — кнопка «Меню» в Telegram, только в его чате.
 *
 * Scope `chat` перекрывает общее меню бота лишь для этого чата: участники
 * по-прежнему видят обычное меню и про организаторские команды не узнают.
 * Telegram хранит меню между релизами, поэтому ставим его на каждый /admin.
 *
 * Ошибка меню не должна ломать вход: команды работают и без него.
 */
export async function setAdminCommands(api: Api, chatId: number): Promise<void> {
  try {
    await api.setMyCommands(ADMIN_COMMANDS, { scope: { type: "chat", chat_id: chatId } });
  } catch (err) {
    console.error("[bot] setMyCommands admin:", err instanceof Error ? err.message : String(err));
  }
}

/** /pollstop: вернуть чату обычное меню бота. */
export async function clearAdminCommands(api: Api, chatId: number): Promise<void> {
  try {
    await api.deleteMyCommands({ scope: { type: "chat", chat_id: chatId } });
  } catch (err) {
    console.error("[bot] deleteMyCommands admin:", err instanceof Error ? err.message : String(err));
  }
}
