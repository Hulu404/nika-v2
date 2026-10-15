import { mskMidnight } from "../databot/dates";
import type { DatabotStore } from "../databot/data/store";
import { isActiveAssigned, type AssignedTask } from "../databot/task-list";
import { addDays, mskToday } from "../databot/time";
import type { TeamMember } from "./access";
import type { ParticipantStore } from "./ai/stores";
import { cut, dayHeader, escapeHtmlTeam, eventWhen, taskCb } from "./copy";
import type { TeamEvent, TeamEventStore } from "./events";

/**
 * «Мой день»: события дня и мои задачи на сегодня. Утренняя сводка в 9:00 и
 * ответ на «что у меня сегодня?» — один и тот же текст. Просроченные задачи —
 * отдельным блоком «⏰ Просрочено у тебя»: других сообщений о просрочке
 * исполнитель не получает.
 *
 * События — общие события дня и встречи, где человек участник (у встречи с
 * участниками из team_event_participants чужим её не видно). Задачи —
 * открытые, где человек исполнитель, со сроком сегодня или просроченные.
 * Только факты, без мотивационных фраз.
 */

export interface MyDayDeps {
  /** События проекта (scopedEvents). */
  events: Pick<TeamEventStore, "listBetween">;
  participants: Pick<ParticipantStore, "forEvents">;
  tasks: Pick<DatabotStore, "listMyAssigned">;
  /** Задачи только этого проекта (по умолчанию nika). */
  projectId?: string;
}

export interface MyDayOptions {
  /** «Напиши или надиктуй…» — только когда голос и текст включены. */
  footer?: boolean;
  /** Строки после задач (блоки фаундерам про кофе-ран). */
  extra?: string[];
}

export const MY_DAY_FOOTER = "Напиши или надиктуй, если нужно что-то добавить.";
export const MY_DAY_EMPTY = "На сегодня ничего не запланировано.";
export const OVERDUE_HEAD = "⏰ Просрочено у тебя";

const timeOf = (iso: string) => eventWhen(iso).split(", ")[1];

/** События дня, которые видит человек. */
export async function myEvents(deps: Pick<MyDayDeps, "events" | "participants">, chatId: number, ymd: string): Promise<TeamEvent[]> {
  const events = await deps.events.listBetween(mskMidnight(ymd), mskMidnight(addDays(ymd, 1)));
  const people = await deps.participants.forEvents(events.map((e) => e.id)).catch(() => new Map<number, number[]>());
  return events.filter((e) => !people.has(e.id) || people.get(e.id)!.includes(chatId));
}

/** Срок просроченной задачи: «вчера 12:00», «сегодня 09:00», «10.10 18:00». */
function overdueWhen(iso: string, ymd: string): string {
  const p = eventWhen(iso);
  const day = mskToday(new Date(iso));
  const time = timeOf(iso);
  if (day === ymd) return `сегодня ${time}`;
  if (day === addDays(ymd, -1)) return `вчера ${time}`;
  return `${p.split(", ")[0].slice(3)} ${time}`;
}

export function myTasksToday(tasks: readonly AssignedTask[], chatId: number, ymd: string, now: Date): { today: AssignedTask[]; overdue: AssignedTask[] } {
  const mine = tasks.filter((t) => t.assignee_id === chatId && isActiveAssigned(t) && t.due_at)
    .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!) || a.id - b.id);
  return {
    overdue: mine.filter((t) => Date.parse(t.due_at!) < now.getTime()),
    today: mine.filter((t) => Date.parse(t.due_at!) >= now.getTime() && mskToday(new Date(t.due_at!)) === ymd),
  };
}

