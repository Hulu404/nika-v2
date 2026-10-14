import { mskWeekday } from "../../databot/dates";
import { mskHour, mskToday } from "../../databot/time";
import { tgAdmin } from "../../telegram/supabase";
import type { TeamMember } from "../access";
import { escapeHtmlTeam } from "../copy";
import { hasModule, type Project } from "../projects/projects";
import { personName } from "../roster";
import { conditionsOf, dayLabel, inDays, isOverdue, nearestMilestone, weekItems } from "./copy";
import type { RoadmapItem, RoadmapStore } from "./store";

/**
 * Напоминания плана развития (15-минутный тикер, с 10:00 МСК):
 *   • за 3 дня и за 1 день до контрольной точки — участникам проекта, со
 *     списком невыполненных условий и их ответственными;
 *   • в понедельник — «На этой неделе в плане:» (пункты со сроком на неделе);
 *     пустая неделя — без сообщения.
 * Дедуп — team_digests с проектом в ключе (миграция 058).
 */

export const ROADMAP_REMINDER_HOUR = 10;

export interface RoadmapReminderDeps {
  projects: () => Promise<Project[]>;
  roadmap: Pick<RoadmapStore, "list">;
  teamOf: (projectId: string) => Promise<TeamMember[]>;
  /** Занять отправку; false — уже отправляли. */
  claim: (kind: string, spot: string, ymd: string, projectId: string) => Promise<boolean>;
  send: (chatId: number, text: string, projectId: string) => Promise<unknown>;
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const owner = (i: RoadmapItem, names: ReadonlyMap<number, string>) => (i.owner_chat_id ? names.get(i.owner_chat_id) ?? "—" : "без ответственного");
const label = (i: RoadmapItem) => escapeHtmlTeam(`${i.code ? `${i.code} ` : ""}${i.title}`);

/** «⏳ КТ1 через 3 дня, не готово:» и условия; все готовы — так и пишет. */
export function milestoneReminderText(m: RoadmapItem, items: readonly RoadmapItem[], names: ReadonlyMap<number, string>, today: string): string {
  const conds = conditionsOf(items, m.id);
  const unmet = conds.filter((c) => c.status !== "done");
  const head = `⏳ ${escapeHtmlTeam(m.code ?? m.title)} ${inDays(m.due_date!, today)} · ${escapeHtmlTeam(m.title)}`;
  if (!conds.length) return head;
  if (!unmet.length) return `${head}\nВсе условия выполнены ✅`;
  return [`${head}\nНе готово:`, ...unmet.map((c) => `• ${label(c)} — ${escapeHtmlTeam(owner(c, names))}`)].join("\n");
}

export function weekPlanText(list: readonly RoadmapItem[], names: ReadonlyMap<number, string>, today: string): string {
  return ["🗺 На этой неделе в плане:", ...list.map((i) => `• ${label(i)} · до ${dayLabel(i.due_date!, today)} · ${escapeHtmlTeam(owner(i, names))}`)].join("\n");
}

export async function dispatchRoadmapReminders(deps: RoadmapReminderDeps, now: Date): Promise<string[]> {
  if (mskHour(now) < ROADMAP_REMINDER_HOUR) return [];
  const today = mskToday(now);
  const done: string[] = [];
  for (const p of (await deps.projects()).filter((x) => hasModule(x, "roadmap"))) {
    const items = await deps.roadmap.list(p.id);
    if (!items.length) continue;
    const team = await deps.teamOf(p.id);
    const names = new Map(team.map((m) => [m.chat_id, personName(m)] as const));
    const sendAll = async (text: string) => {
      for (const m of team) await Promise.resolve(deps.send(m.chat_id, text, p.id)).catch(() => {});
    };
    for (const m of items.filter((i) => i.kind === "milestone" && i.status !== "done" && i.due_date)) {
      const d = daysBetween(today, m.due_date!);
      if ((d === 3 || d === 1) && (await deps.claim("roadmap_kt", `${m.id}:${d}`, today, p.id))) {
        await sendAll(milestoneReminderText(m, items, names, today));
        done.push(`kt ${p.id} ${m.code ?? m.id} -${d}`);
      }
    }
    if (mskWeekday(today) === 1 && (await deps.claim("roadmap_week", "all", today, p.id))) {
      const list = weekItems(items, today);
      if (list.length) {
        await sendAll(weekPlanText(list, names, today));
        done.push(`week ${p.id} ${list.length}`);
      }
    }
  }
  return done;
}

/** Строки плана в сводке фаундерам: ближайшая точка с невыполненными условиями, просроченные пункты. */
export async function roadmapDigestLines(roadmap: Pick<RoadmapStore, "list">, team: readonly TeamMember[], projectId: string, now: Date): Promise<string[]> {
  const today = mskToday(now);
  const items = await roadmap.list(projectId);
  if (!items.length) return [];
  const names = new Map(team.map((m) => [m.chat_id, personName(m)] as const));
  const lines: string[] = [];
  const next = nearestMilestone(items, today);
  if (next) {
    const unmet = conditionsOf(items, next.id).filter((c) => c.status !== "done").length;
    lines.push(`⏳ ${next.code ?? next.title} · ${dayLabel(next.due_date!, today)} · ${inDays(next.due_date!, today)} · не выполнено условий: ${unmet}`);
  }
  const overdue = items.filter((i) => isOverdue(i, today));
  lines.push(`⚠️ Просрочено пунктов плана: ${overdue.length}`);
  for (const i of overdue.slice(0, 5)) lines.push(`  · ${i.code ? `${i.code} ` : ""}${i.title} · ${owner(i, names)}`);
  if (overdue.length > 5) lines.push(`  и ещё ${overdue.length - 5}`);
  return lines;
}

/** Занять отправку в team_digests (ключ — kind, spot, дата, проект). */
export async function claimDigest(kind: string, spot: string, ymd: string, projectId: string): Promise<boolean> {
  const { error } = await tgAdmin().from("team_digests").insert({ kind, spot, run_date: ymd, sent_to: 0, project_id: projectId });
  if (!error) return true;
  if (error.code !== "23505") console.error("[roadmap] claim:", error.message);
  return false;
}
