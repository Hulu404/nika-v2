-- 047_team_event_facts.sql
-- «Пятница» v2: фактическая явка на ивенты и отметка «уже спросили».
--
-- Ключ ивента — текст: coffeerun:<spot>:<date> для кофе-ранов из COFFEE_RUNS
-- и event:<id> для team_events. Явку вносит любой участник, исправить уже
-- внесённую могут только фаундеры (проверка в боте, lib/team/attendance.ts).
--
-- Идемпотентна: create table if not exists, drop policy if exists.

create table if not exists public.team_event_facts (
  event_key  text        primary key,
  attended   integer     not null check (attended >= 0),
  entered_by bigint      not null,
  entered_at timestamptz not null default now()
);

comment on table public.team_event_facts is
  'Сколько человек пришло на ивент. Пишет и читает lib/team/attendance.ts';

-- Через 3 часа после начала ивента клуба бот один раз спрашивает
-- ответственного (или фаундеров), сколько пришло. Отметка в базе, а не в
-- памяти: тикер делает первый проход на каждом деплое и спросил бы снова.
create table if not exists public.team_event_asks (
  event_key text        primary key,
  asked_at  timestamptz not null default now()
);

comment on table public.team_event_asks is
  'Каким ивентам бот уже задал вопрос о явке. Пишет и читает lib/team/attendance.ts';

alter table public.team_event_facts enable row level security;
alter table public.team_event_asks enable row level security;

drop policy if exists "Service role manages team_event_facts" on public.team_event_facts;
create policy "Service role manages team_event_facts" on public.team_event_facts
  for all to service_role using (true) with check (true);
drop policy if exists "Service role manages team_event_asks" on public.team_event_asks;
create policy "Service role manages team_event_asks" on public.team_event_asks
  for all to service_role using (true) with check (true);

revoke all on table public.team_event_facts from anon, authenticated;
revoke all on table public.team_event_asks from anon, authenticated;
