/**
 * Расписание и пороги сводки фаундерам и соцсетей — в одном месте.
 * Время — московское.
 */

/** Слоты сводки фаундерам: окно каждой — от прошлого слота до этого. */
export const FOUNDER_DIGEST_SLOTS = [
  { key: "10:00", hour: 10, minute: 0 },
  { key: "22:30", hour: 22, minute: 30 },
] as const;

/** «Давно не было»: последний визит старше стольких суток или его нет. */
export const AWAY_DAYS = 3;

/** Длинные списки в сводке режем до стольких строк с «и ещё N». */
export const DIGEST_LIST_LIMIT = 10;

/** Ежедневный снимок Telegram-канала и вопрос про Instagram. */
export const SOCIAL_DAILY_HOUR = 21;

/** Защита от опечатки: разница с прошлым снимком больше этой доли — переспросить. */
export const FOLLOWERS_JUMP = 0.2;

/** Сколько ждём число Instagram следующим сообщением после вопроса в 21:00. */
export const IG_ASK_FORM_TTL_MS = 12 * 3_600_000;

/** Настройка: кто вносит Instagram. */
export const INSTAGRAM_OWNER_SETTING = "instagram_owner_chat_id";
