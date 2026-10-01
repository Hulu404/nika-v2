-- 039_app_v2.sql
-- Данные новой версии приложения (бывший прототип /authv1, теперь /start и /).
--
-- 1. profiles: ответы нового онбординга и настройки вида.
--    intent, barrier, baseline, daypart: коды ответов (см. public/app/index.html, онбординг);
--    *_custom: текст варианта «Другое» (до 60 символов);
--    behaviors: набор меток дневника, 3–5 кодов, свои метки с префиксом 'c:';
--    ui_prefs: шрифт, размер, небо, контраст, «меньше движения»;
--    onboarded_at: когда пройден новый онбординг (NULL: ещё не проходил).
-- 2. diary_entries: свободные записи дневника с метками.
-- 3. runs: оценки после пробежки (ratings) и метки.
-- 4. practice_sessions: прослушивания практик (для курса и счётчиков).
--
-- RLS: каждый видит и меняет только свои строки, как у runs (004_runs.sql).
-- Идемпотентна: повторный прогон проходит без ошибок.

-- ── 1. profiles ──────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists intent         text,
  add column if not exists intent_custom  text,
  add column if not exists barrier        text,
  add column if not exists barrier_custom text,
  add column if not exists baseline       text,
  add column if not exists daypart        text,
  add column if not exists behaviors      text[] not null default '{}',
  add column if not exists ui_prefs       jsonb  not null default '{}'::jsonb,
  add column if not exists onboarded_at   timestamptz;

-- ── 2. diary_entries ─────────────────────────────────────────────────────────
create table if not exists public.diary_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  date        date not null,
  text        text not null check (char_length(text) between 1 and 4000),
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists diary_entries_user_created_idx
  on public.diary_entries (user_id, created_at desc);

alter table public.diary_entries enable row level security;

drop policy if exists "Users can read own diary" on public.diary_entries;
create policy "Users can read own diary" on public.diary_entries
  for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own diary" on public.diary_entries;
create policy "Users can insert own diary" on public.diary_entries
  for insert with check (auth.uid() = user_id);
drop policy if exists "Users can delete own diary" on public.diary_entries;
create policy "Users can delete own diary" on public.diary_entries
  for delete using (auth.uid() = user_id);

-- ── 3. runs: оценки и метки ─────────────────────────────────────────────────
-- ratings: {"effort":1-10,"legs":1-10,"breath":1-10,"mood":1-10}, любые поля можно пропустить.
alter table public.runs
  add column if not exists ratings jsonb,
  add column if not exists tags    text[] not null default '{}';

-- ── 4. practice_sessions ─────────────────────────────────────────────────────
create table if not exists public.practice_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users (id) on delete cascade,
  practice_id      text not null,
  started_at       timestamptz not null default now(),
  completed_at     timestamptz,
  listened_seconds integer not null default 0 check (listened_seconds >= 0)
);

create index if not exists practice_sessions_user_idx
  on public.practice_sessions (user_id, started_at desc);

alter table public.practice_sessions enable row level security;

drop policy if exists "Users can read own practice sessions" on public.practice_sessions;
create policy "Users can read own practice sessions" on public.practice_sessions
  for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own practice sessions" on public.practice_sessions;
create policy "Users can insert own practice sessions" on public.practice_sessions
  for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own practice sessions" on public.practice_sessions;
create policy "Users can update own practice sessions" on public.practice_sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
