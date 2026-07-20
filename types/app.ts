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

/**
 * Тариф оплаты Robokassa (заказ). monthly — месяц, halfyear — полгода,
 * pro — подписка PRO со стартовой ценой первой недели 1 ₽.
 */
export type RobokassaPlan = "monthly" | "halfyear" | "pro";

/** Статус платежа Robokassa. */
export type RobokassaPaymentStatus = "pending" | "paid" | "failed";

/**
 * Категория личного совета (/tips). Один общий словарь для фронта и бэка.
 * 'mindset' — «Настрой» (мотивация/голова), дефолт для эмоциональных советов.
 */
export type TipCategory =
  | "before"
  | "technique"
  | "breathing"
  | "gear"
  | "recovery"
  | "mindset";

/**
 * Личный совет — единый тип для фронта и бэка. Зеркалит строку personal_tips
 * (без user_id/source/deleted_at — это не нужно клиенту ленты), createdAt в camelCase.
 */
export interface PersonalTip {
  id: string;
  category: TipCategory;
  title: string;
  body: string;
  createdAt: string;
}

/** Роль автора реплики. */
export type MessageRole = "user" | "assistant";

/** Сообщение диалога — для хранения (jsonb) и передачи в API. */
export interface Message {
  role: MessageRole;
  content: string;
  timestamp: string;
  /**
   * Входные токены реплики пользователя (по данным Anthropic countTokens).
   * Нужен для дневного лимита в «единицах»: одна реплика списывает
   * ceil(inputTokens / 250) единиц. Проставляется только для role="user";
   * у ассистента и у старых записей отсутствует (тогда оцениваем по длине).
   */
  inputTokens?: number;
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

/**
 * Тема персонального совета спринта. Правила выбирают тему по сигналам
 * (бег/чат/цель/состояние), LLM формулирует текст. Данные цикла в тему/текст
 * не попадают — фаза учитывается только как внутренний тон при генерации.
 */
export type SprintTipTheme =
  | "return_after_break" // недавние пропуски — мягкий план возврата
  | "emotional" // частая эмоция из чата (устал/страшно/не хочу)
  | "recovery" // много тяжёлых — сбавить, восстановиться
  | "consistency" // на этой неделе ещё не выходил(а)
  | "pace_reading" // цель про темп
  | "distance_plan" // цель про дистанцию/забег
  | "milestone_focus" // ориентиры отстают от темпа спринта
  | "keep_going"; // общий якорь к цели/фокусу

/** Один сгенерированный совет спринта (строка таблицы sprint_advice.tips). */
export interface SprintTip {
  theme: SprintTipTheme;
  text: string;
}
