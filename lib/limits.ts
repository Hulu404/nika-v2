import type { SupabaseClient } from "@supabase/supabase-js";
import type { Message } from "@/types/app";
import type { Database } from "@/types/database";
import { FORCE_PRO_FOR_ALL } from "@/lib/subscription";
import {
  calculateQuotaUnits,
  planConfig,
  type PlanTier,
  type TierConfig,
} from "@/lib/plans/limits-config";
import { estimateTokens } from "@/lib/tokens";

type Client = SupabaseClient<Database>;

interface TodayUsage {
  /** Единицы квоты, списанные сегодня (по всем диалогам). */
  units: number;
  /** Диалоги, в которых есть хотя бы одна сегодняшняя реплика пользователя. */
  activeDialogIds: string[];
}

/**
 * Использование за «сегодня». Берём диалоги, обновлённые с начала дня, но
 * единицы считаем ПОФРАЗОВО — только по репликам пользователя с сегодняшним
 * timestamp. Это исключает старый баг, когда продолжение вчерашнего диалога
 * перебивало updated_at на сегодня и его старые реплики падали в дневной счёт.
 *
 * Единицы легаси-реплик (без inputTokens) оцениваем эвристикой по длине.
 */
export async function getTodayUsage(
  supabase: Client,
  userId: string,
  config: TierConfig,
): Promise<TodayUsage> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startIso = startOfDay.toISOString();

  const { data } = await supabase
    .from("conversations")
    .select("id, messages")
    .eq("user_id", userId)
    .gte("updated_at", startIso);

  let units = 0;
  const activeDialogIds: string[] = [];
  for (const c of data ?? []) {
    let hasTodayUserMsg = false;
    for (const m of c.messages as Message[]) {
      if (m.role !== "user") continue;
      if (!m.timestamp || m.timestamp < startIso) continue;
      units += calculateQuotaUnits(m.inputTokens ?? estimateTokens(m.content), config);
      hasTodayUserMsg = true;
    }
    if (hasTodayUserMsg) activeDialogIds.push(c.id);
  }
  return { units, activeDialogIds };
}

export type LimitReason = "messages" | "dialogs";

export interface LimitBlock {
  reason: LimitReason;
  limit: number;
}

/**
 * Проверяет суточные лимиты перед ответом в чате. newUnits — сколько единиц
 * спишет текущая реплика (ceil(inputTokens / unit_tokens)). Возвращает описание
 * блокировки или null. FORCE_PRO_FOR_ALL — глобальный обход лимитов.
 *
 * Квота единиц: блокируем, если текущая реплика ВЫВЕЛА БЫ за суточную квоту
 * (used + newUnits > daily_units). Для тарифов с hard_block=false (premium) не
 * блокируем — логируем warning (мягкий fair-use лимит).
 *
 * Лимит диалогов срабатывает только для «нового сегодня» диалога и только на
 * тарифах с hard_block (продолжать начатые сегодня разговоры можно).
 */
export async function checkDailyLimits(
  supabase: Client,
  userId: string,
  tier: PlanTier,
  conversationId: string | null | undefined,
  newUnits: number,
): Promise<LimitBlock | null> {
  if (FORCE_PRO_FOR_ALL) return null;

  const config = planConfig(tier);
  const usage = await getTodayUsage(supabase, userId, config);

  if (usage.units + newUnits > config.daily_units) {
    if (config.hard_block) {
      return { reason: "messages", limit: config.daily_units };
    }
    // Мягкий лимит (premium): не блокируем, но фиксируем превышение — чтобы
    // заметить fair-use-аномалии и сверить с юнит-экономикой.
    console.warn(
      `[limits] soft daily quota exceeded: user=${userId} tier=${tier} ` +
        `used=${usage.units} +${newUnits} > ${config.daily_units}`,
    );
  }

  if (config.daily_dialogs > 0 && config.hard_block) {
    const isNewDialogToday =
      !conversationId || !usage.activeDialogIds.includes(conversationId);
    if (isNewDialogToday && usage.activeDialogIds.length >= config.daily_dialogs) {
      return { reason: "dialogs", limit: config.daily_dialogs };
    }
  }

  return null;
}
