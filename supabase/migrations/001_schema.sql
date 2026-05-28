-- 001_schema.sql
-- Схема БД НИКА: enum-типы и таблицы public-схемы.
-- Соответствует types/database.ts и types/app.ts.

-- ── Enum-типы ────────────────────────────────────────────────────────────────
create type runner_level         as enum ('beginner', 'irregular', 'returning');
create type runner_goal          as enum ('habit', 'not_quit', 'race', 'anxiety');
create type runner_fear          as enum ('shame', 'tired', 'slow', 'doubt', 'injury');
create type scenario_type        as enum ('morning', 'after_run', 'after_skip', 'pre_race', 'after_failure');
create type subscription_plan    as enum ('free', 'monthly', 'yearly');
create type subscription_status  as enum ('active', 'pending', 'canceled', 'expired');

-- ── public.users ─────────────────────────────────────────────────────────────
-- Строка заводится триггером при регистрации в auth.users (см. 003_triggers.sql).
create table public.users (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  telegram_id  text,
  display_name text,
  is_pro       boolean     not null default false,
  created_at   timestamptz not null default now()
);

-- ── public.profiles ──────────────────────────────────────────────────────────
create table public.profiles (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users (id) on delete cascade,
  level            runner_level,
  goal             runner_goal,
  fears            runner_fear[] default '{}',
  reminder_enabled boolean     not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id)
);

-- ── public.conversations ─────────────────────────────────────────────────────
create table public.conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  scenario   scenario_type not null,
  messages   jsonb       not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── public.subscriptions ─────────────────────────────────────────────────────
create table public.subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users (id) on delete cascade,
  plan               subscription_plan   not null default 'free',
  status             subscription_status not null default 'active',
  yukassa_payment_id text,
  current_period_end timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
