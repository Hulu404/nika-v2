import { founderIds, teamBotConfigured } from "../config";
import { supabaseTeamForms } from "../form";
import { dispatchSocialDaily, type SocialDeps } from "./social";
import { supabaseSocialStore } from "./social-store";

/**
 * Точка входа 15-минутного тикера (instrumentation.ts): раз в сутки в 21:00
 * МСК снимок подписчиков Telegram-канала — по нему /social считает динамику.
 * Без TEAM_BOT_TOKEN — absent.
 *
 * Сводку фаундерам (10:00 и 22:30) больше не шлём: Дмитрий 11.11.2026 —
 * «бесполезна, я и так в курсе». Вопрос про Instagram в 21:00 тоже убран:
 * число вносит сам в /social кнопкой «Внести Instagram».
 */
export async function dispatchFounderReports(now = new Date()): Promise<{ status: "absent" | "done"; done?: string[] }> {
  if (!teamBotConfigured()) return { status: "absent" };
  const { getTeamBot } = await import("../bot");
  const bot = getTeamBot();
  if (!bot.isInited()) await bot.init();
  const social: SocialDeps = {
    store: supabaseSocialStore(),
    forms: supabaseTeamForms(),
    send: (chatId, text, keyboard) => bot.api.sendMessage(chatId, text, keyboard ? { reply_markup: keyboard } : {}),
    memberCount: (channel) => bot.api.getChatMemberCount(channel),
    founders: () => [...founderIds()],
  };
  const done: string[] = [];
  done.push(...(await dispatchSocialDaily(social, now, { askInstagram: false })));
  return { status: "done", done };
}
