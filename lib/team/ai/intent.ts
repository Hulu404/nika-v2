import { mskMidnight } from "../../databot/dates";
import { addDays, mskToday } from "../../databot/time";
import type { RoadmapStatus } from "../roadmap/store";

/**
 * Действия ассистента: что создаётся или меняется по «✅ Подтвердить».
 * Аргументы инструментов (tools.ts) проверяются здесь: validateIntent приводит
 * их к Intent, автор, права и сохранение — дело кода (assistant.ts).
 *
 * Намерение понято, но не хватает поля (встреча без времени, задача без
 * исполнителя) — это не unknown: возвращается намерение с missing, бот
 * сохраняет черновик и задаёт один вопрос. unknown — только когда намерение
 * не распознано или ответ модели сломан.
 */

export interface Mention {
  name: string;
  qualifier: string | null;
}

export type EventKind = "meeting" | "club_event" | "other";
/** «Удалить задачу» — это cancelled: физически задачи не удаляются. */
export type TaskStatusChange = "done" | "taken" | "cancelled";
export type ScheduleRange = "today" | "tomorrow" | "week";

/**
 * Чего не хватает — только то, без чего действие невозможно: у задачи —
 * исполнителя, у встречи и напоминания — времени. Название встречи, место и
 * текст напоминания подставляются (clarify.ts → fillDefaults). Если сказана
 * только дата, она лежит в date, а спрашивается только время (23:59 встречам
 * и напоминаниям не подставляем).
 */
export type MissingField = "assignees" | "remind_at" | "starts_at";

/** Строка пакета задач: кому, что, срок (как у одной задачи). */
export interface TaskSpec {
  assignees: Mention[];
  what: string;
  due: string | null;
}

/** Задач в одном пакете — не больше. */
export const MAX_BATCH = 20;

export type Intent =
  | { intent: "create_task"; assignees: Mention[]; what: string; due: string | null; missing?: MissingField[] }
  // Несколько задач одним предпросмотром и «✅ Создать все»; проблемы — у строк.
  | { intent: "create_tasks"; tasks: TaskSpec[] }
  | { intent: "create_reminder"; text: string; remind_at: string; task_hint: string | null; date?: string | null; missing?: MissingField[] }
  | { intent: "create_event"; title: string; starts_at: string; place: string | null; participants: Mention[]; kind: EventKind; date?: string | null; missing?: MissingField[] }
  // Изменения существующего — только через черновик и «✅ Подтвердить» (tools.ts → assistant.ts).
  | { intent: "update_task"; task_ids: number[]; what?: string; due?: string; clear_due?: boolean; add_assignees?: Mention[]; remove_assignees?: Mention[] }
  | { intent: "set_task_status"; task_ids: number[]; status: TaskStatusChange; /** «Кроме: Настя (Глава SMM)» — кого исключили. */ except?: string[] }
  | { intent: "update_event"; event_id: number; title?: string; starts_at?: string; place?: string }
  | { intent: "cancel_event"; event_id: number }
  | { intent: "cancel_reminder"; reminder_id: number }
  // Пункт плана развития: статус, ответственный, срок (YYYY-MM-DD).
  | { intent: "update_roadmap_item"; item_id: number; status?: RoadmapStatus; owner_chat_id?: number; due?: string; clear_due?: boolean }
  | { intent: "show_my_day" }
  | { intent: "show_my_tasks" }
  | { intent: "show_schedule"; range: ScheduleRange }
  | { intent: "unknown"; reason: string };

export type IntentName = Intent["intent"];

const str = (v: unknown, max = 500): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t ? t : null;
};

const LOCAL_RE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?$/;

/** «2026-10-15T20:00» или «2026-10-15» (тогда 23:59) → нормальная строка; иначе null. */
export function normalizeLocal(v: unknown): string | null {
  const s = str(v, 32);
  const m = s ? LOCAL_RE.exec(s) : null;
  if (!m) return null;
  const [, ymd, hh = "23", mm = "59"] = m;
  if (Number(hh) > 23 || Number(mm) > 59) return null;
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== ymd) return null;
  return `${ymd}T${hh}:${mm}`;
}

