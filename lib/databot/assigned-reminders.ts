import type { Api } from "grammy";
import { overdueOwnerText, overdueText, reminderText, taskButtons } from "./assigned-view";
import { databotConfigured } from "./config";
import type { DatabotStore } from "./data/store";
import { isActiveAssigned, type AssignedTask } from "./task-list";
import { mskHour } from "./time";

/**
 * Напоминания по задачам из /assign. Своего расписания нет: зовёт 15-минутный
 * тикер из instrumentation.ts, а «пора ли» решает noticeDue.
 *
 * Правила:
 * - напоминание исполнителю — за сутки до срока, если задачу дали больше чем
 *   за сутки; за три часа, если дали меньше чем за сутки, но больше чем за
 *   шесть часов; на совсем короткие задачи — без напоминания, их только что
 *   обсудили;
 * - срок прошёл, задача не закрыта — одно сообщение исполнителю и одно
 *   поставившему владельцу;
 * - ночью (22:00–09:00 МСК) не пишем никому: напоминание за сутки до срока
 *   «до пятницы» (23:59) выпадает на 23:59 четверга и уходит в 09:00 пятницы —
 *   как раз «сегодня срок».
 *
 * Дедуп — отметки reminded_at / overdue_notified_at в базе: тикер делает
 * первый проход на каждом деплое. Отметка ставится ДО отправки: лучше
 * потерять одно напоминание при сбое Telegram, чем прислать два.
 */

const HOUR = 3_600_000;
const QUIET_FROM = 22;
const QUIET_TO = 9;

export type NoticeKind = "reminder" | "overdue";

/** Момент напоминания до срока; null — задача слишком короткая для напоминания. */
export function reminderAt(t: Pick<AssignedTask, "due_at" | "created_at">): Date | null {
  if (!t.due_at) return null;
  const due = Date.parse(t.due_at);
  const span = due - Date.parse(t.created_at);
  if (span > 24 * HOUR) return new Date(due - 24 * HOUR);
  if (span > 6 * HOUR) return new Date(due - 3 * HOUR);
  return null;
}

export function noticeDue(t: AssignedTask, now: Date): NoticeKind | null {
  if (!isActiveAssigned(t) || !t.due_at) return null;
  const hour = mskHour(now);
  if (hour >= QUIET_FROM || hour < QUIET_TO) return null;
  if (Date.parse(t.due_at) <= now.getTime()) return t.overdue_notified_at ? null : "overdue";
  if (t.reminded_at) return null;
  const at = reminderAt(t);
  return at && at.getTime() <= now.getTime() ? "reminder" : null;
}

export interface ReminderDeps {
  store: DatabotStore;
  api: Pick<Api, "sendMessage">;
}

export async function sendAssignedReminders(deps: ReminderDeps, now = new Date()): Promise<{ reminders: number; overdue: number }> {
  const { store, api } = deps;
  const out = { reminders: 0, overdue: 0 };
  for (const task of await store.listAssignedDue()) {
    const kind = noticeDue(task, now);
    if (!kind || !(await store.markAssignedNotice(task.id, kind))) continue;
    const options = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: taskButtons(task) ?? [] } };
    // Сбой одной отправки не останавливает остальные: отметка уже стоит, повтора не будет.
    if (kind === "reminder") {
      await api.sendMessage(task.assignee_id, reminderText(task, now), options).catch(() => {});
      out.reminders += 1;
    } else {
      await api.sendMessage(task.assignee_id, overdueText(task, now), options).catch(() => {});
      if (task.assigned_by !== task.assignee_id)
        await api.sendMessage(task.assigned_by, overdueOwnerText(task), { parse_mode: "HTML" }).catch(() => {});
      out.overdue += 1;
    }
  }
  return out;
}

/** Точка входа тикера. Без DATABOT_TOKEN — absent: бота и его таблиц здесь нет. */
export async function dispatchAssignedReminders(now = new Date()): Promise<{ status: "absent" | "done"; reminders?: number; overdue?: number }> {
  if (!databotConfigured()) return { status: "absent" };
  const [{ getDatabot }, { createSupabaseStore }] = await Promise.all([import("./bot"), import("./data/supabase-store")]);
  const bot = getDatabot();
  if (!bot) return { status: "absent" };
  const res = await sendAssignedReminders({ store: createSupabaseStore(), api: bot.api }, now);
  return { status: "done", ...res };
}
