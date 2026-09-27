import { normalizeText } from "./normalize";
import { DATABOT_TZ, addDays, mskToday } from "./time";
import { isIsoDate, parsePeriodCode } from "./validate";

/**
 * Даты и периоды бота данных (ТЗ 4.3, 4.6, 9, 10): что значат «за неделю»,
 * «прошлая неделя», «октябрь», «с 01.10 по 07.10» и «в субботу».
 *
 * Период — полуинтервал моментов [from, to), ровно как у SQL-функций отчётов
 * (`clicked_at >= from and clicked_at < to`). Границы — московская полночь
 * либо now: неделя с понедельника, сутки по Москве (ТЗ 10). Сервер живёт в
 * UTC, поэтому ни одна функция здесь не смотрит на локальный пояс процесса:
 * календарная дата по Москве берётся из Intl (mskToday), а полночь строится
 * через смещение, которое тоже отдаёт Intl. +03:00 не хардкодим: у Москвы
 * бывали и +04:00, и летнее время, и если пояс снова поменяют, база tzdata
 * обновится вместе с Node, а код — нет.
 *
 * fromYmd/toYmd — календарные даты для подписей и для SQL, которому удобнее
 * даты: toYmd — последняя дата ВКЛЮЧИТЕЛЬНО, поэтому «сегодня» до 14:32 — это
 * fromYmd = toYmd = сегодня, а не «до завтра».
 */

export type PeriodKind =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "last_week"
  | "this_week"
  | "this_month"
  | "month"
  | "range";

export interface Period {
  kind: PeriodKind;
  /** Начало: московская полночь. */
  from: Date;
  /** Конец, не включительно: московская полночь или now. */
  to: Date;
  /** Первая московская дата периода, YYYY-MM-DD. */
  fromYmd: string;
  /** Последняя московская дата периода включительно, YYYY-MM-DD. */
  toYmd: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Потолок длины периода в календарных днях — тот же, что PERIOD_MAX_DAYS. */
const MAX_DAYS = 366;

// ---------------------------------------------------------------------------
// Московское время

const OFFSET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: DATABOT_TZ,
  timeZoneName: "longOffset",
});

/**
 * Смещение Москвы от UTC в этот момент, мс. longOffset отдаёт «GMT+03:00»,
 * для нулевого смещения — голое «GMT», а для дат до 1919 года — местное
 * среднее время с секундами («GMT+02:30:17»); понимаем все три.
 */
function mskOffsetMs(at: Date): number {
  const v = OFFSET_FMT.formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
  const m = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?)?$/.exec(v);
  if (!m) throw new Error(`Непонятное смещение пояса: ${v}`);
  if (!m[1]) return 0;
  const sec = Number(m[2]) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
  return (m[1] === "-" ? -1 : 1) * sec * 1000;
}

/**
 * Момент 00:00 по Москве этой даты. Смещение берём дважды: сначала на
 * UTC-полночь (приближение), потом на полученный момент — если пояс в эти
 * сутки менял смещение, второй шаг встаёт на верное. new Date("YYYY-…Z")
 * вместо Date.UTC — тот не переносит годы 0–99 в 1900-е.
 */
export function mskMidnight(ymd: string): Date {
  if (!isIsoDate(ymd)) throw new RangeError(`Не дата: ${ymd}`);
  const utc = new Date(`${ymd}T00:00:00Z`).getTime();
  const guess = utc - mskOffsetMs(new Date(utc));
  return new Date(utc - mskOffsetMs(new Date(guess)));
}

