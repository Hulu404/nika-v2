-- 049_social_snapshots.sql
-- Снимки подписчиков соцсетей и настройки, которые меняются из бота без деплоя.
--
-- Telegram-канал снимается автоматически (getChatMemberCount токеном «Цифр
-- команды»), Instagram вносит человек вручную. Читают сводка фаундерам и
-- раздел «Соцсети» бота данных (lib/databot/founders/).
--
-- Идемпотентна: create table/index if not exists, drop policy if exists.

create table if not exists public.social_snapshots (
  id         bigint generated always as identity primary key,
  platform   text        not null check (platform in ('telegram', 'instagram')),
  followers  integer     not null check (followers >= 0),
  source     text        not null check (source in ('auto', 'manual')),
  taken_at   timestamptz not null default now(),
  -- chat_id того, кто внёс число; для auto пусто.
  entered_by bigint,
  constraint social_snapshots_manual_by check (source = 'auto' or entered_by is not null)
);

comment on table public.social_snapshots is
  'Подписчики соцсетей во времени. Пишет и читает lib/databot/founders/social-store.ts';

create index if not exists social_snapshots_platform_taken_idx
  on public.social_snapshots (platform, taken_at desc);

-- Настройки из бота: key — имя (instagram_owner_chat_id), value — строка.
create table if not exists public.team_settings (
  key        text        primary key,
  value      text,
  updated_by bigint,
  updated_at timestamptz not null default now()
);

comment on table public.team_settings is
  'Настройки команды, которые меняются из бота без деплоя (instagram_owner_chat_id)';

alter table public.social_snapshots enable row level security;
alter table public.team_settings enable row level security;

drop policy if exists "Service role manages social_snapshots" on public.social_snapshots;
create policy "Service role manages social_snapshots" on public.social_snapshots
  for all to service_role using (true) with check (true);
drop policy if exists "Service role manages team_settings" on public.team_settings;
create policy "Service role manages team_settings" on public.team_settings
  for all to service_role using (true) with check (true);

revoke all on table public.social_snapshots from anon, authenticated;
revoke all on table public.team_settings from anon, authenticated;
