import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClubSession } from "./sessions";

/**
 * Места на занятии клуба. Место занимает только ОПЛАЧЕННАЯ заявка: pending
 * коврик не держит, иначе десяток брошенных форм закрыл бы продажу.
 *
 * Общий для API-роута (edge, свой клиент) и бота (tgAdmin), поэтому клиент
 * передаётся снаружи.
 */
export async function countPaidSeats(
  db: SupabaseClient,
  session: Pick<ClubSession, "club" | "date" | "time">,
): Promise<number> {
  const { count, error } = await db
    .from("club_signups")
    .select("id", { count: "exact", head: true })
    .eq("club", session.club)
    .eq("event_date", session.date)
    .eq("event_time", session.time)
    .eq("payment_status", "paid");
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
