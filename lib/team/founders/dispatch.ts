import { createSupabaseStore } from "../../databot/data/supabase-store";
import { listTeam } from "../access";
import { founderIds, teamBotConfigured } from "../config";
import { supabaseTeamForms } from "../form";
import { dispatchFounderDigest } from "./digest";
import { dispatchSocialDaily, type SocialDeps } from "./social";
import { supabaseSocialStore } from "./social-store";

/**
 * Точка входа 15-минутного тикера (instrumentation.ts) для того, что «Пятница»
 * присылает фаундерам сама: сводка в 10:00 и 22:30, снимок Telegram-канала и
 * вопрос про Instagram в 21:00 МСК. Без TEAM_BOT_TOKEN — absent.
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
  try {
    const store = createSupabaseStore();
    const sent = await dispatchFounderDigest({
      tasks: (since) => store.listAssignedOverview(since),
      team: listTeam,
      founders: social.founders,
      social: social.store,
      memberCount: social.memberCount,
      send: social.send,
    }, now);
    if (sent) done.push(`founders ${sent}`);
  } catch (err) {
    console.error("[founders] digest:", err instanceof Error ? err.message : String(err));
  }
  done.push(...(await dispatchSocialDaily(social, now)));
  return { status: "done", done };
}
