export type RunnerLevel = "beginner" | "returning" | "regular";

export interface RunnerProfile {
  /** Где человек в своём беговом пути. */
  level?: RunnerLevel;
  /** Зачем он бегает — своими словами. Контекст для НИКИ, не цель-метрика. */
  goal?: string;
  /** Включены ли мягкие напоминания. */
  reminderEnabled?: boolean;
}

export interface User {
  id: string;
  email?: string;
  telegramId?: string;
  displayName?: string;
  profile: RunnerProfile;
  createdAt: string;
}
