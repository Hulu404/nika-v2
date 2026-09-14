import { tgAdmin } from "../telegram/supabase";
import { localParts, DEFAULT_TZ } from "../telegram/schedule";
import type { RunKey, TeamRun } from "./runs";

/**
 * История забегов и темп набора.
 *
 * Отвечает на вопрос, ради которого команда и открывает бота за несколько дней
 * до старта: «десять человек — это мало или нормально?». Сам по себе он не
 * отвечается: десять за пять дней до старта и десять за день до старта — это
 * разные новости.
 *
 * Поэтому сравниваем не с итогом прошлого забега, а с той же точкой отсчёта:
 * сколько было у прошлого забега за те же пять дней до ЕГО старта. Сравнение
 * с финальной цифрой («сейчас 10, в прошлый раз 37») выглядит убедительно и
 * при этом почти всегда врёт — половина заявок приходит в последние два дня.
 *
 * Считается всё на уже прочитанных строках, чистыми функциями: разбор по
 * датам — ровно то место, где ошибка не видна глазом, а решение по ней
 * принимают («набираем плохо, надо дожимать»).
 */

/** Строка заявки в объёме, нужном для истории: кто именно — не важно. */
export interface ArchiveRow {
  spot: string;
  run_date: string;
  created_at: string;
  confirmed_at: string | null;
  reminder_sent_at: string | null;
}

