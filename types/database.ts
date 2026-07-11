import type {
  ArchetypeId,
  CyclePref,
  Gender,
  Message,
  Milestone,
  MoodKey,
  NotifPermission,
  QuizAnswer,
  RobokassaPaymentStatus,
  RobokassaPlan,
  RunIntensity,
  RunnerFear,
  RunnerGoal,
  RunnerLevel,
  ScenarioType,
  SprintStatus,
  SubscriptionPlan,
  SubscriptionStatus,
  WeeklyFocus,
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
          cycle: CyclePref | null;
          proactive: boolean | null;
          notif_permission: NotifPermission | null;
          rhythm_consent_at: string | null;
          rhythm_consent_version: string | null;
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
          cycle?: CyclePref | null;
          proactive?: boolean | null;
          notif_permission?: NotifPermission | null;
          rhythm_consent_at?: string | null;
          rhythm_consent_version?: string | null;
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
          cycle?: CyclePref | null;
          proactive?: boolean | null;
          notif_permission?: NotifPermission | null;
          rhythm_consent_at?: string | null;
          rhythm_consent_version?: string | null;
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
      daily_state: {
        Row: {
          id: string;
          user_id: string;
          date: string;
          moods: MoodKey[];
          ran: boolean | null;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          date: string;
          moods?: MoodKey[];
          ran?: boolean | null;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          date?: string;
          moods?: MoodKey[];
          ran?: boolean | null;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      period_marks: {
        Row: {
          id: string;
          user_id: string;
          date: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          date: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          date?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      saved_tips: {
        Row: {
          user_id: string;
          tip_id: number;
          created_at: string;
        };
        Insert: {
          user_id: string;
          tip_id: number;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          tip_id?: number;
          created_at?: string;
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
      robokassa_payments: {
        Row: {
          inv_id: number;
          user_id: string;
          plan: RobokassaPlan;
          amount: number;
          status: RobokassaPaymentStatus;
          created_at: string;
          paid_at: string | null;
          billing_period: string;
        };
        Insert: {
          inv_id?: number;
          user_id: string;
          plan: RobokassaPlan;
          amount: number;
          status?: RobokassaPaymentStatus;
          created_at?: string;
          paid_at?: string | null;
          billing_period?: string;
        };
        Update: {
          inv_id?: number;
          user_id?: string;
          plan?: RobokassaPlan;
          amount?: number;
          status?: RobokassaPaymentStatus;
          created_at?: string;
          paid_at?: string | null;
          billing_period?: string;
        };
        Relationships: [];
      };
      rate_limits: {
        Row: {
          key: string;
          window_start: string;
          count: number;
        };
        Insert: {
          key: string;
          window_start?: string;
          count?: number;
        };
        Update: {
          key?: string;
          window_start?: string;
          count?: number;
        };
        Relationships: [];
      };
      sprints: {
        Row: {
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
        };
        Insert: {
          id?: string;
          user_id: string;
          archetype_id: ArchetypeId;
          goal_text: string;
          milestones_enabled?: boolean;
          milestones?: Milestone[];
          weekly_focus?: WeeklyFocus[];
          quiz_answers?: QuizAnswer[];
          closing_reflection?: string | null;
          start_date?: string;
          status?: SprintStatus;
          closed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          archetype_id?: ArchetypeId;
          goal_text?: string;
          milestones_enabled?: boolean;
          milestones?: Milestone[];
          weekly_focus?: WeeklyFocus[];
          quiz_answers?: QuizAnswer[];
          closing_reflection?: string | null;
          start_date?: string;
          status?: SprintStatus;
          closed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      check_rate_limit: {
        Args: {
          p_key: string;
          p_limit: number;
          p_window_seconds: number;
        };
        Returns: boolean;
      };
    };
    Enums: {
      runner_level: RunnerLevel;
      runner_goal: RunnerGoal;
      runner_fear: RunnerFear;
      run_intensity: RunIntensity;
      gender: Gender;
      scenario_type: ScenarioType;
      subscription_plan: SubscriptionPlan;
      subscription_status: SubscriptionStatus;
      archetype_id: ArchetypeId;
      sprint_status: SprintStatus;
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
export type DailyStateRow = Tables["daily_state"]["Row"];
export type PeriodMarkRow = Tables["period_marks"]["Row"];
export type Subscription = Tables["subscriptions"]["Row"];
export type SprintRow = Tables["sprints"]["Row"];
export type RobokassaPayment = Tables["robokassa_payments"]["Row"];

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
