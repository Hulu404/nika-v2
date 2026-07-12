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
