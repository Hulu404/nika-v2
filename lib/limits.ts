import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/** Дневной лимит сообщений от пользователя для бесплатного тарифа. */
export const FREE_DAILY_LIMIT = 10;

/**
 * Сколько сообщений с role="user" пользователь отправил «сегодня».
 * Считаем по диалогам, обновлённым с начала текущего дня: для каждого
 * суммируем число реплик пользователя.
 */
export async function getDailyUserMessageCount(
  supabase: Client,
  userId: string,
): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from("conversations")
    .select("messages")
    .eq("user_id", userId)
    .gte("updated_at", startOfDay.toISOString());

  if (!data) return 0;

  return data.reduce(
    (sum, c) => sum + c.messages.filter((m) => m.role === "user").length,
    0,
  );
}

/** true, если бесплатный пользователь исчерпал дневной лимит. Pro — без лимита. */
export async function isLimitReached(
  supabase: Client,
  userId: string,
): Promise<boolean> {
  const { data: user } = await supabase
    .from("users")
    .select("is_pro")
    .eq("id", userId)
    .maybeSingle();

  if (user?.is_pro) return false;

  const count = await getDailyUserMessageCount(supabase, userId);
  return count >= FREE_DAILY_LIMIT;
}
