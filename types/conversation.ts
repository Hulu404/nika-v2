/** Пять сценариев общения с НИКОЙ. */
export type Scenario =
  | "morning"
  | "after_run"
  | "after_skip"
  | "pre_race"
  | "after_failure";

export type Role = "user" | "assistant";

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  userId: string;
  scenario: Scenario;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}
