import type { ClubSurvey } from "./survey-config";
import { parseTimeRange, type TimeRangeError } from "./time-range";

/**
 * Ответ о времени, где человек сам называет дни: «чт с 19 до 21, пт с 18 до
 * 20», «в субботу с 11 до 14, а в воскресенье после 12», «пн-ср 19-21»,
 * «по будням вечером, в выходные с 11», «с 19 до 21 в четверг», «29.10 с 19»,
 * «в остальные дни с 18 до 20». Чистая функция: ни базы, ни часов.
 *
 * Как разбираем:
 *   1. Находим упоминания дней: дни недели в любой форме, «будни», «выходные»,
 *      «все дни», «остальные дни», даты опроса («29.10», «29 октября»).
 *      Соседние упоминания, между которыми только «и», запятая, «по» или
 *      тире, — один набор дней; «пн-ср» и «с пн по ср» — промежуток.
 *   2. Текст между наборами — время. Пара «дни → время» (дни впереди) или
 *      «время → дни» (время впереди); если ни так, ни так — не разобрали.
 *   3. Время читает parseTimeRange; «любое время», «весь день» — любое.
 *   Упоминаний нет — ответ целиком про текущую группу дней, как раньше.
 *
 * Дни недели — JS getDay: Вс=0, Пн=1 … Сб=6.
 */

export type DayTime = { from: string; to: string } | { any: true };

/** Время по дням недели: ключ — JS getDay строкой ("0"…"6"). */
export type DayTimes = Record<string, DayTime>;

export interface DayTimesOptions {
  survey: Pick<ClubSurvey, "days" | "sessionMinutes" | "dayFrom" | "dayTo">;
  /** Дни недели, которые человек выбрал в опросе. */
  chosen: readonly number[];
  /** Выбранные дни, у которых ещё нет времени: их значат «остальные дни». */
  uncovered: readonly number[];
}

export type DayTimesResult =
  | { ok: true; kind: "group"; time: DayTime }
  | { ok: true; kind: "days"; times: DayTimes }
  | { ok: false; error: TimeRangeError | "other_days" };

/** Порядок недели для промежутков «пн-ср»: Пн…Вс. */
const WEEK: readonly number[] = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAYS_WD: readonly number[] = [1, 2, 3, 4, 5];
const WEEKDAYS_WE: readonly number[] = [6, 0];

const L = "(?<![а-я0-9])";
const R = "(?![а-я])";

const WEEKDAY_WORDS: ReadonlyArray<[number, string]> = [
  [1, "пн|понед[а-я]*"],
  [2, "вт|втор|вторн[а-я]*"],
  [3, "ср|сред(?:а|у|ы|е|ой|ам|ами)"],
  [4, "чт|чет|четв|четверг[а-я]*"],
  [5, "пт|пят|пятн|пятниц[а-я]*"],
  [6, "сб|суб|субб|суббот[а-я]*"],
  [0, "вс|вос|воскр|воскресен[а-я]*|воскресень[а-я]*"],
];

/** Наборы словами. rest — «остальные дни», считаем после всех остальных. */
const SET_WORDS: ReadonlyArray<["wd" | "we" | "all" | "rest", string]> = [
  ["all", "все\\s+дн[а-я]*|каждый\\s+день|любой\\s+день|любые\\s+дни"],
  ["rest", "остальн[а-я]*(?:\\s+дн[а-я]*)?|други[ея]\\s+дн[а-я]*"],
  ["wd", "будн[а-я]*|рабоч[а-я]*(?:\\s+дн[а-я]*)?"],
  ["we", "выходн[а-я]*(?:\\s+дн[а-я]*)?"],
];

const MONTHS = ["январ", "феврал", "март", "апрел", "ма[йя]", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];

const ANY_TIME = new RegExp(
  `${L}(?:любо[ейм]|когда\\s+угодно|весь\\s+день|без\\s+разницы|неважно|не\\s+важно|всегда)${R}`,
);
const TIME_WORDS = new RegExp(`${L}(?:утром|днем|вечером)${R}`);

