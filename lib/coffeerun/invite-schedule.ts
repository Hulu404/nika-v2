import { upcomingRuns, type CoffeeRun } from "./run";

/**
 * Когда зовём на новые забеги.
 *
 * Раз в неделю, в понедельник утром: неделя начинается — человек как раз
 * планирует выходные, и приглашение попадает в момент, когда его есть куда
 * положить. Чаще звать нечем (забег один в неделю на спот), реже — поздно.
 *
 * Вся логика «когда» — чистые функции от УЖЕ посчитанных московских дня недели
 * и часа, по образцу runsDueForReminder: так расписание проверяется тестами без
 * подмены системного времени.
 */

/** Понедельник. JS getDay / localParts().weekday: Вс=0…Сб=6. */
export const INVITE_WEEKDAY = 1;

/**
 * Час по МСК, с которого уходит приглашение. 10:00 — то же окно, что у
 * напоминаний: не будим утром и не пишем в ночь.
 */
export const INVITE_HOUR_MSK = 10;

/**
 * Ближайший будущий забег каждого спота. Именно он «только что открылся»:
 * если на споте запланированы два забега вперёд, звать разом на оба значит
 * размазать внимание — про второй позовём в следующий понедельник.
 *
 * Массив забегов хронологический по контракту run.ts, поэтому первое вхождение
 * спота и есть его ближайший забег.
 */
export function nextRunPerSpot(runs: readonly CoffeeRun[]): CoffeeRun[] {
  const seen = new Set<string>();
  const out: CoffeeRun[] = [];

  for (const run of runs) {
    if (seen.has(run.spot)) continue;
    seen.add(run.spot);
    out.push(run);
  }

  return out;
}

/**
 * Забеги, на которые пора звать. Пустой массив — не понедельник, слишком рано
 * или звать не на что.
 *
 * `hour >= INVITE_HOUR_MSK`, а не «==»: если тикер проспал свой час (деплой,
 * перезапуск), приглашение уйдёт следующим проходом, а не пропадёт до
 * следующей недели. Повтора это не создаёт — дедуп держит таблица
 * coffee_run_invites, а не расписание.
 */
export function runsDueForInvite(
  weekday: number,
  hour: number,
  now: Date = new Date(),
): CoffeeRun[] {
  if (weekday !== INVITE_WEEKDAY) return [];
  if (hour < INVITE_HOUR_MSK) return [];
  return nextRunPerSpot(upcomingRuns(now));
}
