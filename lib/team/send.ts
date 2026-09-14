import { GrammyError } from "grammy";
import { tgAdmin } from "../telegram/supabase";
import { getTeamBot } from "./bot";

/**
 * Отправка сообщений командному чату. Своя, а не общая с lib/telegram/send.ts,
 * потому что это другой бот: у того свой токен, свои лимиты и своя реакция на
 * 403.
 *
 * Разница в обработке блокировки принципиальна. Там 403 означает «человек
 * отписался от НИКИ» и связку деактивируют. Здесь 403 означает, что коллега
 * заблокировал служебного бота или удалил чат, — и выкидывать его из команды
 * за это нельзя: доступ к цифрам он не терял, он просто не хочет сообщений.
 * Поэтому гасим только сводки, а членство оставляем.
 */
export interface TeamSendResult {
  ok: boolean;
  blocked?: boolean;
  retryAfter?: number;
}

export async function sendTeamMessage(chatId: number, text: string): Promise<TeamSendResult> {
  try {
    const bot = getTeamBot();
    if (!bot.isInited()) await bot.init();
    await bot.api.sendMessage(chatId, text);
    return { ok: true };
  } catch (err) {
    if (err instanceof GrammyError) {
      if (err.error_code === 403) {
        const { error } = await tgAdmin()
          .from("team_members")
          .update({ digest_opt_in: false })
          .eq("chat_id", chatId);
        if (error) console.error("[team-send] mute after 403:", error.message);
        return { ok: false, blocked: true };
      }
      if (err.error_code === 429) {
        const retryAfter = err.parameters?.retry_after;
        console.error("[team-send] 429 rate limited, retry_after=", retryAfter);
        return { ok: false, retryAfter };
      }
      console.error("[team-send] GrammyError", err.error_code, err.description);
      return { ok: false };
    }
    console.error("[team-send] failed:", err instanceof Error ? err.message : String(err));
    return { ok: false };
  }
}
