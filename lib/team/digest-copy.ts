import { runWhenWhere, dayBefore, REMINDER_HOUR_MSK } from "../coffeerun/run";
import { formatPace } from "../coffeerun/pace";
import type { TeamRun } from "./runs";
import type { RunStats } from "./stats";
import type { DigestKind } from "./digest-schedule";

/**
 * Тексты сводок, которые бот присылает сам.
 *
 * Отдельно от copy.ts не ради порядка в папке: у этих сообщений другая задача.
 * Всё в copy.ts — ответ на вопрос, который человек задал; здесь — сообщение,
 * которое человек не просил. Такое имеет право прийти, только если сразу
 * отвечает «что случилось» и «надо ли что-то делать», причём в первых двух
 * строках: остальное дочитают, если понадобится.
 */

/** Прошло ли окно рассылки напоминаний по этому забегу (накануне, 10:00 МСК). */
function reminderWindowPassed(runDate: string, now: Date): boolean {
  const hh = String(REMINDER_HOUR_MSK).padStart(2, "0");
  return Date.parse(`${dayBefore(runDate)}T${hh}:00:00+03:00`) <= now.getTime();
}

/** Разбивка по группам темпа — то, ради чего пейсер и открывает сводку. */
function paceBlock(stats: RunStats): string[] {
  const filled = stats.byPace.filter((b) => b.count > 0);
  if (filled.length === 0) return ["  темп никто не выбрал — разведём на месте"];
  return filled.map((b) =>
    b.pace
      ? `  ${formatPace(b.pace)} — ${b.count}`
      : `  без темпа — ${b.count} (разведём на месте)`,
  );
}

/** Хвост про тех, до кого бот не дотянется. Пусто, если таких нет. */
function unconfirmedNote(stats: RunStats): string[] {
  if (stats.unconfirmed === 0) return [];
  return [
    "",
    `⚠️ ${stats.unconfirmed} чел. оставили заявку, но не подтвердились в боте: ` +
      "они не получили ни напоминания, ни адреса. Если придут — их не ждут. " +
      "Список с контактами — /contacts.",
  ];
}

/**
 * Утро дня забега. Главное здесь — группы темпа: это единственная цифра,
 * которую на старте нельзя посмотреть в телефоне за полминуты.
 */
export function morningDigestText(run: TeamRun, stats: RunStats): string {
  const when = run.scheduled ? runWhenWhere(run.scheduled) : run.label;
  return [
    `Сегодня забег: ${run.label}`,
    when,
    "",
    `Придут (подтвердили в боте): ${stats.confirmed} из ${stats.total} заявок`,
    "",
    "По группам темпа:",
    ...paceBlock(stats),
    ...unconfirmedNote(stats),
    "",
    "Поимённо — /who, контакты — /contacts.",
  ].join("\n");
}

/**
 * Накануне, после окна рассылки. Вопрос ровно один: напоминания ушли или нет.
 * Поэтому ответ стоит второй строкой, а не в конце сводки.
 */
export function eveDigestText(run: TeamRun, stats: RunStats, now: Date = new Date()): string {
  const head = [`Завтра забег: ${run.label}`];
  if (run.scheduled) head.push(runWhenWhere(run.scheduled));

  // Штатная рассылка попадает сюда всегда после окна, но эту же функцию
  // показывает предпросмотр /digest — в том числе за неделю до старта. Без
  // проверки окна он кричал бы «НАПОМИНАНИЯ НЕ УШЛИ» о рассылке, которой ещё
  // и не должно было быть.
  if (!reminderWindowPassed(run.date, now)) {
    return [
      ...head,
      "",
      `Напоминания ещё не уходили — окно откроется накануне, ${dayBefore(run.date)}, ` +
        `после ${REMINDER_HOUR_MSK}:00 МСК.`,
      `Подтвердили участие: ${stats.confirmed} из ${stats.total} заявок.`,
      ...unconfirmedNote(stats),
    ].join("\n");
  }

  // Авария: окно прошло, получатели есть, а не ушло ничего. Это единственный
  // случай, ради которого сводку стоит прислать даже ночью.
  if (stats.confirmed > 0 && stats.reminded === 0) {
    return [
      ...head,
      "",
      "⚠️ НАПОМИНАНИЯ НЕ УШЛИ.",
      `Окно открылось в ${REMINDER_HOUR_MSK}:00 МСК, подтвердивших ${stats.confirmed}, ` +
        "отправлено 0.",
      // Куда смотреть, названо прямо: рассылка живёт не в отдельном сервисе, а
      // в процессе приложения, и «упало» здесь значит «посмотри логи сайта».
      "Рассылка идёт из того же процесса, что и сайт (instrumentation.ts) — " +
        "смотри логи приложения.",
      "",
      `Заявок всего: ${stats.total}.`,
    ].join("\n");
  }

  const lines = [
    ...head,
    "",
    `Напоминания ушли: ${stats.reminded} из ${stats.confirmed} подтвердивших.`,
  ];

  if (stats.waiting > 0) {
    lines.push(
      `Ещё в очереди: ${stats.waiting} — уйдут ближайшими проходами, рассылка идёт порциями.`,
    );
  }

  lines.push(
    "",
    `Заявок всего: ${stats.total}` + (stats.last24h ? ` (+${stats.last24h} за сутки)` : ""),
  );
  lines.push(...unconfirmedNote(stats));
  lines.push("", "Подробности — /run, кому именно ушло — /notif.");
  return lines.join("\n");
}

export function digestText(
  kind: DigestKind,
  run: TeamRun,
  stats: RunStats,
  now: Date = new Date(),
): string {
  return kind === "morning" ? morningDigestText(run, stats) : eveDigestText(run, stats, now);
}
