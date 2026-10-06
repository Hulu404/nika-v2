import type { Api } from "grammy";
import { overdueOwnerText, overdueText, reminderText, taskButtons } from "./assigned-view";
import { teamBotConfigured } from "../team/config";
import type { DatabotStore } from "./data/store";
import { isActiveAssigned, type AssignedNoticeMark, type AssignedTask } from "./task-list";

/**
 * Напоминания по задачам из /assign. Своего расписания нет: зовёт 15-минутный
 * тикер из instrumentation.ts, а «пора ли» решает noticeDue.
 *
 * Правила:
 * - напоминания исполнителю за 24, 12 и 3 часа до срока, пока задача не
 *   закрыта (open или taken);
 * - порог пропускается, если задачу поставили позже него: поставили за 10
 *   часов до срока — придёт только «за 3 часа»;
 * - если тикер проспал момент (деплой, рестарт) и наступило сразу несколько
 *   порогов, уходит только самый поздний, ранние помечаются без отправки:
 *   три сообщения подряд хуже, чем одно;
 * - тихих часов нет: напоминания и просрочки уходят в расчётное время, в том
 *   числе ночью;
 * - срок прошёл, задача не закрыта — одно сообщение исполнителю и одно автору.
 *
 * Дедуп — отметки reminded_24_at / reminded_12_at / reminded_3_at и
 * overdue_notified_at в базе: тикер делает первый проход на каждом деплое.
 * Отметка ставится ДО отправки: лучше потерять одно напоминание при сбое
 * Telegram, чем прислать два. Смена срока сбрасывает все отметки (045).
 */

const HOUR = 3_600_000;

/** Пороги до срока, от раннего к позднему. */
export const REMINDER_HOURS = [24, 12, 3] as const;
export type ReminderHours = (typeof REMINDER_HOURS)[number];

const MARK: Record<ReminderHours, AssignedNoticeMark> = { 24: "r24", 12: "r12", 3: "r3" };
const FIELD = { 24: "reminded_24_at", 12: "reminded_12_at", 3: "reminded_3_at" } as const;

export type NoticePlan =
  | { kind: "reminder"; hours: ReminderHours; mark: AssignedNoticeMark; silent: AssignedNoticeMark[] }
  | { kind: "overdue" };

/** Пороги, которые вообще применимы к задаче: поставленные позже порога пропускаются. */
export function reminderThresholds(t: Pick<AssignedTask, "due_at" | "created_at">): ReminderHours[] {
  if (!t.due_at) return [];
  const due = Date.parse(t.due_at);
  const created = Date.parse(t.created_at);
  return REMINDER_HOURS.filter((h) => created <= due - h * HOUR);
}

export function noticeDue(t: AssignedTask, now: Date): NoticePlan | null {
  if (!isActiveAssigned(t) || !t.due_at) return null;
  const due = Date.parse(t.due_at);
  if (due <= now.getTime()) return t.overdue_notified_at ? null : { kind: "overdue" };
  const reached = reminderThresholds(t).filter((h) => now.getTime() >= due - h * HOUR && !t[FIELD[h]]);
  if (!reached.length) return null;
  const latest = reached[reached.length - 1];
  return { kind: "reminder", hours: latest, mark: MARK[latest], silent: reached.slice(0, -1).map((h) => MARK[h]) };
}

export interface ReminderDeps {
  store: DatabotStore;
  api: Pick<Api, "sendMessage">;
}

export async function sendAssignedReminders(deps: ReminderDeps, now = new Date()): Promise<{ reminders: number; overdue: number }> {
  const { store, api } = deps;
  const out = { reminders: 0, overdue: 0 };
  for (const task of await store.listAssignedDue()) {
    const plan = noticeDue(task, now);
    if (!plan) continue;
    const teammates = await store.listAssignedTeammates(task);
    const options = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: taskButtons(task) ?? [] } };
    // Сбой одной отправки не останавливает остальные: отметка уже стоит, повтора не будет.
    if (plan.kind === "reminder") {
      // Проспанные ранние пороги помечаем молча: уходит только самый поздний.
      for (const mark of plan.silent) await store.markAssignedNotice(task.id, mark);
      if (!(await store.markAssignedNotice(task.id, plan.mark))) continue;
      await api.sendMessage(task.assignee_id, reminderText(task, now, teammates, plan.hours), options).catch(() => {});
      out.reminders += 1;
    } else {
      if (!(await store.markAssignedNotice(task.id, "overdue"))) continue;
      await api.sendMessage(task.assignee_id, overdueText(task, now, teammates), options).catch(() => {});
      if (task.assigned_by !== task.assignee_id)
        await api.sendMessage(task.assigned_by, overdueOwnerText(task), { parse_mode: "HTML" }).catch(() => {});
      out.overdue += 1;
    }
  }
  return out;
}

/** Точка входа тикера. Задачи живут в «Пятнице»: без TEAM_BOT_TOKEN — absent. */
export async function dispatchAssignedReminders(now = new Date()): Promise<{ status: "absent" | "done"; reminders?: number; overdue?: number }> {
  if (!teamBotConfigured()) return { status: "absent" };
  const [{ createSupabaseStore }, { getTeamBot }] = await Promise.all([
    import("./data/supabase-store"),
    import("../team/bot"),
  ]);
  const res = await sendAssignedReminders({ store: createSupabaseStore(), api: getTeamBot().api }, now);
  return { status: "done", ...res };
}
