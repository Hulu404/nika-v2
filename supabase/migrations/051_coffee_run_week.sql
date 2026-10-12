-- 051_coffee_run_week.sql
-- «Пятница»: кофе-ран недели как событие бегового клуба, отделы команды,
-- опрос «кто будет» и подтверждение за сутки.
--
-- Идемпотентна: add column if not exists, create table if not exists,
-- drop policy if exists.

-- ── События: формат и спот кофе-рана, подтверждение за 24 часа ───────────────
alter table public.team_events
  add column if not exists format text,
  add column if not exists spot text,
  -- Когда ответственного спросили «Проводим?» за 24 часа, когда ответили и
  -- когда пожаловались фаундерам, что ответа нет (за 12 часов).
  add column if not exists confirm_asked_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirm_nag_at timestamptz;

alter table public.team_events drop constraint if exists team_events_format_check;
alter table public.team_events
  add constraint team_events_format_check check (format is null or format = 'coffee_run');

comment on column public.team_events.format is 'coffee_run — кофе-ран; NULL — обычное событие';
comment on column public.team_events.spot is 'Слаг спота кофе-рана, как в COFFEE_RUNS (usachevo, luzhniki); NULL — другое место';

create index if not exists team_events_coffee_run_idx
  on public.team_events (spot, starts_at)
  where format = 'coffee_run';

-- ── Отделы команды ───────────────────────────────────────────────────────────
-- Значения — в коде (lib/team/departments.ts): smm, events.
alter table public.team_members
  add column if not exists departments text[] not null default '{}';

comment on column public.team_members.departments is 'Отделы человека (lib/team/departments.ts): smm, events';

-- ── Неделя кофе-рана ─────────────────────────────────────────────────────────
-- Строка заводится, когда в понедельник фаундерам ушёл вопрос «Проводим?»:
-- вставка с primary key — она же дедуп на повторных деплоях. Решение
-- фиксируется одним UPDATE … WHERE decision IS NULL: кто первый, того и решение.
create table if not exists public.coffee_run_weeks (
  week_start           date        primary key,   -- понедельник недели по Москве
  decision             text        check (decision in ('yes', 'no')),
  decided_by           bigint,
  decided_at           timestamptz,
  event_id             bigint      references public.team_events(id) on delete set null,
  responsible_asked_at timestamptz,
  asked_at             timestamptz not null default now(),
  reminder_sent_at     timestamptz,
  -- Сообщения с вопросом у каждого фаундера: [{chat, message_id}] — их правим на итог.
  messages             jsonb       not null default '[]'::jsonb,
  -- Задачи, поставленные под этот кофе-ран: их отменяют вместе с забегом.
  task_ids             bigint[]    not null default '{}'
);

comment on table public.coffee_run_weeks is
  'Кофе-ран недели: вопрос фаундерам в понедельник и решение. Пишет lib/team/coffee-run-week.ts';

-- ── Опрос команды «кто будет» ────────────────────────────────────────────────
create table if not exists public.team_event_rsvp (
  event_id    bigint      not null references public.team_events(id) on delete cascade,
  chat_id     bigint      not null,
  answer      text        not null check (answer in ('yes', 'no')),
  answered_at timestamptz not null default now(),
  primary key (event_id, chat_id)
);

comment on table public.team_event_rsvp is 'Кто из команды будет на событии. Пишет lib/team/coffee-run-week.ts';

alter table public.coffee_run_weeks enable row level security;
alter table public.team_event_rsvp enable row level security;

drop policy if exists "Service role manages coffee_run_weeks" on public.coffee_run_weeks;
create policy "Service role manages coffee_run_weeks" on public.coffee_run_weeks
  for all to service_role using (true) with check (true);
drop policy if exists "Service role manages team_event_rsvp" on public.team_event_rsvp;
create policy "Service role manages team_event_rsvp" on public.team_event_rsvp
  for all to service_role using (true) with check (true);

revoke all on table public.coffee_run_weeks from anon, authenticated;
revoke all on table public.team_event_rsvp from anon, authenticated;
