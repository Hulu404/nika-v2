import { mskMidnight } from "../databot/dates";
import { addDays, mskToday } from "../databot/time";

/**
 * Тихие часы «Пятницы»: 22:00–09:00 МСК. В это время автоматические
 * сообщения не уходят — откладываются в team_outbox до 09:00 (outbox.ts)
 * или считаются заново тикером утром.
 *
 * Исключения:
 *   • личные напоминания, которые человек сам поставил на время («напомни мне
 *     в 23:30»), — уходят точно в срок (ai/assistant.ts → dispatchTeamMinute);
 *   • сводка фаундерам в 22:30 — по расписанию (founders/), она и есть
 *     вечерний срез, в том числе просрочек.
 */

export const QUIET_FROM_HOUR = 22;
export const QUIET_UNTIL_HOUR = 9;
/** Напоминание о сроке, которое попало бы в тихие часы, уходит накануне в 21:30. */
export const QUIET_EVE_MINUTES = 21 * 60 + 30;

/** Минуты от полуночи по Москве. */
export function mskMinutes(now: Date): number {
  const [h, m] = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(now).split(":").map(Number);
  return h * 60 + m;
}

export function isQuiet(now: Date): boolean {
  const m = mskMinutes(now);
  return m >= QUIET_FROM_HOUR * 60 || m < QUIET_UNTIL_HOUR * 60;
}

/** 21:30–22:00: последние полчаса перед тихими часами. */
export function isQuietEve(now: Date): boolean {
  const m = mskMinutes(now);
  return m >= QUIET_EVE_MINUTES && m < QUIET_FROM_HOUR * 60;
}

/** Ближайшие 09:00 МСК после now (сегодня, если сейчас раньше 09:00). */
export function quietEnd(now: Date): Date {
  const today = mskToday(now);
  const nine = new Date(mskMidnight(today).getTime() + QUIET_UNTIL_HOUR * 3_600_000);
  return nine.getTime() > now.getTime() ? nine : new Date(mskMidnight(addDays(today, 1)).getTime() + QUIET_UNTIL_HOUR * 3_600_000);
}

/** «в 9:00» — когда уйдёт отложенное. */
export const QUIET_END_LABEL = `${QUIET_UNTIL_HOUR}:00`;
