/**
 * Маршруты навигации в одном месте.
 * Прим.: /home и /chat в приложении не существуют — Главная это /today
 * (см. app/page.tsx: редирект на /today или /day1), а чат динамический
 * /chat/[scenario]. Меняется здесь, а не по компонентам.
 */
export const HOME_HREF = "/today";
export const CHAT_HREF = "/chat/morning";
export const MEDITATIONS_HREF = "/meditations";
export const JOURNAL_HREF = "/journal";
export const RHYTHM_HREF = "/rhythm";
export const TIPS_HREF = "/tips";
export const PROFILE_HREF = "/profile";
