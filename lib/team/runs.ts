import { COFFEE_RUNS, spotName, type CoffeeRun } from "../coffeerun/run";
import { DEFAULT_TZ } from "../telegram/schedule";

/**
 * Что для командного бота считается «забегом».
 *
 * Для бота участников забег существует, только пока он в COFFEE_RUNS — то есть
 * пока не состоялся: запись оттуда убирают в тот же день, иначе новые заявки
 * уезжали бы в прошлое (см. комментарий в lib/coffeerun/run.ts).
 *
 * Команде нужно ровно обратное. Главный вопрос вечера пятницы — «в Лужниках
 * десять человек, это мало или нормально?», и ответ на него лежит в
 * прошедших забегах, которых в расписании уже нет. Поэтому здесь забег — это
 * пара (спот, дата), откуда бы она ни пришла: из расписания или из заявок в
 * базе.
 *
 * Запланированный забег знает про себя больше (время сбора, адрес, карта) —
 * это поле `scheduled`. У прошедшего его нет, и сводка про него говорит только
 * то, что знает: сколько людей и что с рассылками.
 */

/** Минимальный ключ забега — им же выбираются строки заявок. */
export interface RunKey {
  spot: string;
  date: string;
}

export interface TeamRun extends RunKey {
  /** «Surf Coffee® Лужники, 20 сентября» — как забег зовут во всех сводках. */
  label: string;
  /** Запись из расписания, если забег ещё предстоит; иначе null. */
  scheduled: CoffeeRun | null;
  /** Старт уже был (день забега считается будущим целиком, как в run.ts). */
  past: boolean;
}

/** «13 сентября» из YYYY-MM-DD. Для забегов, которых в расписании уже нет. */
export function runDateLabel(ymd: string): string {
  const ms = Date.parse(`${ymd}T12:00:00+03:00`);
  if (Number.isNaN(ms)) return ymd;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: DEFAULT_TZ,
    day: "numeric",
    month: "long",
  }).format(new Date(ms));
}

/** Прошёл ли забег. Как в run.ts: свой день забег остаётся будущим целиком. */
export function isPast(date: string, now: Date = new Date()): boolean {
  return Date.parse(`${date}T23:59:59+03:00`) < now.getTime();
}

/** Пара (спот, дата) → забег в терминах команды. */
export function teamRun(key: RunKey, now: Date = new Date()): TeamRun {
  const scheduled = COFFEE_RUNS.find((r) => r.spot === key.spot && r.date === key.date) ?? null;
  return {
    spot: key.spot,
    date: key.date,
    label: `${scheduled?.spotName ?? spotName(key.spot)}, ${scheduled?.dateLabel ?? runDateLabel(key.date)}`,
    scheduled,
    past: isPast(key.date, now),
  };
}

/**
 * Все забеги, о которых команда может спросить: то, что есть в базе, плюс то,
 * что стоит в расписании.
 *
 * Объединение, а не просто база: забег, который открыли час назад и на который
 * ещё никто не записался, в заявках не существует — а спросить про него
 * захотят первым делом, именно потому что там ноль.
 *
 * Порядок — от свежих к старым: чаще всего нужен ближайший, а не забег
 * позапрошлого месяца.
 */
export function mergeRuns(fromDb: readonly RunKey[], now: Date = new Date()): TeamRun[] {
  const seen = new Set<string>();
  const keys: RunKey[] = [];
  for (const k of [...fromDb, ...COFFEE_RUNS.map((r) => ({ spot: r.spot, date: r.date }))]) {
    const id = `${k.spot}/${k.date}`;
    if (seen.has(id)) continue;
    seen.add(id);
    keys.push({ spot: k.spot, date: k.date });
  }
  return keys
    .map((k) => teamRun(k, now))
    .sort((a, b) => b.date.localeCompare(a.date) || a.spot.localeCompare(b.spot));
}

/**
 * Аргумент команды → забег. Понимает всё, чем забег называют вслух: слаг
 * («luzhniki»), дату («2026-09-20», «20.09»), кусок названия спота («лужн») и
 * их сочетание («лужники 13.09»).
 *
 * Спот без даты — ближайший забег этого спота: «/who лужники» в пятницу должно
 * показать ближайшие Лужники, а не прошлогодние.
 *
 * null — не нашли. Подставлять похожее нельзя: ответ на вопрос про другой
 * забег выглядит как правда и читается как правда.
 */
export function pickRun(arg: string, runs: readonly TeamRun[]): TeamRun | null {
  const raw = arg.trim().toLowerCase();
  if (!raw) return null;

  const date = parseDateToken(raw, runs);
  const spot = parseSpotToken(raw, runs);

  if (date && spot) return runs.find((r) => r.date === date && r.spot === spot) ?? null;
  if (date) {
    // Дата без спота: в один день могут стоять забеги на разных спотах —
    // берём первый по алфавиту слага, но только если он один.
    const sameDay = runs.filter((r) => r.date === date);
    return sameDay.length === 1 ? sameDay[0] : (sameDay[0] ?? null);
  }
  if (spot) {
    const ofSpot = runs.filter((r) => r.spot === spot);
    // runs отсортированы от свежих к старым, поэтому ближайший будущий — это
    // последний непрошедший в списке.
    return ofSpot.filter((r) => !r.past).at(-1) ?? ofSpot[0] ?? null;
  }
  return null;
}

/** Дата из аргумента: ISO, «20.09» или «20.09.2026». null — даты в строке нет. */
function parseDateToken(raw: string, runs: readonly TeamRun[]): string | null {
  const iso = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];

  const dotted = raw.match(/(?:^|\s)(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?(?:\s|$)/);
  if (!dotted) return null;
  const [, d, m, y] = dotted;
  const suffix = `-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  if (y) return `${y}${suffix}`;
  // Без года — ищем среди известных забегов. Их немного, и среди них такая
  // дата почти всегда одна; если нет — берём самую свежую.
  return runs.find((r) => r.date.endsWith(suffix))?.date ?? null;
}

/** Спот из аргумента: слаг или кусок имени. От трёх букв — см. parseRunArg. */
function parseSpotToken(raw: string, runs: readonly TeamRun[]): string | null {
  const spots = [...new Set(runs.map((r) => r.spot))];
  const exact = spots.find((s) => raw.includes(s));
  if (exact) return exact;

  const words = raw.split(/[\s,]+/).filter((w) => w.length >= 3 && !/\d/.test(w));
  for (const w of words) {
    const hit = runs.find(
      (r) => r.label.toLowerCase().includes(w) || r.spot.includes(w),
    );
    if (hit) return hit.spot;
  }
  return null;
}

/**
 * Забег по умолчанию — когда команда набрала команду без аргумента.
 * Ближайший будущий; если будущих нет, последний прошедший: показать вчерашние
 * цифры полезнее, чем ответить «не поняла».
 */
export function defaultRun(runs: readonly TeamRun[]): TeamRun | null {
  const upcoming = runs.filter((r) => !r.past);
  return upcoming.at(-1) ?? runs[0] ?? null;
}
