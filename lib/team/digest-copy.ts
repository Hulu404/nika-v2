import { REMINDER_HOUR_MSK, dayBefore } from "../coffeerun/run";
import { formatPace } from "../coffeerun/pace";
import { dayHeader, escapeHtmlTeam, scheduleLine } from "./copy";
import type { TeamEvent } from "./events";
import type { RunStats } from "./stats";

/**
 * Текст сводки дня. Сообщение, которое человек не просил, имеет право прийти,
 * только если сразу отвечает «что сегодня» и «надо ли что-то делать».
 *
 * Для кофе-рана две строки: сколько ждём и по каким группам темпа (это нужно
 * пейсерам, пока они ещё дома) и сколько не подтвердились. Отдельная строка-
 * тревога — если накануне окно рассылки напоминаний участникам прошло, а не
 * ушло ничего: единственная полезная часть прежней вечерней сводки.
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

export function dailyDigestText(ymd: string, items: readonly DigestItem[], now: Date): string {
  const sorted = [...items].sort((a, b) => Date.parse(startOf(a)) - Date.parse(startOf(b)));
  const lines = [`<b>Сегодня, ${dayHeader(ymd)}</b>`, ""];
  const alarms: string[] = [];
  for (const it of sorted) {
    lines.push(scheduleLine({ source: "event", startsAt: it.event.starts_at, event: it.event }));
    const { stats, runDate } = it;
    if (!stats || !runDate) continue;
    lines.push(`  ждём ${stats.confirmed} из ${stats.total}: ${paceSummary(stats)}`);
    if (stats.unconfirmed > 0) lines.push(`  ⚠️ не подтвердились ${stats.unconfirmed}: до них не дошли ни напоминание, ни адрес`);
    if (reminderWindowPassed(runDate, now) && stats.confirmed > 0 && stats.reminded === 0) {
      alarms.push(
        `🚨 ${escapeHtmlTeam(it.event.title)}: вчера окно рассылки напоминаний прошло, а не ушло ни одного ` +
          `(подтвердили ${stats.confirmed}). Рассылка живёт в процессе сайта, смотри логи приложения.`,
      );
    }
  }
  if (alarms.length) lines.push("", ...alarms);
  lines.push("", "Расписание: /schedule · ивенты: /events");
  return lines.join("\n");
}