export interface RunAggregate extends RunKey {
  total: number;
  confirmed: number;
  reminded: number;
  /** ISO первой и последней заявки — видно, за сколько дней набрался забег. */
  firstSignupAt: string | null;
  lastSignupAt: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Полночь дня забега по Москве, в миллисекундах. Точка отсчёта всех сравнений. */
export function startOfRun(date: string): number {
  return Date.parse(`${date}T00:00:00+03:00`);
}

/**
 * За сколько дней до старта мы сейчас — по календарю, как это скажет человек.
 * В пятницу про воскресный забег говорят «через два дня», а не «через один и
 * три четверти», поэтому считаем разницу МОСКОВСКИХ дат, а не часов.
 * Отрицательное — забег уже прошёл, 0 — сегодня.
 */
export function daysUntilStart(date: string, now: Date = new Date()): number {
  const today = localParts(DEFAULT_TZ, now).ymd;
  return Math.round((startOfRun(date) - startOfRun(today)) / DAY_MS);
}

/** Сколько миллисекунд прошло с московской полуночи. */
function msSinceMskMidnight(now: Date): number {
  return now.getTime() - startOfRun(localParts(DEFAULT_TZ, now).ymd);
}

/**
 * Момент, на который смотрим забег: «за N дней до его старта, в то же время
 * суток, что сейчас».
 *
 * Оба слагаемых важны, и оба — из-за перекосов, которые не видно глазом:
 *
 *   • дни, а не «столько же миллисекунд до старта» — иначе подпись («за 6
 *     дней») расходилась бы с тем, что посчитано (5 дней 8 часов), и цифру
 *     нельзя было бы перепроверить руками;
 *   • время суток, а не полночь — иначе текущий забег считался бы «по сейчас»
 *     (с куском сегодняшнего дня), а прошлые по полуночи, и сравнение молча
 *     льстило бы сегодняшнему набору на полдня заявок.
 *
 * Проверка сходимости: для самого этого забега формула даёт ровно `now`.
 */
export function leadCutoff(date: string, daysBefore: number, now: Date = new Date()): number {
  return startOfRun(date) - daysBefore * DAY_MS + msSinceMskMidnight(now);
}

/** Сколько заявок на забег было подано до указанного момента. */
export function signupsBefore(
  rows: readonly ArchiveRow[],
  run: RunKey,
  cutoff: number,
): number {
  return rows.filter(
    (r) => r.spot === run.spot && r.run_date === run.date && Date.parse(r.created_at) <= cutoff,
  ).length;
}

/** Свод по каждому забегу, от свежих к старым. */
export function aggregateRuns(rows: readonly ArchiveRow[]): RunAggregate[] {
  const byRun = new Map<string, RunAggregate>();

  for (const r of rows) {
    const id = `${r.spot}/${r.run_date}`;
    const agg =
      byRun.get(id) ??
      {
        spot: r.spot,
        date: r.run_date,
        total: 0,
        confirmed: 0,
        reminded: 0,
        firstSignupAt: null,
        lastSignupAt: null,
      };

    agg.total++;
    if (r.confirmed_at) agg.confirmed++;
    if (r.reminder_sent_at) agg.reminded++;
    if (!agg.firstSignupAt || r.created_at < agg.firstSignupAt) agg.firstSignupAt = r.created_at;
    if (!agg.lastSignupAt || r.created_at > agg.lastSignupAt) agg.lastSignupAt = r.created_at;

    byRun.set(id, agg);
  }

  return [...byRun.values()].sort(
    (a, b) => b.date.localeCompare(a.date) || a.spot.localeCompare(b.spot),
  );
}

export interface DynamicsPoint {
  date: string;
  /** Сколько было у того забега на ту же точку отсчёта. */
  atSameLead: number;
  /** Сколько стало в итоге. */
  final: number;
  /**
   * Шла ли к тому моменту запись вообще (была ли хоть одна заявка позже начала
   * набора). Ноль у ещё не открытого забега — это не «набирали плохо», это
   * «не набирали»; такие точки в сравнение не годятся.
   */
  opened: boolean;
}

export interface Dynamics {
  /** За сколько дней до старта смотрим. */
  daysBefore: number;
  /** Сколько сейчас у этого забега. */
  now: number;
  /** Предыдущие забеги того же спота, от свежего к старому. */
  previous: DynamicsPoint[];
  /**
   * Медиана «на ту же точку» по тем предыдущим, где запись к этому моменту уже
   * шла. Null, если сравнивать не с чем.
   */
  typical: number | null;
  /**
   * Сколько забегов реально попало в ориентир. Один — это ещё не «обычно», и
   * говорить так бот не должен: слово «обычно» поверх единственного числа
   * придаёт ему вес, которого у него нет.
   */
  comparable: number;
}

/**
 * Динамика набора будущего забега: сколько сейчас и сколько было у прошлых
 * забегов ЭТОГО ЖЕ спота на ту же точку отсчёта.
 *
 * Спот в сравнении обязателен. Лужники и Усачёва набираются по-разному, и
 * усреднённый «прошлый раз» по обоим спотам — это цифра, которой не было
 * никогда.
 *
 * null — забег уже прошёл (тогда динамика не нужна, есть итог) или сравнивать
 * не с чем.
 */
export function dynamicsFor(
  run: TeamRun,
  rows: readonly ArchiveRow[],
  now: Date = new Date(),
  limit = 3,
): Dynamics | null {
  const daysBefore = daysUntilStart(run.date, now);
  // Старт уже позади: сравнивать темп набора незачем — есть итог.
  if (daysBefore < 0) return null;

  const previous: DynamicsPoint[] = aggregateRuns(rows)
    .filter((a) => a.spot === run.spot && a.date < run.date)
    .slice(0, limit)
    .map((a) => {
      const cutoff = leadCutoff(a.date, daysBefore, now);
      return {
        date: a.date,
        atSameLead: signupsBefore(rows, a, cutoff),
        final: a.total,
        // Запись шла, если первая заявка на тот забег была не позже отсечки.
        opened: !!a.firstSignupAt && Date.parse(a.firstSignupAt) <= cutoff,
      };
    });

  if (previous.length === 0) return null;

  // Ориентир строим ТОЛЬКО по забегам, которые к этому моменту уже набирались.
  // Иначе выходит так: приглашения по понедельникам появились недавно, у
  // прошлых забегов за неделю до старта заявок не было вовсе, и бот бодро
  // сообщает «на девять больше обычного» — сравнив набор с периодом, когда
  // набора не было. Цифра верная, вывод из неё ложный.
  const comparable = previous.filter((p) => p.opened).map((p) => p.atSameLead);

  return {
    daysBefore,
    now: signupsBefore(rows, run, leadCutoff(run.date, daysBefore, now)),
    previous,
    typical: median(comparable),
    comparable: comparable.length,
  };
}

/** Медиана, а не среднее: один аномальный забег не должен сдвигать ориентир. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Все заявки за всю историю — страницами.
 *
 * Постранично не из осторожности: Supabase молча отдаёт максимум тысячу строк
 * за запрос, и на этом история однажды перестала бы включать старые забеги —
 * не с ошибкой, а просто тихо. Строк тут сотни, растут десятками в неделю,
 * так что один-два запроса на вызов.
 */
const PAGE = 1000;

export async function fetchArchive(): Promise<ArchiveRow[]> {
  const out: ArchiveRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await tgAdmin()
      .from("coffee_run_signups")
      .select("spot, run_date, created_at, confirmed_at, reminder_sent_at")
      .order("run_date", { ascending: false })
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`не смогла прочитать историю: ${error.message}`);
    const page = (data ?? []) as ArchiveRow[];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/** Ключи всех забегов, о которых знает база. */
export function runKeysFrom(rows: readonly ArchiveRow[]): RunKey[] {
  return aggregateRuns(rows).map((a) => ({ spot: a.spot, date: a.date }));
}