/** Остаток между упоминаниями, после которого они — один набор дней. */
const JOINER_WORDS = new Set(["и", "или", "либо", "по", "до", "в", "во", "на", "а", "также", "с", "со"]);
const RANGE_WORDS = new Set(["по", "до"]);

type DaySet = { kind: "days"; days: number[] } | { kind: "rest" };

interface Mention {
  start: number;
  end: number;
  set: DaySet;
}

function normalize(raw: string): string {
  return raw.toLowerCase().replace(/ё/g, "е");
}

function surveyDateWeekday(survey: DayTimesOptions["survey"], day: number, month: number): number | null {
  const hit = survey.days.find((d) => {
    const [, m, dd] = d.date.split("-").map(Number);
    return m === month && dd === day;
  });
  return hit ? new Date(`${hit.date}T00:00:00Z`).getUTCDay() : null;
}

function findMentions(text: string, survey: DayTimesOptions["survey"]): Mention[] {
  const found: Mention[] = [];
  const push = (start: number, end: number, set: DaySet) => {
    if (found.some((m) => start < m.end && m.start < end)) return;
    found.push({ start, end, set });
  };

  // Даты — первыми: «29.10» иначе развалится на числа времени.
  const numeric = /(?<![\d.:])(\d{1,2})\.(\d{1,2})(?:\.\d{2,4})?(?![\d:])/g;
  for (const m of text.matchAll(numeric)) {
    const wd = surveyDateWeekday(survey, Number(m[1]), Number(m[2]));
    if (wd !== null) push(m.index, m.index + m[0].length, { kind: "days", days: [wd] });
  }
  const worded = new RegExp(`(?<!\\d)(\\d{1,2})\\s+(${MONTHS.join("|")})[а-я]*`, "g");
  for (const m of text.matchAll(worded)) {
    const month = MONTHS.findIndex((stem) => new RegExp(`^${stem}`).test(m[2])) + 1;
    const wd = surveyDateWeekday(survey, Number(m[1]), month);
    if (wd !== null) push(m.index, m.index + m[0].length, { kind: "days", days: [wd] });
  }

  for (const [set, pattern] of SET_WORDS) {
    for (const m of text.matchAll(new RegExp(`${L}(?:${pattern})${R}`, "g"))) {
      const daySet: DaySet =
        set === "rest"
          ? { kind: "rest" }
          : { kind: "days", days: [...(set === "wd" ? WEEKDAYS_WD : set === "we" ? WEEKDAYS_WE : WEEK)] };
      push(m.index, m.index + m[0].length, daySet);
    }
  }
  for (const [day, pattern] of WEEKDAY_WORDS) {
    for (const m of text.matchAll(new RegExp(`${L}(?:${pattern})${R}`, "g"))) {
      push(m.index, m.index + m[0].length, { kind: "days", days: [day] });
    }
  }

  return found.sort((a, b) => a.start - b.start);
}

/** Слова между упоминаниями; null — там есть что-то кроме связок. */
function joinerWords(between: string): string[] | null {
  const words = between.replace(/[\s,;/&+\-‐‑‒–—−.:]+/g, " ").trim();
  if (!words) return [];
  const list = words.split(" ");
  return list.every((w) => JOINER_WORDS.has(w)) ? list : null;
}

function weekRange(from: number, to: number): number[] {
  const a = WEEK.indexOf(from);
  const b = WEEK.indexOf(to);
  if (a <= b) return WEEK.slice(a, b + 1);
  return [...WEEK.slice(a), ...WEEK.slice(0, b + 1)];
}

interface DayGroupMention {
  start: number;
  end: number;
  sets: DaySet[];
}

