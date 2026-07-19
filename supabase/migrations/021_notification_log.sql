-- 021_notification_log.sql
-- Журнал доставки бот-инициированных сообщений (чек-ины, дубли и т.п.).
-- Пишется только сервисной ролью (крон/бот). Тела сообщений и chat_id детально
-- НЕ храним — только факт, канал, тип, статус и краткая причина.
-- Идемпотентна: create table/index if not exists, drop policy if exists.

create table if not exists public.notification_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  channel    text not null,   -- 'telegram' | 'webpush' | ...
  type       text not null,   -- 'checkin' | 'reminder' | ...
  status     text not null,   -- 'sent' | 'skipped' | 'blocked' | 'failed'
  detail     text,            -- краткая причина/ошибка, без тела сообщения
  created_at timestamptz not null default now()
);

create index if not exists notification_log_user_idx
  on public.notification_log (user_id, created_at desc);

alter table public.notification_log enable row level security;

drop policy if exists "Service role manages notification_log" on public.notification_log;
create policy "Service role manages notification_log" on public.notification_log
  for all to service_role using (true) with check (true);
