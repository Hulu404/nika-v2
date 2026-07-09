import type { Profile, User } from "./database";

/** Сценарий общения с НИКОЙ. */
export type ScenarioType =
  | "morning"
  | "after_run"
  | "after_skip"
  | "pre_race"
  | "after_failure"
  | "general";

/** Грамматический род для обращения (из онбординга). */
export type Gender = "male" | "female" | "neutral";

/** Учёт «тяжёлых дней» (онбординг): считать / скажу сама / не считать. */
export type CyclePref = "on" | "self" | "off";

/** Результат системного запроса разрешения на уведомления. */
export type NotifPermission = "granted" | "denied" | "default";

/** Где человек в своём беговом пути. */
export type RunnerLevel = "beginner" | "irregular" | "returning";

/** Зачем человек бегает. */
export type RunnerGoal = "habit" | "not_quit" | "race" | "anxiety";

/** Чего человек боится в беге. */
export type RunnerFear = "shame" | "tired" | "slow" | "doubt" | "injury";

/** Интенсивность пробежки (журнал). */
export type RunIntensity = "easy" | "medium" | "hard";

/** План подписки. */
export type SubscriptionPlan = "free" | "monthly" | "yearly";

/** Статус подписки. */
export type SubscriptionStatus = "active" | "pending" | "canceled" | "expired";

/** Роль автора реплики. */
export type MessageRole = "user" | "assistant";

/** Сообщение диалога — для хранения (jsonb) и передачи в API. */
export interface Message {
  role: MessageRole;
  content: string;
  timestamp: string;
}

/** Пользователь вместе с его беговым профилем. */
export type UserProfile = User & { profile: Profile };
