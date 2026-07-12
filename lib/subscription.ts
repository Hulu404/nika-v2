import type { PlanTier } from "@/lib/plans/limits-config";

/**
 * Платная модель включена: статус Pro берётся из users.is_pro, дневной лимит
 * сообщений и тарифные гейты действуют. Все пользователи — free, кроме тех, у
 * кого в БД выставлен is_pro=true (комп-аккаунты).
 *
 * Чтобы снова сделать всех Pro (бессрочно, без лимитов) — поставь true.
 */
export const FORCE_PRO_FOR_ALL = false;

/** Итоговый Pro-статус: временный флаг имеет приоритет над значением из БД. */
export function resolveIsPro(dbIsPro: boolean | null | undefined): boolean {
  return FORCE_PRO_FOR_ALL || Boolean(dbIsPro);
}

/**
 * Уровень тарифа пользователя для лимитов (free/pro/premium). Сейчас источник —
 * булев users.is_pro, поэтому реально возвращаем free/pro; premium заложен в
 * конфиг и проверки, но станет достижимым, когда появится его источник.
 *
 * TODO(premium): когда премиум начнёт продаваться (колонка уровня на users или
 * запись в subscriptions), возвращать "premium" для таких пользователей.
 */
export function resolveTier(dbIsPro: boolean | null | undefined): PlanTier {
  if (FORCE_PRO_FOR_ALL) return "pro";
  return dbIsPro ? "pro" : "free";
}
