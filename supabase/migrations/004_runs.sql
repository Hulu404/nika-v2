-- 004_runs.sql
-- Журнал пробежек: ручной ввод тренировок пользователем.

create type run_intensity as enum ('easy', 'medium', 'hard');

create table public.runs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  date         date not null,
  distance_km  numeric(5,2) not null,
  duration_min integer not null,
  intensity    run_intensity not null default 'easy',
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Журнал тянет пробежки юзера, отсортированные по дате.
create index runs_user_date_idx on public.runs (user_id, date desc);

-- ── RLS: каждый видит и меняет только свои пробежки ──────────────────────────
alter table public.runs enable row level security;

create policy "Users can read own runs" on public.runs
  for select using (auth.uid() = user_id);

create policy "Users can insert own runs" on public.runs
  for insert with check (auth.uid() = user_id);

create policy "Users can update own runs" on public.runs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can delete own runs" on public.runs
  for delete using (auth.uid() = user_id);

-- Автообновление updated_at (функция из 003_triggers.sql).
create trigger set_updated_at_runs
  before update on public.runs
  for each row execute function public.set_updated_at();
