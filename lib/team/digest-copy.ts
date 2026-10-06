import { REMINDER_HOUR_MSK, dayBefore, type CoffeeRun } from "../coffeerun/run";
import { formatPace } from "../coffeerun/pace";
import { dayHeader, escapeHtmlTeam, scheduleLine } from "./copy";
import { coffeeRunStart, coffeeRunTitle, type TeamEvent } from "./events";
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

export type DigestItem =
  | { kind: "event"; event: TeamEvent }
  | { kind: "run"; run: CoffeeRun; stats: RunStats };

const startOf = (it: DigestItem) => (it.kind === "event" ? it.event.starts_at : coffeeRunStart(it.run));

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
    if (it.kind === "event") {
      lines.push(scheduleLine({ source: "event", startsAt: it.event.starts_at, event: it.event }));
      continue;
    }
    const { run, stats } = it;
    lines.push(scheduleLine({ source: "coffeerun", startsAt: coffeeRunStart(run), run }));
    lines.push(`  ждём ${stats.confirmed} из ${stats.total}: ${paceSummary(stats)}`);
    if (stats.unconfirmed > 0) lines.push(`  ⚠️ не подтвердились ${stats.unconfirmed}: до них не дошли ни напоминание, ни адрес`);
    if (reminderWindowPassed(run.date, now) && stats.confirmed > 0 && stats.reminded === 0) {
      alarms.push(
        `🚨 ${escapeHtmlTeam(coffeeRunTitle(run))}: вчера окно рассылки напоминаний прошло, а не ушло ни одного ` +
          `(подтвердили ${stats.confirmed}). Рассылка живёт в процессе сайта, смотри логи приложения.`,
      );
    }
  }
  if (alarms.length) lines.push("", ...alarms);
  lines.push("", "Расписание: /schedule · ивенты: /events");
  return lines.join("\n");
}
