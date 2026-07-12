import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { FORCE_PRO_FOR_ALL } from "@/lib/subscription";

type Client = SupabaseClient<Database>;

/** Дневные лимиты по тарифу: сколько диалогов и сообщений в день. */
export interface PlanLimits {
  dialogs: number;
  messages: number;
}

export const PLAN_LIMITS: { free: PlanLimits; pro: PlanLimits } = {
  free: { dialogs: 3, messages: 10 },
  pro: { dialogs: 6, messages: 20 },
};

export function planLimits(isPro: boolean): PlanLimits {
  return isPro ? PLAN_LIMITS.pro : PLAN_LIMITS.free;
}

interface TodayUsage {
  /** Сообщений с role="user", отправленных сегодня (по всем диалогам). */
  messages: number;
  /** Диалоги, в которых сегодня уже есть хотя бы одна реплика пользователя. */
  activeDialogIds: string[];
}

/**
 * Использование за «сегодня»: считаем по диалогам, обновлённым с начала дня.
 * Пустой диалог (без реплик пользователя) в счёт диалогов НЕ идёт — открытие
 * «Нового разговора» без единого сообщения не съедает дневной лимит.
 */
export async function getTodayUsage(supabase: Client, userId: string): Promise<TodayUsage> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from("conversations")
    .select("id, messages")
    .eq("user_id", userId)
    .gte("updated_at", startOfDay.toISOString());

  let messages = 0;
  const activeDialogIds: string[] = [];
  for (const c of data ?? []) {
    const userMsgs = c.messages.filter((m) => m.role === "user").length;
    messages += userMsgs;
    if (userMsgs > 0) activeDialogIds.push(c.id);
  }
  return { messages, activeDialogIds };
}

export type LimitReason = "messages" | "dialogs";

export interface LimitBlock {
  reason: LimitReason;
  limit: number;
}

/**
 * Проверяет дневные лимиты перед ответом в чате. Возвращает описание блокировки
 * или null, если можно продолжать. FORCE_PRO_FOR_ALL — глобальный обход лимитов.
 *
 * Лимит диалогов срабатывает только для «нового сегодня» диалога: продолжать уже
 * начатые сегодня разговоры можно (до лимита сообщений).
 */
export async function checkDailyLimits(
  supabase: Client,
  userId: string,
  isPro: boolean,
  conversationId: string | null | undefined,
): Promise<LimitBlock | null> {
  if (FORCE_PRO_FOR_ALL) return null;

  const limits = planLimits(isPro);
  const usage = await getTodayUsage(supabase, userId);

  if (usage.messages >= limits.messages) {
    return { reason: "messages", limit: limits.messages };
  }

  const isNewDialogToday = !conversationId || !usage.activeDialogIds.includes(conversationId);
  if (isNewDialogToday && usage.activeDialogIds.length >= limits.dialogs) {
    return { reason: "dialogs", limit: limits.dialogs };
  }

  return null;
}
