import { mskMidnight, mskWeekday } from "./dates";
import { addDays, mskTime, mskToday } from "./time";

/**
 * Срок задачи из /assign: «… до пт 18:00», «до 03.10», «до завтра», «до 18:00».
 * Срок — только в конце строки и только после «до»: так он не путается с
 * датами внутри текста задачи («перенести 03.10 на 05.10»).
 *
 * Без времени срок — конец дня (23:59 МСК): «до пятницы» значит «в пятницу
 * ещё можно».
 */

export class DueError extends Error {}

const WEEKDAYS: Record<string, number> = {
  пн: 1, понедельник: 1, понедельника: 1,
  вт: 2, вторник: 2, вторника: 2,
  ср: 3, среда: 3, среды: 3, среду: 3,
  чт: 4, четверг: 4, четверга: 4,
  пт: 5, пятница: 5, пятницы: 5, пятницу: 5,
  сб: 6, суббота: 6, субботы: 6, субботу: 6,
  вс: 7, воскресенье: 7, воскресенья: 7,
};
const RELATIVE: Record<string, number> = { сегодня: 0, завтра: 1, послезавтра: 2 };
const WEEKDAY_SHORT = ["", "пн", "вт", "ср", "чт", "пт", "сб", "вс"];

const DAY = `(?:${[...Object.keys(RELATIVE), ...Object.keys(WEEKDAYS)].join("|")}|\\d{1,2}\\.\\d{1,2}(?:\\.\\d{2}(?:\\d{2})?)?)`;
const TIME = "(?:в\\s+)?(\\d{1,2}):(\\d{2})";
/** «до» после начала строки, пробела или разделителя; день и/или время; точка в конце допустима. */
const TAIL = new RegExp(`(^|[\\s,;—–-])до\\s+(?:(${DAY})(?:,?\\s+${TIME})?|${TIME})\\s*\\.?$`, "iu");
const END_OF_DAY = { hour: 23, minute: 59 };
/** «до 10.01» в декабре — это январь следующего года, а не опечатка. */
const YEAR_ROLL_DAYS = 60;

function at(ymd: string, hour: number, minute: number): Date {
  if (hour > 23 || minute > 59) throw new DueError("Время срока — ЧЧ:ММ, от 00:00 до 23:59.");
  return new Date(mskMidnight(ymd).getTime() + (hour * 60 + minute) * 60_000);
}

function resolveDay(token: string, now: Date, hour: number, minute: number): string {
  const today = mskToday(now);
  const word = token.toLowerCase();
  if (word in RELATIVE) return addDays(today, RELATIVE[word]);
  if (word in WEEKDAYS) {
    const ahead = (WEEKDAYS[word] - mskWeekday(today) + 7) % 7;
    const ymd = addDays(today, ahead);
    // «до пт», сказанное в пятницу вечером после срока, — следующая пятница.
    return ahead === 0 && at(ymd, hour, minute) <= now ? addDays(ymd, 7) : ymd;
  }
  const [d, m, y] = word.split(".").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  let year = y === undefined ? Number(today.slice(0, 4)) : y < 100 ? 2000 + y : y;
  let ymd = `${year}-${pad(m)}-${pad(d)}`;
  const valid = (v: string) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
    new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
  if (!valid(ymd)) throw new DueError(`Нет такой даты: ${token}.`);
  if (y === undefined && Date.parse(`${ymd}T00:00:00Z`) < Date.parse(`${today}T00:00:00Z`) - YEAR_ROLL_DAYS * 86_400_000) {
    year += 1;
    ymd = `${year}-${pad(m)}-${pad(d)}`;
    if (!valid(ymd)) throw new DueError(`Нет такой даты: ${token}.`);
  }
  return ymd;
}

/** Срок из готового выражения без «до»: «пт 18:00», «03.10», «18:00». */
export function parseDue(expr: string, now: Date): Date {
  const found = extractDue(`до ${expr.trim()}`, now);
  if (!found.due) throw new DueError("Не понял срок. Примеры: «пт 18:00», «03.10», «завтра», «18:00».");
  return found.due;
}

/**
 * Отделить срок от текста задачи. Нет «до …» в конце — due = null, текст как
 * есть. Срок есть, но уже прошёл или даты не существует — DueError: молча
 * сохранить задачу без срока хуже, чем переспросить.
 */
export function extractDue(text: string, now: Date): { what: string; due: Date | null } {
  const m = TAIL.exec(text);
  if (!m) return { what: text, due: null };
  const [, lead, dayToken, dayHour, dayMinute, onlyHour, onlyMinute] = m;
  const hour = Number(dayHour ?? onlyHour ?? END_OF_DAY.hour);
  const minute = Number(dayMinute ?? onlyMinute ?? END_OF_DAY.minute);
  const ymd = dayToken ? resolveDay(dayToken, now, hour, minute) : mskToday(now);
  const due = at(ymd, hour, minute);
  if (due <= now) throw new DueError("Срок уже прошёл.");
  const what = text.slice(0, m.index + lead.length).replace(/[\s,;—–-]+$/u, "").trim();
  return { what, due };
}

/** «пт 03.10, 18:00» или «пт 03.10» для срока «до конца дня». */
export function formatDue(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const ymd = mskToday(d);
  const day = `${WEEKDAY_SHORT[mskWeekday(ymd)]} ${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
  const time = mskTime(d);
  return time === "23:59" ? day : `${day}, ${time}`;
}