/** День недели даты: 1 = пн … 7 = вс. У даты нет пояса — считаем в UTC. */
export function mskWeekday(ymd: string): number {
  if (!isIsoDate(ymd)) throw new RangeError(`Не дата: ${ymd}`);
  const d = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Московская дата момента. */
function ymdOf(d: Date): string {
  return mskToday(d);
}

/** Сколько суток от a до b (b − a), обе — календарные даты. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymdFrom(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;
}

function daysInMonth(y: number, m: number): number {
  const t = new Date(Date.UTC(2000, m, 0));
  t.setUTCFullYear(y, m, 0);
  return t.getUTCDate();
}

/** Первое число месяца, сдвинутого на delta от (y, m). */
function monthStart(y: number, m: number, delta = 0): { y: number; m: number; ymd: string } {
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return { y: ny, m: nm, ymd: ymdFrom(ny, nm, 1) };
}

/**
 * Тот же момент суток n дней спустя (n < 0 — раньше). Через календарь, а не
 * через ±n·24 ч: сутки с переводом часов короче или длиннее.
 */
function shiftDays(d: Date, n: number): Date {
  const ymd = ymdOf(d);
  const intoDay = d.getTime() - mskMidnight(ymd).getTime();
  return new Date(mskMidnight(addDays(ymd, n)).getTime() + intoDay);
}

function makePeriod(kind: PeriodKind, from: Date, to: Date): Period {
  const fromYmd = ymdOf(from);
  // Пустой период (to = from, например «эта неделя» ровно в пн 00:00) —
  // последний день совпадает с первым, а не уезжает на день назад.
  const toYmd = to.getTime() > from.getTime() ? ymdOf(new Date(to.getTime() - 1)) : fromYmd;
  return { kind, from, to, fromYmd, toYmd };
}

// ---------------------------------------------------------------------------
// Периоды

/** Понедельник недели, в которую попадает дата. */
function mondayOf(ymd: string): string {
  return addDays(ymd, 1 - mskWeekday(ymd));
}

export function periodFor(kind: Exclude<PeriodKind, "month" | "range">, now: Date): Period {
  const today = ymdOf(now);
  const mid = mskMidnight;
  switch (kind) {
    case "today":
      return makePeriod(kind, mid(today), now);
    case "yesterday":
      return makePeriod(kind, mid(addDays(today, -1)), mid(today));
    // «7 дней» — семь календарных дней, включая сегодняшний неполный:
    // так в окно попадает сегодняшнее утро, и цифра совпадает с тем, что
    // человек видит в «сегодня».
    case "7d":
      return makePeriod(kind, mid(addDays(today, -6)), now);
    case "30d":
      return makePeriod(kind, mid(addDays(today, -29)), now);
    // Прошлая неделя — всегда законченные пн–вс. В пн в 00:30 это уже
    // неделя, закончившаяся полчаса назад, а не текущая.
    case "last_week": {
      const monday = mondayOf(today);
      return makePeriod(kind, mid(addDays(monday, -7)), mid(monday));
    }
    case "this_week":
      return makePeriod(kind, mid(mondayOf(today)), now);
    case "this_month":
      return makePeriod(kind, mid(`${today.slice(0, 8)}01`), now);
  }
}

/**
 * Календарный месяц года y; если он ещё идёт — до now. Целиком будущий месяц
 * («октябрь 2027») отдаём как есть, до 1-го следующего: пусть clampPeriod
 * увидит будущее и бот скажет, что поправил.
 */
function monthOfYear(y: number, month: number, now: Date): Period {
  const start = mskMidnight(monthStart(y, month).ymd);
  const next = mskMidnight(monthStart(y, month, 1).ymd);
  const running = now.getTime() >= start.getTime() && now.getTime() < next.getTime();
  return makePeriod("month", start, running ? now : next);
}

/**
 * «Октябрь» без года: этого года, если октябрь уже начался по Москве, иначе
 * прошлого. 27 сентября «за октябрь» — это прошлый октябрь: про будущий
 * месяц цифр ещё нет, а спрашивают обычно про законченный.
 */
export function monthPeriod(month: number, now: Date): Period {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Не месяц: ${month}`);
  }
  const today = ymdOf(now);
  const y = Number(today.slice(0, 4));
  const cur = Number(today.slice(5, 7));
  return monthOfYear(month <= cur ? y : y - 1, month, now);
}

/**
 * Свой период, обе даты включительно. Будущее и длину не правит — это делает
 * clampPeriod, чтобы бот мог сказать, что поправил (ТЗ 9).
 */
export function rangePeriod(fromYmd: string, toYmd: string): Period {
  if (!isIsoDate(fromYmd) || !isIsoDate(toYmd)) {
    throw new RangeError(`Не даты: ${fromYmd}, ${toYmd}`);
  }
  if (toYmd < fromYmd) throw new RangeError(`Конец раньше начала: ${fromYmd}, ${toYmd}`);
  return makePeriod("range", mskMidnight(fromYmd), mskMidnight(addDays(toYmd, 1)));
}

/** Период из кнопки: пресеты validate.ts и свой YYYYMMDD-YYYYMMDD. */
export function periodFromCode(code: string, now: Date): Period | null {
  const p = parsePeriodCode(code);
  if (!p) return null;
  if (p.kind === "range") return rangePeriod(p.from, p.to);
  switch (p.preset) {
    case "7d":
      return periodFor("7d", now);
    case "pw":
      return periodFor("last_week", now);
    case "tm":
      return periodFor("this_month", now);
    case "30d":
      return periodFor("30d", now);
  }
}

// ---------------------------------------------------------------------------
// Разбор текста

/*
 * Регэкспы работают по normalizeText: нижний регистр, «е» вместо «ё», из
 * пунктуации остались только точка и дефис между буквами/цифрами. \b в JS
 * не видит кириллицу, поэтому границы слова — явные lookaround по \p{L}\p{N}.
 */
const B = "(?<![\\p{L}\\p{N}])";
const E = "(?![\\p{L}\\p{N}])";

/**
 * Месяцы во всех падежах, что встречаются во фразах: «октябрь», «октября»,
 * «в октябре», «к октябрю», «октябрем». У «март» и «август» именительный без
 * окончания, у «май» своя парадигма.
 */
const MONTH_FORMS = [
  "январ(?:ь|я|е|ю|ем)",
  "феврал(?:ь|я|е|ю|ем)",
  "март(?:а|е|у|ом)?",
  "апрел(?:ь|я|е|ю|ем)",
  "ма(?:й|я|е|ю|ем)",
  "июн(?:ь|я|е|ю|ем)",
  "июл(?:ь|я|е|ю|ем)",
  "август(?:а|е|у|ом)?",
  "сентябр(?:ь|я|е|ю|ем)",
  "октябр(?:ь|я|е|ю|ем)",
  "ноябр(?:ь|я|е|ю|ем)",
  "декабр(?:ь|я|е|ю|ем)",
];
const MONTH_ANY = `(${MONTH_FORMS.join("|")})`;
const MONTH_EXACT = MONTH_FORMS.map((f) => new RegExp(`^(?:${f})$`, "u"));

function monthOfWord(w: string): number {
  return MONTH_EXACT.findIndex((re) => re.test(w)) + 1;
}

/**
 * Числовая дата «03.10», «3.10», «03.10.2026», «3.10.26». Слева не цифра,
 * буква или точка, справа — не продолжение числа: «1.03.10» и «03.10.5» не
 * даты, а версия «v3.10» — тоже.
 */
const DN = "(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{4}|\\d{2}))?";
const DN_L = "(?<![\\p{L}\\p{N}.])";
const DN_R = "(?!\\.?\\p{N})(?![\\p{L}])";

/**
 * Диапазон дат. После нормализации «01.10–07.10» — это «01.10-07.10», а
 * «01.10 – 07.10» — «01.10 07.10» (тире между пробелами ушло), поэтому
 * разделитель — дефис, «по»/«до» или просто пробел.
 */
const RANGE_NUM_RE = new RegExp(`${DN_L}${DN}(?:-| (?:по|до) | )${DN}${DN_R}`, "u");
/** «с 1 по 7 октября», «с 1 октября по 7 октября», «1-7 октября». */
const RANGE_WORD_RE = new RegExp(
  `${B}(\\d{1,2})(?: ${MONTH_ANY})?(?:-| (?:по|до) )(\\d{1,2}) ${MONTH_ANY}(?: (\\d{4}))?${E}`,
  "u",
);
/** «с 01.10» без конца — до сейчас. */
const FROM_NUM_RE = new RegExp(`${B}(?:с|со) ${DN}${DN_R}`, "u");

/**
 * Слова, после которых «неделя»/«месяц»/«7 дней» — уже не наш период:
 * «2 недели», «пару месяцев», «следующая неделя», «позапрошлая неделя».
 * Лучше честное «не поняла», чем тихо посчитанные последние 7 дней.
 */
const NOT_PLAIN =
  "(?<!(?:\\d|два|две|три|четыре|пять|шесть|пару|несколько|нескольк\\p{L}*|следующ\\p{L}*|будущ\\p{L}*|позапрошл\\p{L}*|ближайш\\p{L}*) )";

/** Именованный месяц. «3 октября» — дата забега, а не месяц: слева не число. */
const MONTH_PERIOD_RE = new RegExp(`(?<!\\d )${B}${MONTH_ANY}(?: (\\d{4}))?${E}`, "u");

const re = (s: string) => new RegExp(s, "u");
const PERIOD_RULES: Array<[RegExp, Exclude<PeriodKind, "month" | "range"> | "prev_month"]> = [
  [re(`${B}(?:прошл|предыдущ)\\p{L}* недел`), "last_week"],
  [re(`${B}(?:эт|текущ)\\p{L}* недел`), "this_week"],
  [re(`${B}(?:прошл|предыдущ)\\p{L}* месяц`), "prev_month"],
  [re(`${B}(?:эт|текущ)\\p{L}* месяц|${B}с начала (?:этого |текущего )?месяц`), "this_month"],
  [re(`${B}(?:сегодня|сегодняшн\\p{L}*)${E}`), "today"],
  [re(`${B}(?:вчера|вчерашн\\p{L}*)${E}`), "yesterday"],
  [re(`${NOT_PLAIN}${B}(?:7|семь) (?:дн\\p{L}*|день)${E}`), "7d"],
  [re(`${NOT_PLAIN}${B}(?:30|тридцать) (?:дн\\p{L}*|день)${E}`), "30d"],
  [re(`${NOT_PLAIN}${B}недел\\p{L}*`), "7d"],
  [re(`${NOT_PLAIN}${B}месяц\\p{L}*`), "30d"],
];

interface DayMonth {
  d: number;
  m: number;
  y?: number;
}

function fullYear(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number(s);
  return s.length === 2 ? 2000 + n : n;
}

/** Реальная ли дата; «31.02» и «10.30» (час с минутами) — нет. */
function validYmd(y: number, dm: DayMonth): string | null {
  if (dm.m < 1 || dm.m > 12 || dm.d < 1 || dm.d > daysInMonth(y, dm.m)) return null;
  return ymdFrom(y, dm.m, dm.d);
}

/**
 * Начало периода без года: текущий год, а если так начало в будущем —
 * прошлый (ТЗ: «с 01.10 по 07.10» в сентябре — это прошлогодняя неделя).
 */
function resolveStart(a: DayMonth, today: string): string | null {
  if (a.y !== undefined) return validYmd(a.y, a);
  const y = Number(today.slice(0, 4));
  for (const cand of [y, y - 1]) {
    const ymd = validYmd(cand, a);
    if (ymd && ymd <= today) return ymd;
  }
  return null;
}

/**
 * Диапазон: год начала — resolveStart, конец — того же года, а если его
 * месяц раньше месяца начала — следующего («с 25.12 по 05.01»). «С 07.10 по
 * 01.10» (конец раньше в том же месяце) — опечатка, а не почти годовой
 * период: null.
 */
function resolveRange(a: DayMonth, b: DayMonth, today: string): Period | null {
  const from = resolveStart(a, today);
  if (!from) return null;
  const fy = Number(from.slice(0, 4));
  const by = b.y ?? (b.m < a.m ? fy + 1 : fy);
  const to = validYmd(by, b);
  if (!to || to < from) return null;
  return rangePeriod(from, to);
}

function parseRange(n: string, today: string): Period | null | undefined {
  const num = RANGE_NUM_RE.exec(n);
  if (num) {
    return resolveRange(
      { d: Number(num[1]), m: Number(num[2]), y: fullYear(num[3]) },
      { d: Number(num[4]), m: Number(num[5]), y: fullYear(num[6]) },
      today,
    );
  }
  const w = RANGE_WORD_RE.exec(n);
  if (w) {
    const m2 = monthOfWord(w[4]);
    const m1 = w[2] ? monthOfWord(w[2]) : m2;
    const y = w[5] ? Number(w[5]) : undefined;
    return resolveRange({ d: Number(w[1]), m: m1, y }, { d: Number(w[3]), m: m2, y }, today);
  }
  return undefined;
}

/**
 * Период из фразы. Ищем подстроку — фраза обычно внутри вопроса («сколько
 * пришло из инсты за неделю»). Порядок проверок — от конкретного к общему:
 * даты раньше слов («с 01.10 по 07.10» не должно стать «месяцем»), «прошлая
 * неделя» раньше просто «недели». Будущее и длину не правим — это
 * clampPeriod.
 *
 * Сверх списка ТЗ понимаем «прошлый месяц» (весь прошлый календарный месяц),
 * «октябрь 2025», «с 1 по 7 октября» и открытое «с 01.10» (до сейчас):
 * иначе эти фразы молча стали бы «30 днями».
 */
export function parsePeriod(text: string, now: Date): Period | null {
  const n = normalizeText(text);
  const today = ymdOf(now);

  const range = parseRange(n, today);
  if (range !== undefined) return range;

  const open = FROM_NUM_RE.exec(n);
  if (open) {
    const from = resolveStart({ d: Number(open[1]), m: Number(open[2]), y: fullYear(open[3]) }, today);
    return from ? makePeriod("range", mskMidnight(from), now) : null;
  }

  const month = MONTH_PERIOD_RE.exec(n);
  if (month) {
    const m = monthOfWord(month[1]);
    return month[2] ? monthOfYear(Number(month[2]), m, now) : monthPeriod(m, now);
  }

  for (const [rule, kind] of PERIOD_RULES) {
    if (!rule.test(n)) continue;
    if (kind === "prev_month") {
      return monthPeriod(monthStart(Number(today.slice(0, 4)), Number(today.slice(5, 7)), -1).m, now);
    }
    return periodFor(kind, now);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Правка и сравнение

/**
 * ТЗ 9: период в будущем или длиннее 366 дней бот поправляет и говорит, что
 * поправил. Конец позже now → конец = now; начало тоже в будущем → считать
 * нечего, отдаём «сегодня». Длиннее 366 календарных дней → оставляем
 * последние 366, начало на московской полуночи (как PERIOD_MAX_DAYS: дни
 * включительно, сегодняшний неполный тоже считается днём).
 */
export function clampPeriod(
  p: Period,
  now: Date,
): { period: Period; adjusted: boolean; reason: "future" | "too_long" | null } {
  if (p.to.getTime() > now.getTime()) {
    if (p.from.getTime() >= now.getTime()) {
      return { period: periodFor("today", now), adjusted: true, reason: "future" };
    }
    const cut = makePeriod(p.kind, p.from, now);
    return { period: shorten(cut) ?? cut, adjusted: true, reason: "future" };
  }
  const short = shorten(p);
  if (short) return { period: short, adjusted: true, reason: "too_long" };
  return { period: p, adjusted: false, reason: null };
}

/** Обрезка до 366 дней или null, если длина в норме. */
function shorten(p: Period): Period | null {
  if (daysBetween(p.fromYmd, p.toYmd) + 1 <= MAX_DAYS) return null;
  return makePeriod(p.kind, mskMidnight(addDays(p.toYmd, -(MAX_DAYS - 1))), p.to);
}

function dm(ymd: string, withYear: boolean): string {
  const s = `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
  return withYear ? `${s}.${ymd.slice(0, 4)}` : s;
}

/**
 * Те же дни прошлого месяца: [1-е прошлого; тот же день и час прошлого
 * месяца). Если в прошлом месяце такого дня нет (31 марта → февраль), конец —
 * конец прошлого месяца.
 */
function sameDaysPrevMonth(p: Period): Period {
  const y = Number(p.fromYmd.slice(0, 4));
  const m = Number(p.fromYmd.slice(5, 7));
  const prev = monthStart(y, m, -1);
  const toYmd = ymdOf(p.to);
  const intoDay = p.to.getTime() - mskMidnight(toYmd).getTime();
  let to: Date;
  if (toYmd.slice(0, 7) !== p.fromYmd.slice(0, 7)) {
    // Конец ровно на полуночи 1-го числа следующего месяца — весь месяц.
    to = mskMidnight(p.fromYmd);
  } else {
    const day = Number(toYmd.slice(8, 10));
    to =
      day > daysInMonth(prev.y, prev.m)
        ? mskMidnight(p.fromYmd)
        : new Date(mskMidnight(ymdFrom(prev.y, prev.m, day)).getTime() + intoDay);
  }
  return makePeriod("range", mskMidnight(prev.ymd), to);
}

/**
 * С чем сравниваем (ТЗ 4.6, уточнение 12): окно той же длины прямо перед
 * текущим. Сдвигаем обе границы на число календарных дней периода — для
 * законченных периодов (вчера, прошлая неделя, свой период) это ровно
 * соседнее окно, а для идущих до now — то же время суток N дней назад:
 * «сегодня до 14:32» сравнивается со «вчера до 14:32», а не с хвостом
 * вчерашнего вечера.
 *
 * Исключения: «эта неделя» — те же дни прошлой недели (пн–ср с пн–ср, а не
 * с пт–вс); «этот месяц» — те же дни прошлого месяца. Именованный месяц —
 * весь предыдущий календарный, но если он ещё идёт (октябрь в октябре), то
 * как «этот месяц»: иначе половина октября сравнивалась бы с целым сентябрём.
 *
 * kind результата — "range" (для целого прошлого месяца — "month"): это
 * окно для второй цифры, а не «вчера» или «эта неделя».
 */
export function comparisonPeriod(p: Period): { period: Period; label: string } {
  const shifted = (n: number) => makePeriod("range", shiftDays(p.from, -n), shiftDays(p.to, -n));
  switch (p.kind) {
    case "today":
      return { period: shifted(1), label: "вчера" };
    case "yesterday":
      return { period: shifted(1), label: "днём раньше" };
    // Сдвиг ровно на 7 и 30, а не на число дней периода: «7 дней» ровно в
    // полночь короче на сутки (сегодняшний день ещё пуст), а «эта неделя» в
    // среду — три дня, но сравнивать её надо с пн–ср, а не с пт–вс.
    case "7d":
    case "last_week":
    case "this_week":
      return { period: shifted(7), label: "неделей раньше" };
    case "30d":
      return { period: shifted(30), label: "за предыдущие 30 дней" };
    case "this_month":
      return { period: sameDaysPrevMonth(p), label: "месяцем раньше" };
    case "month": {
      const y = Number(p.fromYmd.slice(0, 4));
      const m = Number(p.fromYmd.slice(5, 7));
      const whole = p.to.getTime() === mskMidnight(monthStart(y, m, 1).ymd).getTime();
      if (!whole) return { period: sameDaysPrevMonth(p), label: "месяцем раньше" };
      const prev = makePeriod("month", mskMidnight(monthStart(y, m, -1).ymd), p.from);
      return { period: prev, label: "месяцем раньше" };
    }
    case "range": {
      const prev = shifted(daysBetween(p.fromYmd, p.toYmd) + 1);
      const withYear = prev.fromYmd.slice(0, 4) !== prev.toYmd.slice(0, 4);
      const label =
        prev.fromYmd === prev.toYmd
          ? `за ${dm(prev.fromYmd, false)}`
          : `за ${dm(prev.fromYmd, withYear)}–${dm(prev.toYmd, withYear)}`;
      return { period: prev, label };
    }
  }
}

// ---------------------------------------------------------------------------
// Дата забега

export type RunDateRef = { kind: "date"; ymd: string } | { kind: "nearest" } | { kind: "previous" };

/** Одиночная числовая дата; все вхождения — первое реальное (не «10.30»). */
const DATE_NUM_G = new RegExp(`${DN_L}${DN}${DN_R}`, "gu");
/** «3 октября», «3 октября 2026». */
const DATE_WORD_G = new RegExp(`${B}(\\d{1,2}) ${MONTH_ANY}(?: (\\d{4}))?${E}`, "gu");

const WEEKDAY_FORMS: Array<[string, number]> = [
  ["понедельник\\p{L}*|пн", 1],
  ["вторник\\p{L}*|вт", 2],
  ["сред(?:а|у|ы|е|ой|ам)|ср", 3],
  ["четверг\\p{L}*|чт", 4],
  ["пятниц\\p{L}*|пт", 5],
  ["суббот\\p{L}*|сб", 6],
  ["воскресен\\p{L}*|вс", 7],
];
const WEEKDAY_RE = new RegExp(
  `${B}(?:(прошл\\p{L}*|предыдущ\\p{L}*|последн\\p{L}*) )?(${WEEKDAY_FORMS.map(([f]) => f).join("|")})${E}`,
  "u",
);
const WEEKDAY_EXACT = WEEKDAY_FORMS.map(([f, n]) => [new RegExp(`^(?:${f})$`, "u"), n] as const);

/**
 * «Ближайший»/«прошлый» — про забег, только если дальше не единица времени:
 * «прошлая неделя» и «последние 7 дней» — это период, «в прошлом году» —
 * тоже не забег.
 */
const NOT_RUN_UNIT = "(?! (?:недел|месяц|год|дн|день|сутк|раз|\\d))";
const TODAY_RE = new RegExp(`${B}(?:сегодня|сегодняшн\\p{L}*)${E}`, "u");
const TOMORROW_RE = new RegExp(`${B}(?:завтра|завтрашн\\p{L}*)${E}`, "u");
const AFTER_TOMORROW_RE = new RegExp(`${B}послезавтра${E}`, "u");
const NEAREST_RE = new RegExp(`${B}(?:ближайш|следующ)\\p{L}*${E}${NOT_RUN_UNIT}`, "u");
const PREVIOUS_RE = new RegExp(`${B}(?:прошл|последн|предыдущ)\\p{L}*${E}${NOT_RUN_UNIT}`, "u");

/**
 * Год для даты без года: ближайший к сегодня из прошлого, этого и
 * следующего (забеги спрашивают и до, и после): «03.10» в конце сентября —
 * этот год, «20.12» в январе — прошлый, «05.01» в декабре — следующий.
 * Дальше полугода — не угадываем (так бывает только с 29.02).
 */
function closestYear(dmv: DayMonth, today: string): string | null {
  if (dmv.y !== undefined) return validYmd(dmv.y, dmv);
  const y = Number(today.slice(0, 4));
  let best: string | null = null;
  let bestDist = Infinity;
  for (const cand of [y - 1, y, y + 1]) {
    const ymd = validYmd(cand, dmv);
    if (!ymd) continue;
    const dist = Math.abs(daysBetween(today, ymd));
    if (dist < bestDist) {
      best = ymd;
      bestDist = dist;
    }
  }
  return bestDist <= 184 ? best : null;
}

/**
 * Дата забега из фразы («сколько записалось на 03.10», «лужники суббота»).
 * Конкретное раньше общего: дата → день недели → сегодня/завтра →
 * ближайший/прошлый. Диапазон дат — это период, а не забег: иначе «оплаты с
 * 01.10 по 07.10» увели бы вопрос в раздел забегов (найденная дата забега —
 * ключ раздела, ТЗ 4.3).
 *
 * «Вчера» здесь нет: в ТЗ это период, и вопрос «регистрации вчера» не про
 * забег. Прошедший забег спрашивают датой или «прошлый».
 */
export function parseRunDate(text: string, now: Date): RunDateRef | null {
  const n = normalizeText(text);
  const today = ymdOf(now);
  if (parseRange(n, today) !== undefined) return null;

  for (const m of n.matchAll(DATE_NUM_G)) {
    const ymd = closestYear({ d: Number(m[1]), m: Number(m[2]), y: fullYear(m[3]) }, today);
    if (ymd) return { kind: "date", ymd };
  }
  for (const m of n.matchAll(DATE_WORD_G)) {
    const y = m[3] ? Number(m[3]) : undefined;
    const ymd = closestYear({ d: Number(m[1]), m: monthOfWord(m[2]), y }, today);
    if (ymd) return { kind: "date", ymd };
  }

  const wd = WEEKDAY_RE.exec(n);
  if (wd) {
    const target = WEEKDAY_EXACT.find(([r]) => r.test(wd[2]))![1];
    const cur = mskWeekday(today);
    // Без уточнения — ближайший такой день, включая сегодня: «в субботу» в
    // субботу — это сегодняшний забег. С «прошлую» — последний прошедший.
    const delta = wd[1] ? -(((cur - target + 6) % 7) + 1) : (target - cur + 7) % 7;
    return { kind: "date", ymd: addDays(today, delta) };
  }

  if (TODAY_RE.test(n)) return { kind: "date", ymd: today };
  // «завтрашн», а не «завтр…»: иначе «завтрак» стал бы датой.
  if (TOMORROW_RE.test(n)) return { kind: "date", ymd: addDays(today, 1) };
  if (AFTER_TOMORROW_RE.test(n)) return { kind: "date", ymd: addDays(today, 2) };
  if (NEAREST_RE.test(n)) return { kind: "nearest" };
  if (PREVIOUS_RE.test(n)) return { kind: "previous" };
  return null;
}
