import { getDatabot } from "../bot";
import { createSupabaseStore } from "../data/supabase-store";
import { listTeam } from "../../team/access";
import { founderIds } from "../../team/config";
import { dispatchFounderDigest } from "./digest";
import { defaultSocialDeps, dispatchSocialDaily } from "./social";

/**
 * Точка входа 15-минутного тикера (instrumentation.ts) для того, что «Цифры
 * команды» присылают фаундерам сами: сводка в 10:00 и 22:30, снимок
 * Telegram-канала и вопрос про Instagram в 21:00 МСК. Без DATABOT_TOKEN —
 * absent: бота в окружении нет.
 */
export async function dispatchFounderReports(now = new Date()): Promise<{ status: "absent" | "done"; done?: string[] }> {
  const bot = getDatabot();
  if (!bot) return { status: "absent" };
  if (!bot.isInited()) await bot.init();
  const social = defaultSocialDeps(bot.api);
  const done: string[] = [];
  try {
    const store = createSupabaseStore();
    const sent = await dispatchFounderDigest({
      tasks: (since) => store.listAssignedOverview(since),
      team: listTeam,
      founders: () => [...founderIds()],
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
