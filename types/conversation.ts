import type { MessageRole, ScenarioType } from "./app";

/** Сценарий диалога. Единый источник истины — ScenarioType в app.ts. */
export type Scenario = ScenarioType;

/** Роль автора реплики. */
export type Role = MessageRole;

/** Кликабельный чип-действие под сообщением НИКИ (навигация / подтверждение). */
export interface ChatAction {
  href: string;
  label: string;
}

/**
 * Сообщение в состоянии UI: с локальным id (для React-ключей) и временем
 * создания. Для хранения и передачи в API используется Message из app.ts.
 */
export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
  action?: ChatAction;
}
