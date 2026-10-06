-- 046_team_events.sql
-- «Пятница» v2: расписание команды. Ивенты клубов, планёрки и прочее.
-- Кофе-раны сюда не пишутся: бот подмешивает их из COFFEE_RUNS
-- (lib/coffeerun/run.ts) только для чтения.
--
-- Идемпотентна: create table/index if not exists, drop policy if exists.

create table if not exists public.team_events (
  id                  bigint generated always as identity primary key,
  kind                text        not null check (kind in ('club_event', 'meeting', 'other')),
  -- Ключ клуба из lib/team/clubs.ts (run — «Беговой клуб»). Для не-клубных пусто.
  club                text,
  title               text        not null check (length(trim(title)) between 1 and 200),
  starts_at           timestamptz not null,
  place               text,
  notes               text,
  -- chat_id ответственного из team_members. Пусто — ответственного нет.
  responsible_chat_id bigint,
  created_by          bigint      not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  cancelled_at        timestamptz,
  constraint team_events_club_kind check (kind = 'club_event' or club is null)
);

comment on table public.team_events is
  'Расписание команды: ивенты клубов, планёрки, прочее. Пишет и читает lib/team/events.ts';

create index if not exists team_events_starts_idx
  on public.team_events (starts_at)
  where cancelled_at is null;

alter table public.team_events enable row level security;

-- Как у team_members: ходит только service_role через бота.
drop policy if exists "Service role manages team_events" on public.team_events;
create policy "Service role manages team_events" on public.team_events
  for all to service_role using (true) with check (true);

revoke all on table public.team_events from anon, authenticated;
