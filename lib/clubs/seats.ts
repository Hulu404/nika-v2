import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClubSession } from "./sessions";

/**
 * Места на занятии клуба. Место занимает только ОПЛАЧЕННАЯ заявка: pending
 * коврик не держит, иначе десяток брошенных форм закрыл бы продажу. Оплата с
 * counts_seat = false (тест, гость команды) место тоже не занимает.
 *
 * Общий для API-роута (edge, свой клиент) и бота (tgAdmin), поэтому клиент
 * передаётся снаружи.
 */
export async function countPaidSeats(
  db: SupabaseClient,
  session: Pick<ClubSession, "club" | "date" | "time">,
): Promise<number> {
  const paidQuery = () =>
    db
      .from("club_signups")
      .select("id", { count: "exact", head: true })
      .eq("club", session.club)
      .eq("event_date", session.date)
      .eq("event_time", session.time)
      .eq("payment_status", "paid");
  // counts_seat = false — оплата, которая не занимает коврик (тест, гость команды).
  let { count, error } = await paidQuery().eq("counts_seat", true);
  // Миграция 067 могла ещё не доехать до базы: считаем все оплаченные, а не
  // закрываем продажу из-за отсутствующей колонки.
  if (error && /counts_seat/.test(error.message)) {
    console.error("[club] нет counts_seat, примени 067_club_signups_counts_seat.sql:", error.message);
    ({ count, error } = await paidQuery());
  }
  // Не смогли посчитать — не продаём вслепую сверх зала: считаем, что мест нет.
  if (error) {
    console.error("[club] countPaidSeats:", error.message);
    return Number.POSITIVE_INFINITY;
  }
  return count ?? 0;
}

export function isSoldOut(paid: number, session: Pick<ClubSession, "capacity">): boolean {
  return paid >= session.capacity;
}

/**
 * С какого остатка показываем число на странице. Пока мест больше, там только
 * «ограничено»: полупустой зал в начале продаж не продаёт.
 */
export const SHOW_SEATS_LEFT_AT = 5;

/** Остаток для страницы: число, когда мест мало (но они есть), иначе null. */
export function seatsLeftToShow(paid: number, session: Pick<ClubSession, "capacity">): number | null {
  const left = session.capacity - paid;
  return left > 0 && left <= SHOW_SEATS_LEFT_AT ? left : null;
}
