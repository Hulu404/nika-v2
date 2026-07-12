/**
 * Единый источник правды по лимитам тарифов (ничего не хардкодим в обработчике
 * сообщений — только читаем отсюда).
 *
 * Модель комбинированная:
 *  - Единица квоты = реплика до `unit_tokens` входных токенов. Длиннее —
 *    списывает несколько единиц: ceil(input_tokens / unit_tokens).
 *  - `hard_cap_tokens` — жёсткий потолок на ОДНУ реплику: выше него отправка
 *    блокируется ДО вызова Claude (а не просто списывает больше единиц).
 *  - `hard_block=false` (premium) — мягкий fair-use: превышение суточной квоты
 *    логируем как warning, но пользователя не блокируем.
 *
 * Каденс — СУТОЧНЫЙ (сброс в начале дня). Значения квот взяты из бизнес-конфига;
 * при переносе на месячный каденс меняется только логика периода в lib/limits.ts,
 * а не это место.
 */
export type PlanTier = "free" | "pro" | "premium";

export interface TierConfig {
  /** Размер одной единицы квоты во входных токенах. */
  unit_tokens: number;
  /** Суточная квота в единицах. */
  daily_units: number;
  /** Жёсткий потолок входных токенов на одну реплику. */
  hard_cap_tokens: number;
  /** true — при исчерпании квоты блокируем; false — мягкий лимит (только лог). */
  hard_block: boolean;
  /** Суточный лимит новых диалогов (0 — не ограничивать). */
  daily_dialogs: number;
}

export const PLAN_LIMITS: Record<PlanTier, TierConfig> = {
  free:    { unit_tokens: 250, daily_units: 20,   hard_cap_tokens: 2500, hard_block: true,  daily_dialogs: 3 },
  pro:     { unit_tokens: 250, daily_units: 350,  hard_cap_tokens: 2500, hard_block: true,  daily_dialogs: 6 },
  premium: { unit_tokens: 250, daily_units: 1000, hard_cap_tokens: 4000, hard_block: false, daily_dialogs: 0 },
};

export function planConfig(tier: PlanTier): TierConfig {
  return PLAN_LIMITS[tier];
}

/** Сколько единиц квоты спишет реплика с данным числом входных токенов (>= 1). */
export function calculateQuotaUnits(inputTokens: number, config: TierConfig): number {
  return Math.max(1, Math.ceil(inputTokens / config.unit_tokens));
}
