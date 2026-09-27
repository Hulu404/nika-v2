import type { DynamicsPoint } from "../team/history";
import { countWord, formatInt, pluralForm, WORDS, type WordForms } from "./format";

/**
 * Прогноз итогового числа заявок (ТЗ 4.4, «Прогноз итога»). Чистая функция без
 * базы и без часов: на вход — сколько дней до старта, сколько заявок сейчас и
 * прошлые забеги того же спота из `dynamicsFor`.
 *
 * Явку здесь не прогнозируем и не упоминаем вовсе: сколько людей дошло, база
 * не знает, а прогноз по неизвестной величине — выдумка с цифрой.
 */

/** Больше трёх прошлых забегов не берём: давние забеги набирались по другим правилам. */
export const FORECAST_MAX_RUNS = 3;

/**
 * Порог «данных достаточно» — и для прошлых забегов (atSameLead), и для
 * текущего. При 1–2 заявках коэффициент скачет от случайности: одна лишняя
 * заявка меняет k вдвое.
 */
export const FORECAST_MIN_SIGNUPS = 3;

export type Forecast =
  | { kind: "range"; low: number; point: number; high: number; basedOn: number }
  | { kind: "single"; ratio: number }
  | { kind: "none"; reason: "past" | "start_today" | "no_comparable" | "too_few" };

export function forecast(input: {
  daysBefore: number | null;
  current: number;
  previous: readonly DynamicsPoint[];
}): Forecast {
  const { daysBefore, current, previous } = input;
  // Отрицательное число считаем тем же «прошёл»: у прошедшего есть итог, прогноз не нужен.
  if (daysBefore === null || daysBefore < 0) return { kind: "none", reason: "past" };
  // В день старта заявки докидывают у самой точки; «прогноз» на пару часов — шум.
  if (daysBefore === 0) return { kind: "none", reason: "start_today" };

  // previous уже от свежего к старому. Фильтруем ДО среза: тимлид передаёт весь
  // список (dynamicsFor с большим limit), иначе неоткрытые забеги вытеснили бы
  // сравнимые. Неоткрытый забег (запись ещё не шла) даёт k = итог / 0 — не
  // «набрали вдесятеро», а «не набирали»; при atSameLead < 3 k — случайность.
  const comparable = previous
    .filter((p) => p.opened && p.atSameLead >= FORECAST_MIN_SIGNUPS)
    .slice(0, FORECAST_MAX_RUNS);

  if (comparable.length === 0) return { kind: "none", reason: "no_comparable" };
  // Один забег — это наблюдение, а не закономерность: показываем его как факт,
  // без диапазона. Поэтому и current < 3 здесь не мешает — прогноза всё равно нет.
  if (comparable.length === 1) {
    const [p] = comparable;
    return { kind: "single", ratio: p.final / p.atSameLead };
  }
  if (current < FORECAST_MIN_SIGNUPS) return { kind: "none", reason: "too_few" };

  const ks = comparable.map((p) => p.final / p.atSameLead).sort((a, b) => a - b);
  return {
    kind: "range",
    low: Math.round(current * ks[0]),
    point: Math.round(current * medianK(ks)),
    high: Math.round(current * ks[ks.length - 1]),
    basedOn: comparable.length,
  };
}

/**
 * Медиана отсортированных k. Своя, а не `median` из history: та округляет до
 * целого (она для числа заявок), а k = 1,3 после округления стал бы единицей.
 */
function medianK(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** «по двум», «по трём» — basedOn бывает только 2 или 3 (FORECAST_MAX_RUNS). */
const BY_RUNS: Record<number, string> = { 2: "двум", 3: "трём" };

const TIMES: WordForms = ["раз", "раза", "раз"];

/**
 * «1,6 раза», «2 раза», «5 раз», «2,5 раза». Один знак после запятой, лишний
 * ноль убираем. У дробных всегда «раза» (родительный ед.: «в полтора раза»),
 * у целых — по обычному правилу числа: 2–4 «раза», 5–20 «раз», 21 «раз», 22 «раза».
 */
function formatTimes(ratio: number): string {
  const tenths = Math.round(ratio * 10);
  if (tenths % 10 === 0) {
    const whole = tenths / 10;
    return `${formatInt(whole)} ${pluralForm(whole, TIMES)}`;
  }
  return `${formatInt(Math.floor(tenths / 10))},${tenths % 10} раза`;
}

/**
 * Строка прогноза для карточки забега. null — строки нет вовсе (забег прошёл:
 * там итог и строка про явку, прогноз был бы лишним).
 * where — «в Лужниках», «на Усачёва»: при сравнении подписываем, с чем
 * сравниваем (4.10), и подпись эта про спот, а не про «все забеги».
 */
export function forecastText(f: Forecast, where: string): string | null {
  switch (f.kind) {
    case "range": {
      const basis = `по ${BY_RUNS[f.basedOn] ?? formatInt(f.basedOn)} прошлым забегам ${where} за столько же дней до старта`;
      // Форма слова — по последнему числу: «21–22 заявки», «30 заявок».
      const value =
        f.low === f.high
          ? countWord(f.high, WORDS.signup)
          : `${formatInt(f.low)}–${countWord(f.high, WORDS.signup)}`;
      return `Прогноз итога: ${value} (${basis})`;
    }
    case "single":
      return `Сравнимый забег только один: ${singleGrowth(f.ratio)}. Прогнозом это не считаю`;
    case "none":
      switch (f.reason) {
        case "past":
          return null;
        case "start_today":
          return "Прогноза нет: старт сегодня";
        case "no_comparable":
          return "Прогноза нет: не с чем сравнить — раньше на этой точке к этому дню запись не шла";
        case "too_few":
          return "Прогноза нет: пока меньше трёх заявок";
      }
  }
}

/**
 * Что стало с тем забегом к старту. Ветка по округлённому k, а не по сырому:
 * иначе 31/30 превратилось бы в «в 1 раз больше» — фраза без смысла.
 * Меньше единицы бывает, когда заявки удаляли; причину не выдумываем — база её не знает.
 */
function singleGrowth(ratio: number): string {
  if (ratio < 1) return "к старту заявок тогда стало меньше, чем было в этот день";
  if (ratio === 1) return "к старту заявок тогда больше не стало";
  if (Math.round(ratio * 10) <= 10) return "к старту заявок тогда почти не прибавилось";
  return `к старту заявок тогда стало в ${formatTimes(ratio)} больше`;
}