function mentions(v: unknown): Mention[] | null {
  if (!Array.isArray(v)) return v === undefined || v === null ? [] : null;
  const out: Mention[] = [];
  for (const item of v.slice(0, 10)) {
    if (!item || typeof item !== "object") return null;
    const name = str((item as Record<string, unknown>).name, 64);
    if (!name) return null;
    out.push({ name, qualifier: str((item as Record<string, unknown>).qualifier, 64) });
  }
  return out;
}

const unknown = (reason: string): Intent => ({ intent: "unknown", reason });

/**
 * Ответ модели → Intent. Лишние поля (например «автор») отбрасываются: их в
 * Intent просто нет. Невалидное — unknown, без исключений.
 */
/** «2026-10-15T20:00» → полная дата; «2026-10-15» → только день (время не сказано). */
function moment(v: unknown): { local: string | null; date: string | null } {
  const s = str(v, 32);
  const m = s ? LOCAL_RE.exec(s) : null;
  if (!m) return { local: null, date: null };
  const local = normalizeLocal(s);
  if (!local) return { local: null, date: null };
  return m[2] === undefined ? { local: null, date: local.slice(0, 10) } : { local, date: null };
}

/** missing и date — только когда есть: полный ответ выглядит как раньше. */
function extra<T extends Intent>(intent: T, missing: MissingField[], date: string | null): T {
  return { ...intent, ...(missing.length ? { missing } : {}), ...(date ? { date } : {}) };
}

/** Есть ли что спрашивать у намерения. */
export const missingOf = (i: Intent): MissingField[] => ("missing" in i && i.missing) || [];

export function validateIntent(raw: unknown): Intent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return unknown("invalid");
  const r = raw as Record<string, unknown>;
  switch (r.intent) {
    case "create_task": {
      const what = str(r.what, 3000);
      const assignees = mentions(r.assignees);
      // У задачи «сегодня» без времени — конец дня: срок, а не встреча.
      const due = str(r.due) === null ? null : normalizeLocal(r.due);
      if (!assignees || (str(r.due) !== null && !due)) return unknown("invalid");
      // Без текста задачи ставить нечего: это не вопрос, а «не поняла».
      if (!what) return unknown("no_task_text");
      const missing: MissingField[] = [];
      if (!assignees.length) missing.push("assignees");
      return extra({ intent: "create_task", what: what ?? "", assignees, due }, missing, null);
    }
    case "create_reminder": {
      const text = str(r.text, 1000);
      const at = moment(r.remind_at);
      const missing: MissingField[] = [];
      if (!at.local) missing.push("remind_at");
      return extra({ intent: "create_reminder", text: text ?? "", remind_at: at.local ?? "", task_hint: str(r.task_hint, 300) }, missing, at.date);
    }
    case "create_event": {
      const title = str(r.title, 200);
      const at = moment(r.starts_at);
      const participants = mentions(r.participants);
      const kind = r.kind === "club_event" || r.kind === "other" ? r.kind : "meeting";
      if (!participants) return unknown("invalid");
      const missing: MissingField[] = [];
      if (!at.local) missing.push("starts_at");
      return extra({ intent: "create_event", title: title ?? "", starts_at: at.local ?? "", place: str(r.place, 200), participants, kind }, missing, at.date);
    }
    case "show_my_day":
      return { intent: "show_my_day" };
    case "show_my_tasks":
      return { intent: "show_my_tasks" };
    case "show_schedule":
      return { intent: "show_schedule", range: r.range === "today" || r.range === "tomorrow" ? r.range : "week" };
    case "unknown":
      return unknown(str(r.reason, 300) ?? "не поняла");
    default:
      return unknown("invalid");
  }
}

/** Московское локальное «YYYY-MM-DDTHH:mm» → момент времени. */
export function mskLocalToDate(local: string): Date {
  const [ymd, hm] = local.split("T");
  const [h, m] = hm.split(":").map(Number);
  return new Date(mskMidnight(ymd).getTime() + (h * 60 + m) * 60_000);
}

export type WhenCheck = { ok: true; at: Date } | { ok: false; error: "past" | "far" };

/** Дата не в прошлом и не дальше 365 дней. «Сейчас» с точностью до минуты считается будущим. */
export function checkWhen(local: string, now: Date): WhenCheck {
  const at = mskLocalToDate(local);
  if (at.getTime() < now.getTime() - 60_000) return { ok: false, error: "past" };
  if (mskToday(at) > addDays(mskToday(now), 365)) return { ok: false, error: "far" };
  return { ok: true, at };
}
