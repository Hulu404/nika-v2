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

/**
 * Канонический ключ чипа состояния в разделе «Мой ритм» (бриф §5, 12 чипов).
 * Это ключи, не UI-лейблы. Порядок и русские лейблы — MOOD_KEYS в lib/rhythm.ts
 * и MOOD_LABELS в lib/rhythm-copy.ts. Мультивыбор, тумблер по тапу — не шкала.
 */
export type MoodKey =
  | "energetic" // Энергична
  | "calm" // Спокойно
  | "tired" // Устала
  | "irritable" // Раздражена
  | "sad" // Грустно
  | "anxious" // Тревожно
  | "happy" // Счастлива
  | "bloating" // Вздутие
  | "pain" // Боль
  | "insomnia" // Бессонница
  | "cravings" // Тяга к сладкому
  | "tenderness"; // Нежность

/** План подписки. */
export type SubscriptionPlan = "free" | "monthly" | "yearly";

/** Статус подписки. */
export type SubscriptionStatus = "active" | "pending" | "canceled" | "expired";

/** Тариф оплаты Robokassa (заказ). monthly — месяц, halfyear — полгода. */
export type RobokassaPlan = "monthly" | "halfyear";

/** Статус платежа Robokassa. */
export type RobokassaPaymentStatus = "pending" | "paid" | "failed";

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

// ─────────────────────────────────────── Спринт ──────────────────────────────

/** Архетип бегуна — определяется квизом. Ключи совпадают с Postgres enum. */
export type ArchetypeId = "threshold" | "calm" | "builder" | "goal" | "moment";

/** Ориентир (чекпоинт) внутри спринта. */
export interface Milestone {
  id: string;
  label: string;
  achieved_at: string | null;
}

/** Фокус недели — результат еженедельного чек-ина. */
export interface WeeklyFocus {
  week_number: 1 | 2 | 3;
  focus_text: string;
  set_at: string;
}

/** Ответ на один вопрос квиза. */
export interface QuizAnswer {
  question_index: 0 | 1 | 2 | 3;
  archetype_vote: ArchetypeId;
}

/** Статус спринта — намеренно без 'failed'. */
export type SprintStatus = "active" | "closed";

/** Полная запись спринта (зеркалит строку таблицы sprints). */
export interface Sprint {
  id: string;
  user_id: string;
  archetype_id: ArchetypeId;
  goal_text: string;
  milestones_enabled: boolean;
  milestones: Milestone[];
  weekly_focus: WeeklyFocus[];
  quiz_answers: QuizAnswer[];
  closing_reflection: string | null;
  start_date: string;
  status: SprintStatus;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}
