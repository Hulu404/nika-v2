/**
 * Временный флаг: все пользователи считаются Pro (бессрочно), лимиты и
 * тарифные ограничения отключены.
 *
 * Чтобы вернуть платную модель — поставь false. Тогда статус Pro снова
 * берётся из users.is_pro, а дневной лимит сообщений включается обратно.
 */
export const FORCE_PRO_FOR_ALL = true;

/** Итоговый Pro-статус: временный флаг имеет приоритет над значением из БД. */
export function resolveIsPro(dbIsPro: boolean | null | undefined): boolean {
  return FORCE_PRO_FOR_ALL || Boolean(dbIsPro);
}
