/**
 * Посещения: сколько раз человек был на кофе-ранах и занятиях клубов. Строка
 * «Ты был с нами: …» внизу экрана «🎟 Мои записи».
 *
 * Только чистые функции: строки из базы приходят готовыми
 * (lib/telegram/my-signups.ts), здесь решается, что считать посещением.
 */

/**
 * Дата выкладки записи ответов переклички в базу (миграция
 * 072_coffee_run_attendance.sql, coffee_run_signups.rollcall_answer).
 *
 * Раньше ответы переклички жили только в памяти процесса (poll-store.ts) и в
 * базе их нет. Поэтому забег с run_date раньше этой даты считаем посещённым по
 * подтверждённой заявке (confirmed_at): лучше, чем ничего, а других данных нет.
 * С этой даты посещение — ответ «да» в перекличке. Если переклички на забег не
 * было вовсе, снова считаем по подтверждённой заявке.
 */
export const ATTENDANCE_SINCE = "2026-11-12";

export interface CoffeeRunAttendanceRow {
  spot: string | null;
  run_date: string | null;
  confirmed_at: string | null;
  /** null — колонки ещё нет (миграция 072 не применена) или человек не отвечал. */
  rollcall_answer?: "yes" | "no" | null;
}

export interface ClubAttendanceRow {
  club: string;
  event_date: string;
  event_time: string;
  payment_status: string;
  amount_rub: number;
  confirmed_at: string | null;
  is_gift?: boolean | null;
}

/**
 * Был ли человек на забеге этой заявки.
 *
 * @param today           сегодняшняя дата по МСК: сегодняшний и будущие забеги не в счёт
 * @param rollcallDates   забеги, по которым перекличка была (хоть у кого-то
 *                        есть rollcall_answered_at)
 */
export function coffeeRunAttended(
  row: CoffeeRunAttendanceRow,
  today: string,
  rollcallDates: ReadonlySet<string>,
): boolean {
  if (!row.confirmed_at || !row.run_date || row.run_date >= today) return false;
  if (row.run_date < ATTENDANCE_SINCE) return true;
  if (rollcallDates.has(row.run_date)) return row.rollcall_answer === "yes";
  return true;
}

/**
 * Было ли занятие клуба: оплаченный заказ или бесплатная заявка (amount 0,
 * в базе она сразу 'paid'), которую человек подтвердил в боте. Прошедшая дата.
 * Возвраты, отмены, истёкшие холды и лист ожидания не считаются.
 *
 * Подарок не в счёт покупателю: билеты купили другому человеку.
 */
export function clubSessionAttended(row: ClubAttendanceRow, today: string): boolean {
  if (row.event_date >= today) return false;
  return clubOrderCounts(row);
}

/** Заказ, по которому человек был (или будет) на занятии, без учёта даты. */
export function clubOrderCounts(row: Pick<ClubAttendanceRow, "payment_status" | "amount_rub" | "confirmed_at" | "is_gift">): boolean {
  if (row.payment_status !== "paid") return false;
  if (row.is_gift) return false;
  if (row.amount_rub === 0) return row.confirmed_at !== null;
  return true;
}

/**
 * Был ли человек на забеге — для сообщения «спасибо, что сегодня был(а)».
 * Строже, чем счётчик: только «да» в перекличке. Подтверждённая заявка без
 * переклички не значит, что человек пришёл, а благодарить того, кого не было,
 * нельзя («сомнение = молчание»).
 */
export function coffeeRunAttendedForFollowup(row: Pick<CoffeeRunAttendanceRow, "confirmed_at" | "rollcall_answer">): boolean {
  return row.confirmed_at !== null && row.rollcall_answer === "yes";
}

export interface AttendanceCount {
  coffeeRuns: number;
  clubSessions: number;
}

/**
 * Итог по человеку. Одна встреча считается один раз: повторная форма на тот
 * же забег или докупка билетов на то же занятие — всё ещё одно посещение,
 * сколько бы билетов ни было в заказе.
 */
export function countAttendance(
  coffee: readonly CoffeeRunAttendanceRow[],
  club: readonly ClubAttendanceRow[],
  today: string,
  rollcallDates: ReadonlySet<string>,
): AttendanceCount {
  const runs = new Set(
    coffee.filter((r) => coffeeRunAttended(r, today, rollcallDates)).map((r) => `${r.spot ?? ""}|${r.run_date}`),
  );
  const sessions = new Set(
    club.filter((r) => clubSessionAttended(r, today)).map((r) => `${r.club}|${r.event_date}|${r.event_time}`),
  );
  return { coffeeRuns: runs.size, clubSessions: sessions.size };
}

/**
 * «Ты был с нами: кофе-ранов 5, занятий клуба 2». Нули не показываем; если
 * всё по нулям — строки нет (null).
 */
export function attendanceLine(count: AttendanceCount): string | null {
  const parts: string[] = [];
  if (count.coffeeRuns > 0) parts.push(`кофе-ранов ${count.coffeeRuns}`);
  if (count.clubSessions > 0) parts.push(`занятий клуба ${count.clubSessions}`);
  return parts.length ? `Ты был с нами: ${parts.join(", ")}` : null;
}

/** Даты забегов после ATTENDANCE_SINCE, для которых нужно знать, была ли перекличка. */
export function datesNeedingRollcallCheck(coffee: readonly CoffeeRunAttendanceRow[], today: string): string[] {
  const dates = new Set<string>();
  for (const r of coffee) {
    if (r.confirmed_at && r.run_date && r.run_date >= ATTENDANCE_SINCE && r.run_date < today) dates.add(r.run_date);
  }
  return [...dates].sort();
}
