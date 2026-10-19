import type { ClubSurvey } from "./survey-config";
import type { ResultVariant, SurveyResponseRow, SurveyResultRow } from "./survey-store";
import { fromMinutes, toMinutes } from "./time-range";

/**
 * Счёт по ответам: группы дней, кто помещается в слот, топ слотов для
 * организатора и вариант итога для человека. Чистые функции от строк базы.
 *
 * Слот — день-кандидат + время начала с шагом 30 минут. Человек «может прийти»
 * на слот, если выбрал «Приду», отметил этот день и занятие целиком помещается
 * в его промежуток для группы этого дня (или там «любое время»). Ответы,
 * сохранённые текстом, в счёт не идут: их читает организатор глазами.
 */

/** Группа дней: будни (пн–пт) или выходные (сб–вс). */
export type DayGroup = "wd" | "we";

/** Шаг сетки слотов, минуты. */
export const SLOT_STEP_MIN = 30;

/** Строка ответа в объёме, нужном для счёта. */
export type SlotRow = Pick<
  SurveyResponseRow,
  | "attend"
  | "days"
  | "weekdays"
  | "wd_from"
  | "wd_to"
  | "wd_any"
  | "wd_raw"
  | "we_from"
  | "we_to"
  | "we_any"
  | "we_raw"
>;

/** Группа дня недели в формате JS getDay (Вс=0…Сб=6). */
export function weekdayGroup(weekday: number): DayGroup {
  return weekday === 0 || weekday === 6 ? "we" : "wd";
}

/** Группа даты YYYY-MM-DD. День недели считаем в UTC: дата без времени. */
export function dayGroup(date: string): DayGroup {
  return weekdayGroup(new Date(`${date}T00:00:00Z`).getUTCDay());
}

/** Группы, которые надо спросить о времени, в порядке вопросов: сначала будни. */
export function groupsOfDays(dates: readonly string[]): DayGroup[] {
  const set = new Set(dates.map(dayGroup));
  return (["wd", "we"] as const).filter((g) => set.has(g));
}

export function groupsOfWeekdays(weekdays: readonly number[]): DayGroup[] {
  const set = new Set(weekdays.map(weekdayGroup));
  return (["wd", "we"] as const).filter((g) => set.has(g));
}

/** Что человек ответил про время в группе. */
export type GroupTime =
  | { kind: "range"; from: string; to: string }
  | { kind: "any" }
  | { kind: "raw"; raw: string }
  | { kind: "none" };

export function groupTime(row: SlotRow, group: DayGroup): GroupTime {
  const from = group === "wd" ? row.wd_from : row.we_from;
  const to = group === "wd" ? row.wd_to : row.we_to;
  const any = group === "wd" ? row.wd_any : row.we_any;
  const raw = group === "wd" ? row.wd_raw : row.we_raw;

  if (any) return { kind: "any" };
  if (from && to) return { kind: "range", from, to };
  if (raw) return { kind: "raw", raw };
  return { kind: "none" };
}

/** Помещается ли занятие [start, start + session) в ответ человека на этот день. */
export function canAttend(row: SlotRow, date: string, startMin: number, sessionMin: number): boolean {
  if (row.attend !== "come" || !row.days.includes(date)) return false;
  const t = groupTime(row, dayGroup(date));
  if (t.kind === "any") return true;
  if (t.kind !== "range") return false;
  return toMinutes(t.from) <= startMin && startMin + sessionMin <= toMinutes(t.to);
}

export interface Slot {
  date: string;
  /** HH:MM */
  start: string;
  count: number;
}

/**
 * Лучшие слоты: больше людей — выше; при равенстве — раньше день, затем
 * раньше время. Слоты, куда не может прийти никто, не показываем.
 */
export function topSlots(rows: readonly SlotRow[], survey: ClubSurvey, limit = 5): Slot[] {
  const first = toMinutes(survey.dayFrom);
  const last = toMinutes(survey.dayTo) - survey.sessionMinutes;
  const slots: Slot[] = [];

  for (const day of survey.days) {
    for (let start = first; start <= last; start += SLOT_STEP_MIN) {
      const count = rows.filter((r) => canAttend(r, day.date, start, survey.sessionMinutes)).length;
      if (count > 0) slots.push({ date: day.date, start: fromMinutes(start), count });
    }
  }

  return [...slots]
    .sort((a, b) => b.count - a.count || a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    .slice(0, limit);
}

/** Вариант итога: «совпал» (текст 8) или «не совпал» (текст 9). */
export function resultVariant(
  row: SlotRow,
  result: Pick<SurveyResultRow, "meet_date" | "meet_time">,
  survey: ClubSurvey,
): ResultVariant {
  return canAttend(row, result.meet_date, toMinutes(result.meet_time), survey.sessionMinutes)
    ? "match"
    : "nomatch";
}

// ── Сводка для организатора ───────────────────────────────────────────────────

export type SummaryRow = SlotRow &
  Pick<SurveyResponseRow, "chat_id" | "step" | "source" | "name" | "username" | "blocked_at">;

export interface SurveySummary {
  asked: number;
  byBroadcast: number;
  byLink: number;
  /** Нажали «Интересно» (в том числе дальше не пошли). */
  interested: number;
  /** «Пока пропущу». */
  skipped: number;
  /** «Посмотрю итог в чате». */
  declined: number;
  /** Закончили веткой «Приду». */
  coming: number;
  /** Закончили веткой «Присоединюсь позже». */
  later: number;
  /** Дали согласие, но ещё не закончили. */
  inProgress: number;
  /** Ни одной кнопки на первом сообщении. */
  silent: number;
  /** Заблокировали бота. */
  blocked: number;
  /** Сколько «придут» отметили каждый день-кандидат. */
  perDay: { date: string; count: number }[];
  slots: Slot[];
  /** Закончившие «Приду» — поимённо. */
  comingList: SummaryRow[];
  /** Ответы о времени, сохранённые текстом. */
  rawAnswers: { row: SummaryRow; group: DayGroup; raw: string }[];
}

const STEPS_AFTER_INTEREST = new Set(["consent", "declined", "attend", "days", "later", "time", "done", "later_done"]);
const STEPS_IN_PROGRESS = new Set(["consent", "attend", "days", "later", "time"]);

export function surveySummary(rows: readonly SummaryRow[], survey: ClubSurvey): SurveySummary {
  const count = (pred: (r: SummaryRow) => boolean) => rows.filter(pred).length;
  const comingList = rows.filter((r) => r.step === "done" && r.attend === "come");

  const rawAnswers: SurveySummary["rawAnswers"] = [];
  for (const row of rows) {
    for (const group of ["wd", "we"] as const) {
      const t = groupTime(row, group);
      if (t.kind === "raw") rawAnswers.push({ row, group, raw: t.raw });
    }
  }

  return {
    asked: rows.length,
    byBroadcast: count((r) => r.source === "broadcast"),
    byLink: count((r) => r.source === "link"),
    interested: count((r) => STEPS_AFTER_INTEREST.has(r.step)),
    skipped: count((r) => r.step === "skipped"),
    declined: count((r) => r.step === "declined"),
    coming: comingList.length,
    later: count((r) => r.step === "later_done"),
    inProgress: count((r) => STEPS_IN_PROGRESS.has(r.step)),
    silent: count((r) => r.step === "interest" && !r.blocked_at),
    blocked: count((r) => r.blocked_at !== null),
    perDay: survey.days.map((d) => ({
      date: d.date,
      count: comingList.filter((r) => r.days.includes(d.date)).length,
    })),
    slots: topSlots(comingList, survey),
    comingList,
    rawAnswers,
  };
}
