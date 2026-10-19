import { DEFAULT_TZ, localParts } from "../telegram/schedule";
import type { ClubSurvey, HourWindow } from "./survey-config";
import type { SurveyResponseRow, SurveyResultRow } from "./survey-store";

/**
 * Когда опрос клуба пишет сам. Чистые функции от now — как invite-schedule.ts:
 * расписание проверяется тестами без подмены системных часов.
 *
 *   напоминание незавершившим — один раз, через reminderDelayHours после
 *     первого сообщения, в окне reminderWindow по МСК и раньше reminderDeadline;
 *   напоминание накануне встречи — в окне eveWindow по МСК в день перед meet_date.
 *
 * Окно «с fromHour до toHour»: час >= fromHour и < toHour. Проспанный тик
 * (деплой) догоняет на следующем проходе в том же окне; дедуп — в базе.
 */

const HOUR_MS = 60 * 60 * 1000;

export function inWindow(hour: number, window: HourWindow): boolean {
  return hour >= window.fromHour && hour < window.toHour;
}

export type ReminderPass = { open: true; askedBefore: Date } | { open: false; reason: string };

/** Можно ли сейчас вообще напоминать; askedBefore — последний подходящий asked_at. */
export function reminderPass(survey: ClubSurvey, now: Date): ReminderPass {
  if (now.getTime() >= new Date(survey.reminderDeadline).getTime()) {
    return { open: false, reason: "срок напоминаний прошёл" };
  }
  const msk = localParts(DEFAULT_TZ, now);
  if (!inWindow(msk.hour, survey.reminderWindow)) {
    return {
      open: false,
      reason: `вне окна ${survey.reminderWindow.fromHour}:00–${survey.reminderWindow.toHour}:00 МСК`,
    };
  }
  return { open: true, askedBefore: new Date(now.getTime() - survey.reminderDelayHours * HOUR_MS) };
}

const FINISHED = new Set(["done", "later_done"]);

/**
 * Строка подходит под напоминание: согласие есть, опрос не закончен, ещё не
 * напоминали, бот не заблокирован, итога ещё не было и с первого сообщения
 * прошло reminderDelayHours. Окно и срок — reminderPass.
 */
export function reminderDueForRow(
  row: Pick<SurveyResponseRow, "consent_at" | "step" | "reminded_at" | "blocked_at" | "result_id" | "asked_at">,
  survey: ClubSurvey,
  now: Date,
): boolean {
  if (!row.consent_at || FINISHED.has(row.step)) return false;
  if (row.reminded_at || row.blocked_at || row.result_id !== null) return false;
  return now.getTime() - new Date(row.asked_at).getTime() >= survey.reminderDelayHours * HOUR_MS;
}

/** Дата YYYY-MM-DD на сутки раньше. */
export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Сейчас — вечер накануне встречи по МСК. */
export function evePassOpen(
  survey: ClubSurvey,
  result: Pick<SurveyResultRow, "meet_date"> | null,
  now: Date,
): boolean {
  if (!result) return false;
  const msk = localParts(DEFAULT_TZ, now);
  return msk.ymd === dayBefore(result.meet_date) && inWindow(msk.hour, survey.eveWindow);
}
