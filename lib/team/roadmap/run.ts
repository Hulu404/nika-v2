import { Api } from "grammy";
import { listProjectTeam, listTeam } from "../access";
import { teamBotConfigured, teamToken } from "../config";
import { withProjectLabel } from "../projects/labels";
import { RESCAN, supabaseProjectStore } from "../projects/projects";
import { rescanSeed } from "../projects/rescan-seed";
import { normUsername } from "../roster";
import { claimDigest, dispatchRoadmapReminders } from "./reminders";
import { supabaseRoadmapStore } from "./store";

/** Сид плана развития RESCAN — один раз при старте (идемпотентно по project_id + code). */
export async function applyProjectSeeds(now = new Date()): Promise<number> {
  const team = await listTeam();
  const ownerOf = (username: string) => team.find((m) => normUsername(m.username) === normUsername(username))?.chat_id ?? null;
  return supabaseRoadmapStore().seed(RESCAN, rescanSeed(ownerOf), now);
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