/** Содержание дня одного проекта без шапки: события, задачи, доп. строки. Пусто — []. */
export function myDayBlock(ymd: string, events: readonly TeamEvent[], tasks: { today: AssignedTask[]; overdue: AssignedTask[] }, extra: readonly string[] = []): string[] {
  const lines: string[] = [];
  if (events.length) {
    lines.push("🗓 События");
    for (const e of [...events].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))) {
      lines.push(`- ${timeOf(e.starts_at)} ${escapeHtmlTeam(e.title)}${e.place ? ` · ${escapeHtmlTeam(e.place)}` : ""}`);
    }
  }
  if (tasks.today.length) {
    if (lines.length) lines.push("");
    lines.push("📋 Твои задачи на сегодня");
    tasks.today.forEach((t, i) => {
      const until = timeOf(t.due_at!) === "23:59" ? "до конца дня" : `до ${timeOf(t.due_at!)}`;
      lines.push(`${i + 1}. ${escapeHtmlTeam(t.what)} (${until})`);
    });
  }
  if (tasks.overdue.length) {
    if (lines.length) lines.push("");
    lines.push(OVERDUE_HEAD);
    tasks.overdue.forEach((t, i) => lines.push(`${i + 1}. ${escapeHtmlTeam(t.what)} (срок ${overdueWhen(t.due_at!, ymd)})`));
  }
  if (extra.length) {
    if (lines.length) lines.push("");
    lines.push(...extra);
  }
  return lines;
}

const header = (ymd: string) => `☀️ План на ${dayHeader(ymd).toLowerCase()}`;

/** «Мой день» одного проекта: пустой день — «На сегодня ничего не запланировано». */
export function myDayText(ymd: string, events: readonly TeamEvent[], tasks: { today: AssignedTask[]; overdue: AssignedTask[] }, _now: Date, opts: MyDayOptions = {}): string {
  const block = myDayBlock(ymd, events, tasks, opts.extra);
  const lines = [header(ymd), "", ...(block.length ? block : [MY_DAY_EMPTY])];
  if (opts.footer) lines.push("", MY_DAY_FOOTER);
  return lines.join("\n");
}

/** Блок проекта одного человека и его просроченные задачи (для кнопок «Открыть»). */
export async function myDayProjectBlock(deps: MyDayDeps, chatId: number, now: Date, extra: readonly string[] = []): Promise<string[] & { overdue?: AssignedTask[] }> {
  const ymd = mskToday(now);
  const [events, all] = await Promise.all([myEvents(deps, chatId, ymd), deps.tasks.listMyAssigned(chatId)]);
  const tasks = all.filter((t) => (t.project_id ?? "nika") === (deps.projectId ?? "nika"));
  const mine = myTasksToday(tasks, chatId, ymd, now);
  return Object.assign(myDayBlock(ymd, events, mine, extra), { overdue: mine.overdue });
}

/** Кнопки утреннего плана: открыть каждую просроченную задачу (в её проекте). */
export function overdueButtons(tasks: readonly AssignedTask[]): Array<Array<{ text: string; callback_data: string }>> {
  return tasks.slice(0, 10).map((t) => [{ text: `⏰ ${cut(t.what, 40)}`, callback_data: taskCb.open(t.id, "me", 0) }]);
}

export async function buildMyDay(deps: MyDayDeps, member: Pick<TeamMember, "chat_id">, now: Date, opts: MyDayOptions = {}): Promise<string> {
  const ymd = mskToday(now);
  const [events, all] = await Promise.all([myEvents(deps, member.chat_id, ymd), deps.tasks.listMyAssigned(member.chat_id)]);
  const tasks = all.filter((t) => (t.project_id ?? "nika") === (deps.projectId ?? "nika"));
  return myDayText(ymd, events, myTasksToday(tasks, member.chat_id, ymd, now), now, opts);
}

/**
 * Утренний план: одно сообщение на человека. Человеку в одном проекте — как
 * раньше, без названий проектов; в нескольких — блоки «🏃 NIKA», «🔬 RESCAN».
 * Пустые блоки не показываются, пустой день — null (не отправлять).
 */
export function morningPlanText(ymd: string, blocks: ReadonlyArray<{ label: string; lines: string[] }>, footer: boolean): string | null {
  const filled = blocks.filter((b) => b.lines.length);
  if (!filled.length) return null;
  const body = blocks.length > 1
    ? filled.flatMap((b, i) => [...(i ? [""] : []), `<b>${escapeHtmlTeam(b.label)}</b>`, ...b.lines])
    : filled[0].lines;
  return [header(ymd), "", ...body, ...(footer ? ["", MY_DAY_FOOTER] : [])].join("\n");
}
