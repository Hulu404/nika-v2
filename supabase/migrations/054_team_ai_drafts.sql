-- «Пятница»: голос и свободный текст.
--   team_ai_drafts           — черновик из фразы до нажатия «✅ Создать» (живёт час);
--   team_reminders           — личные напоминания «напомни мне в 14:00…»;
--   team_event_participants  — участники встреч, поставленных фразой.
-- Пишет lib/team/ai/stores.ts. Голосовые не хранятся нигде; распознанный
-- текст — только в черновике и удаляется вместе с ним.

create table if not exists public.team_ai_drafts (
  id           bigserial   primary key,
  chat_id      bigint      not null,
  intent       jsonb       not null,
  source_text  text,
  message_id   bigint,
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz
);

comment on table public.team_ai_drafts is
  'Черновики из голоса и текста: создаются только по «✅ Создать», удаляются через час';

create index if not exists team_ai_drafts_created_idx on public.team_ai_drafts (created_at);

create table if not exists public.team_reminders (
  id         bigserial   primary key,
  chat_id    bigint      not null,
  text       text        not null check (char_length(text) between 1 and 1000),
  remind_at  timestamptz not null,
  task_id    bigint,
  sent_at    timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.team_reminders is
  'Личные напоминания: видит и получает только автор (chat_id). Отправляет поминутный тикер';

create index if not exists team_reminders_due_idx on public.team_reminders (remind_at) where sent_at is null;

create table if not exists public.team_event_participants (
  event_id bigint not null references public.team_events(id) on delete cascade,
  chat_id  bigint not null,
  primary key (event_id, chat_id)
);

comment on table public.team_event_participants is
  'Участники встречи. Событие с участниками видно в «Моём дне» только им';

create index if not exists team_event_participants_chat_idx on public.team_event_participants (chat_id);

alter table public.team_ai_drafts enable row level security;
alter table public.team_reminders enable row level security;
alter table public.team_event_participants enable row level security;

drop policy if exists "Service role manages team_ai_drafts" on public.team_ai_drafts;
create policy "Service role manages team_ai_drafts" on public.team_ai_drafts
  for all to service_role using (true) with check (true);
drop policy if exists "Service role manages team_reminders" on public.team_reminders;
create policy "Service role manages team_reminders" on public.team_reminders
  for all to service_role using (true) with check (true);
drop policy if exists "Service role manages team_event_participants" on public.team_event_participants;
create policy "Service role manages team_event_participants" on public.team_event_participants
  for all to service_role using (true) with check (true);

revoke all on table public.team_ai_drafts from anon, authenticated;
revoke all on table public.team_reminders from anon, authenticated;
revoke all on table public.team_event_participants from anon, authenticated;
