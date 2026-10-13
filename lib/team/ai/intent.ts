import { mskMidnight } from "../../databot/dates";
import { addDays, mskToday } from "../../databot/time";

/**
 * Что LLM возвращает из свободного текста. Модель только разбирает фразу в
 * структуру: автор, права и сохранение — дело кода (lib/team/ai/assistant.ts).
 *
 * Схема для structured output — один плоский объект с полем intent: союзы
 * (oneOf) поддерживаются моделями хуже, а проверка всё равно здесь, в коде.
 * Любой ответ, не прошедший проверку, становится unknown.
 */

export interface Mention {
  name: string;
  qualifier: string | null;
}

export type EventKind = "meeting" | "club_event" | "other";
export type ScheduleRange = "today" | "tomorrow" | "week";

export type Intent =
  | { intent: "create_task"; assignees: Mention[]; what: string; due: string | null }
  | { intent: "create_reminder"; text: string; remind_at: string; task_hint: string | null }
  | { intent: "create_event"; title: string; starts_at: string; place: string | null; participants: Mention[]; kind: EventKind }
  | { intent: "show_my_day" }
  | { intent: "show_my_tasks" }
  | { intent: "show_schedule"; range: ScheduleRange }
  | { intent: "unknown"; reason: string };

export type IntentName = Intent["intent"];

const INTENTS: readonly IntentName[] = [
  "create_task", "create_reminder", "create_event", "show_my_day", "show_my_tasks", "show_schedule", "unknown",
];

// Яндекс в structured output требует: в каждом объекте схемы все ключи
// properties перечислены в required, без nullable-типов. Поэтому «нет значения» —
// пустая строка или пустой массив, а kind и range у намерений, которым они не
// нужны, модель заполняет любым значением из enum: validateIntent их игнорирует.
const mentionSchema = {
  type: "object",
  properties: {
    name: { type: "string", description: "Имя или обращение как в тексте: «Маше», «мне», «со мной», «@nick»" },
    qualifier: { type: "string", description: "Уточнение рядом с именем: «из ивента», «дизайнеру», «главе смм»; пустая строка, если нет" },
  },
  required: ["name", "qualifier"],
  additionalProperties: false,
} as const;

/** JSON-схема ответа модели (jsonSchema.schema в запросе к AI Studio). */
export const INTENT_JSON_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: INTENTS },
    what: { type: "string", description: "create_task: что сделать; пустая строка, если не применимо" },
    due: { type: "string", description: "create_task: срок YYYY-MM-DDTHH:mm по Москве; пустая строка — без срока или не применимо" },
    assignees: { type: "array", items: mentionSchema, description: "create_task: кому; пустой массив, если не применимо" },
    text: { type: "string", description: "create_reminder: о чём напомнить; пустая строка, если не применимо" },
    remind_at: { type: "string", description: "create_reminder: когда, YYYY-MM-DDTHH:mm по Москве; пустая строка, если не применимо" },
    task_hint: { type: "string", description: "create_reminder: если напоминание про задачу — её суть; пустая строка, если не применимо" },
    title: { type: "string", description: "create_event: название; пустая строка, если не применимо" },
    starts_at: { type: "string", description: "create_event: начало YYYY-MM-DDTHH:mm по Москве; пустая строка, если не применимо" },
    place: { type: "string", description: "create_event: место; пустая строка, если не сказано или не применимо" },
    participants: { type: "array", items: mentionSchema, description: "create_event: участники, кроме автора; пустой массив, если не применимо" },
    kind: { type: "string", enum: ["meeting", "club_event", "other"], description: "create_event: тип; meeting, если не применимо" },
    range: { type: "string", enum: ["today", "tomorrow", "week"], description: "show_schedule: период; week, если не применимо" },
    reason: { type: "string", description: "unknown: почему не получилось; пустая строка, если не применимо" },
  },
  required: ["intent", "what", "due", "assignees", "text", "remind_at", "task_hint", "title", "starts_at", "place", "participants", "kind", "range", "reason"],
  additionalProperties: false,
} as const;

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
export function validateIntent(raw: unknown): Intent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return unknown("invalid");
  const r = raw as Record<string, unknown>;
  switch (r.intent) {
    case "create_task": {
      const what = str(r.what, 3000);
      const assignees = mentions(r.assignees);
      const due = str(r.due) === null ? null : normalizeLocal(r.due);
      if (!what || !assignees?.length || (str(r.due) !== null && !due)) return unknown("invalid");
      return { intent: "create_task", what, assignees, due };
    }
    case "create_reminder": {
      const text = str(r.text, 1000);
      const remind_at = normalizeLocal(r.remind_at);
      if (!text || !remind_at) return unknown("invalid");
      return { intent: "create_reminder", text, remind_at, task_hint: str(r.task_hint, 300) };
    }
    case "create_event": {
      const title = str(r.title, 200);
      const starts_at = normalizeLocal(r.starts_at);
      const participants = mentions(r.participants);
      const kind = r.kind === "club_event" || r.kind === "other" ? r.kind : "meeting";
      if (!title || !starts_at || !participants) return unknown("invalid");
      return { intent: "create_event", title, starts_at, place: str(r.place, 200), participants, kind };
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
