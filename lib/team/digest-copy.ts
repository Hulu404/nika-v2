import { REMINDER_HOUR_MSK, dayBefore } from "../coffeerun/run";
import { formatPace } from "../coffeerun/pace";
import { escapeHtmlTeam, eventWhen } from "./copy";
import type { TeamEvent } from "./events";
import type { RunStats } from "./stats";

/**
 * Кофе-ран в утренней сводке фаундерам. Сама сводка — «Мой день»
 * (lib/team/my-day.ts): события и задачи каждого человека.
 *
 * Для кофе-рана две строки: сколько ждём и по каким группам темпа (это нужно
 * пейсерам, пока они ещё дома) и сколько не подтвердились. Отдельная строка-
 * тревога — если накануне окно рассылки напоминаний участникам прошло, а не
 * ушло ничего.
 */

/** Событие дня; у кофе-рана недели — заявки по (спот, дата). */
export type DigestItem = { kind: "event"; event: TeamEvent; stats?: RunStats; runDate?: string };

const startOf = (it: DigestItem) => it.event.starts_at;

/** Прошло ли окно рассылки напоминаний по этому забегу (накануне, 10:00 МСК). */
export function reminderWindowPassed(runDate: string, now: Date): boolean {
  const hh = String(REMINDER_HOUR_MSK).padStart(2, "0");
  return Date.parse(`${dayBefore(runDate)}T${hh}:00:00+03:00`) <= now.getTime();
}

function paceSummary(stats: RunStats): string {
  const filled = stats.byPace.filter((b) => b.count > 0);
  if (!filled.length) return "темп никто не выбрал";
  return filled.map((b) => `${b.pace ? formatPace(b.pace) : "без темпа"} — ${b.count}`).join(", ");
}

/**
 * Блоки фаундерам про кофе-ран дня в «Моём дне»: сколько ждём и по каким
 * группам темпа, сколько не подтвердились, тревога, если накануне не ушло ни
 * одного напоминания. Пусто — кофе-рана сегодня нет.
 */
export function founderCoffeeLines(items: readonly DigestItem[], now: Date): string[] {
  const lines: string[] = [];
  const alarms: string[] = [];
  for (const it of [...items].sort((a, b) => Date.parse(startOf(a)) - Date.parse(startOf(b)))) {
    const { stats, runDate } = it;
    if (!stats || !runDate) continue;
    lines.push(`🏃 ${escapeHtmlTeam(it.event.title)}, ${eventWhen(it.event.starts_at).split(", ")[1]}: ждём ${stats.confirmed} из ${stats.total} — ${paceSummary(stats)}`);
    if (stats.unconfirmed > 0) lines.push(`⚠️ не подтвердились ${stats.unconfirmed}: до них не дошли ни напоминание, ни адрес`);
    if (reminderWindowPassed(runDate, now) && stats.confirmed > 0 && stats.reminded === 0) {
      alarms.push(
        `🚨 ${escapeHtmlTeam(it.event.title)}: вчера окно рассылки напоминаний прошло, а не ушло ни одного ` +
          `(подтвердили ${stats.confirmed}). Рассылка живёт в процессе сайта, смотри логи приложения.`,
      );
    }
  }
  return [...lines, ...alarms];
}
