import type {
  Gender,
  Message,
  RunIntensity,
  RunnerFear,
  RunnerGoal,
  RunnerLevel,
  ScenarioType,
  SubscriptionPlan,
  SubscriptionStatus,
} from "./app";

/** JSON-совместимое значение для jsonb-колонок. */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/**
 * Типы схемы БД Supabase. Соответствуют таблицам public-схемы.
 * Колонки — в snake_case, как в Postgres.
 */
export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string | null;
          telegram_id: string | null;
          display_name: string | null;
          is_pro: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          telegram_id?: string | null;
          display_name?: string | null;
          is_pro?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          telegram_id?: string | null;
          display_name?: string | null;
          is_pro?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          user_id: string;
          level: RunnerLevel | null;
          goal: RunnerGoal | null;
          fears: RunnerFear[];
          reminder_enabled: boolean;
          gender: Gender | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          level?: RunnerLevel | null;
          goal?: RunnerGoal | null;
          fears?: RunnerFear[];
          reminder_enabled?: boolean;
          gender?: Gender | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          level?: RunnerLevel | null;
          goal?: RunnerGoal | null;
          fears?: RunnerFear[];
          reminder_enabled?: boolean;
          gender?: Gender | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          user_id: string;
          scenario: ScenarioType;
          messages: Message[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          scenario: ScenarioType;
          messages?: Message[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          scenario?: ScenarioType;
          messages?: Message[];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      runs: {
        Row: {
          id: string;
          user_id: string;
          date: string;
          distance_km: number;
          duration_min: number;
          intensity: RunIntensity;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          date: string;
          distance_km: number;
          duration_min: number;
          intensity?: RunIntensity;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          date?: string;
          distance_km?: number;
          duration_min?: number;
          intensity?: RunIntensity;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          id: string;
          user_id: string;
          plan: SubscriptionPlan;
          status: SubscriptionStatus;
          yukassa_payment_id: string | null;
          current_period_end: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          plan?: SubscriptionPlan;
          status?: SubscriptionStatus;
          yukassa_payment_id?: string | null;
          current_period_end?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          plan?: SubscriptionPlan;
          status?: SubscriptionStatus;
          yukassa_payment_id?: string | null;
          current_period_end?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: {
      runner_level: RunnerLevel;
      runner_goal: RunnerGoal;
      runner_fear: RunnerFear;
      run_intensity: RunIntensity;
      gender: Gender;
      scenario_type: ScenarioType;
      subscription_plan: SubscriptionPlan;
      subscription_status: SubscriptionStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
}

type Tables = Database["public"]["Tables"];

/** Алиасы строк таблиц. */
export type User = Tables["users"]["Row"];
export type Profile = Tables["profiles"]["Row"];
export type Conversation = Tables["conversations"]["Row"];
export type RunRow = Tables["runs"]["Row"];
export type Subscription = Tables["subscriptions"]["Row"];

/** Типы для вставки. */
export type UserInsert = Tables["users"]["Insert"];
export type ProfileInsert = Tables["profiles"]["Insert"];
export type ConversationInsert = Tables["conversations"]["Insert"];
export type RunInsert = Tables["runs"]["Insert"];
export type SubscriptionInsert = Tables["subscriptions"]["Insert"];

/** Типы для обновления. */
export type UserUpdate = Tables["users"]["Update"];
export type ProfileUpdate = Tables["profiles"]["Update"];
export type ConversationUpdate = Tables["conversations"]["Update"];
export type SubscriptionUpdate = Tables["subscriptions"]["Update"];
