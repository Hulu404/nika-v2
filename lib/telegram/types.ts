/** Пять сценариев разговора с НИКОЙ. */
export type Scenario =
  | "morning"
  | "after_run"
  | "after_skip"
  | "pre_race"
  | "after_failure";

/** Одна реплика в истории диалога. */
export interface Message {
  role: "user" | "assistant";
  content: string;
}

/**
 * Данные сессии одного чата.
 * ВАЖНО: для webhook хранятся не в памяти, а в БД (таблица tg_sessions через
 * StorageAdapter, см. lib/telegram/storage.ts) — каждый апдейт приходит в новый
 * инстанс роута, поэтому in-memory состояние не годится.
 */
export interface SessionData {
  /** Текущий активный сценарий. null — пользователь в главном меню. */
  scenario: Scenario | null;
  /**
   * История сообщений текущего диалога.
   * Первое сообщение всегда от assistant (открывашка НИКИ) —
   * при отправке в Anthropic оно обрезается, т.к. API ждёт user-first.
   */
  messages: Message[];
}
