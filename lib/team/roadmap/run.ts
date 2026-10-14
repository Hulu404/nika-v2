import { Api } from "grammy";
import { listProjectTeam, listTeam } from "../access";
import { teamBotConfigured, teamToken } from "../config";
import { withProjectLabel } from "../projects/labels";
import { RESCAN, supabaseProjectStore } from "../projects/projects";
import { rescanSeed } from "../projects/rescan-seed";
import { normUsername } from "../roster";
import { claimDigest, dispatchRoadmapReminders } from "./reminders";
import { supabaseRoadmapStore } from "./store";
import { supabaseAboutStore } from "../about/store";
import { RESCAN_ABOUT, RESCAN_QUESTIONS } from "../projects/rescan-about-seed";

/** Сиды RESCAN — план развития и «О проекте» — один раз при старте; повторный запуск ничего не дублирует. */
export async function applyProjectSeeds(now = new Date()): Promise<number> {
  const team = await listTeam();
  const ownerOf = (username: string) => team.find((m) => normUsername(m.username) === normUsername(username))?.chat_id ?? null;
  const roadmap = await supabaseRoadmapStore().seed(RESCAN, rescanSeed(ownerOf), now);
  const about = await supabaseAboutStore().seed(RESCAN, RESCAN_ABOUT, RESCAN_QUESTIONS, now).catch((err) => {
    console.error("[team] about seed:", err instanceof Error ? err.message : String(err));
    return 0;
  });
  return roadmap + about;
}

/** Проход 15-минутного тикера: напоминания о контрольных точках и план недели. */
export async function tickRoadmap(now = new Date()): Promise<string[]> {
  if (!teamBotConfigured()) return [];
  const api = new Api(teamToken());
  return dispatchRoadmapReminders({
    projects: () => supabaseProjectStore().list(),
    roadmap: supabaseRoadmapStore(),
    teamOf: (projectId) => listProjectTeam(projectId),
    claim: claimDigest,
    send: async (chatId, text, projectId) => api.sendMessage(chatId, await withProjectLabel(chatId, projectId, text), { parse_mode: "HTML" }),
  }, now);
}
