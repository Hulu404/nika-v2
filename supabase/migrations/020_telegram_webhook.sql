-- 020_telegram_webhook.sql
-- Служебные таблицы под webhook-бота: идемпотентность апдейтов и хранилище
-- grammY-сессий (замена in-memory сессии). Обе пишутся только сервисной ролью
-- (webhook ходит service-role ключом), пользователю доступа не нужно.
-- Идемпотентна: create table/index if not exists, drop policy if exists.

-- ── processed_updates: дедуп апдейтов Telegram по update_id ───────────────────
create table if not exists public.processed_updates (
  update_id bigint primary key,
  seen_at   timestamptz not null default now()
);

alter table public.processed_updates enable row level security;

drop policy if exists "Service role manages processed_updates" on public.processed_updates;
create policy "Service role manages processed_updates" on public.processed_updates
  for all to service_role using (true) with check (true);

-- ── tg_sessions: хранилище grammY-сессий (ключ = id чата) ─────────────────────
create table if not exists public.tg_sessions (
  key        text primary key,
  value      jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.tg_sessions enable row level security;

drop policy if exists "Service role manages tg_sessions" on public.tg_sessions;
create policy "Service role manages tg_sessions" on public.tg_sessions
  for all to service_role using (true) with check (true);