/** Склеить соседние упоминания в наборы; «пн-ср» и «пн по ср» — промежуток. */
function groupMentions(text: string, mentions: Mention[]): DayGroupMention[] {
  const groups: DayGroupMention[] = [];
  for (const m of mentions) {
    const last = groups[groups.length - 1];
    const between = last ? text.slice(last.end, m.start) : "";
    const joiner = last ? joinerWords(between) : null;
    if (!last || joiner === null) {
      groups.push({ start: m.start, end: m.end, sets: [m.set] });
      continue;
    }

    const prev = last.sets[last.sets.length - 1];
    const isRange = /[-‐‑‒–—−]/.test(between) || joiner.some((w) => RANGE_WORDS.has(w));
    if (isRange && prev.kind === "days" && prev.days.length === 1 && m.set.kind === "days" && m.set.days.length === 1) {
      last.sets[last.sets.length - 1] = { kind: "days", days: weekRange(prev.days[0], m.set.days[0]) };
    } else {
      last.sets.push(m.set);
    }
    last.end = m.end;
  }
  return groups;
}

function hasTime(chunk: string): boolean {
  return /\d/.test(chunk) || ANY_TIME.test(chunk) || TIME_WORDS.test(chunk);
}

type ChunkTime = { ok: true; time: DayTime } | { ok: false; error: TimeRangeError };

function chunkTime(chunk: string, survey: DayTimesOptions["survey"]): ChunkTime {
  if (!/\d/.test(chunk) && ANY_TIME.test(chunk)) return { ok: true, time: { any: true } };
  const parsed = parseTimeRange(chunk, survey);
  return parsed.ok ? { ok: true, time: { from: parsed.from, to: parsed.to } } : parsed;
}

/** Пары «набор дней → кусок текста со временем»; null — дни и время без пары. */
function pairUp(text: string, groups: DayGroupMention[]): [DayGroupMention, string][] | null {
  const chunks = [text.slice(0, groups[0].start)];
  groups.forEach((g, i) => chunks.push(text.slice(g.end, groups[i + 1]?.start ?? text.length)));
  const has = chunks.map(hasTime);
  const n = groups.length;

  if (!has[0] && has.slice(1).every(Boolean)) return groups.map((g, i) => [g, chunks[i + 1]]);
  if (has.slice(0, n).every(Boolean) && !has[n]) return groups.map((g, i) => [g, chunks[i]]);
  return null;
}

export function parseDayTimes(raw: string, opts: DayTimesOptions): DayTimesResult {
  const text = normalize(raw.trim());
  const mentions = findMentions(text, opts.survey);

  if (mentions.length === 0) {
    const t = chunkTime(text, opts.survey);
    return t.ok ? { ok: true, kind: "group", time: t.time } : t;
  }

  const pairs = pairUp(text, groupMentions(text, mentions));
  if (!pairs) return { ok: false, error: "unparsed" };

  const parsed: { sets: DaySet[]; time: DayTime }[] = [];
  for (const [group, chunk] of pairs) {
    const t = chunkTime(chunk, opts.survey);
    if (!t.ok) return t;
    parsed.push({ sets: group.sets, time: t.time });
  }

  const chosen = new Set(opts.chosen);
  const times: DayTimes = {};
  const named = new Set<number>();

  // Сначала широкие наборы («будни», «все дни»), потом отдельные дни: «по
  // будням с 19, в пт с 18» — у пятницы своё время.
  const byWidth = parsed
    .flatMap(({ sets, time }) => sets.map((set) => ({ set, time })))
    .filter((x): x is { set: { kind: "days"; days: number[] }; time: DayTime } => x.set.kind === "days")
    .sort((a, b) => b.set.days.length - a.set.days.length);
  for (const { set, time } of byWidth) {
    for (const day of set.days) {
      named.add(day);
      if (chosen.has(day)) times[String(day)] = time;
    }
  }

  for (const { sets, time } of parsed) {
    if (!sets.some((s) => s.kind === "rest")) continue;
    for (const day of opts.uncovered) {
      if (!named.has(day) && chosen.has(day)) times[String(day)] = time;
    }
  }

  if (Object.keys(times).length === 0) return { ok: false, error: "other_days" };
  return { ok: true, kind: "days", times };
}
