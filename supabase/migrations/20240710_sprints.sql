-- ─────────────────────────────────────────────────────────────────────────────
-- Спринт (Про-фича) — таблица + RLS
-- Запустить в Supabase SQL Editor или через Supabase CLI.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enum архетипа (ключи из прототипа)
create type archetype_id as enum (
  'threshold',  -- На пороге
  'calm',       -- Искатель покоя
  'builder',    -- Строитель себя
  'goal',       -- Человек с целью
  'moment'      -- Человек момента
);

-- Enum статуса спринта — намеренно без 'failed'
create type sprint_status as enum ('active', 'closed');

-- ─── Основная таблица ────────────────────────────────────────────────────────
create table sprints (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,

  archetype_id        archetype_id not null,
  goal_text           text not null,

  -- Модуль ориентиров (опциональный, дефолт по архетипу)
  milestones_enabled  boolean not null default false,
  -- [{ id, label, achieved_at }]
  milestones          jsonb not null default '[]'::jsonb,

  -- [{ week_number, focus_text, set_at }] — заполняется на чек-инах (8-й и 15-й день)
  weekly_focus        jsonb not null default '[]'::jsonb,

  -- [{ question_index, archetype_vote }] — 4 ответа квиза
  quiz_answers        jsonb not null default '[]'::jsonb,

  -- Рефлексия при закрытии (свободный ответ на 21-й день)
  closing_reflection  text,

  start_date          date not null default current_date,
  status              sprint_status not null default 'active',
  closed_at           timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Индекс для типичного запроса: активный спринт пользователя
create index sprints_user_status_idx on sprints (user_id, status);

-- ─── Row Level Security ──────────────────────────────────────────────────────
alter table sprints enable row level security;

create policy "Users manage own sprints"
  on sprints for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── Авто-обновление updated_at ─────────────────────────────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger sprints_updated_at
  before update on sprints
  for each row execute function update_updated_at();
