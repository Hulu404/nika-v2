-- «Пятница»: память диалога ассистента.
--   team_ai_turns — последние реплики человека и ассистента (12 на человека,
--                   старше 6 часов удаляются); content усечён;
--   team_ai_state — открытый черновик и последний показанный список
--                   (задачи, события, напоминания) с порядковыми номерами:
--                   на них опираются «удали вторую», «перенеси её на пятницу».
-- Пишет lib/team/ai/memory.ts. Тексты отсюда в другие таблицы и логи не попадают.

create table if not exists public.team_ai_turns (
  id         bigserial   primary key,
  chat_id    bigint      not null,
  role       text        not null check (role in ('user', 'assistant', 'tool')),
  content    text        not null,
  created_at timestamptz not null default now()
);

comment on table public.team_ai_turns is
  'Память диалога «Пятницы»: последние 12 реплик на человека, не старше 6 часов';

create index if not exists team_ai_turns_chat_created_idx on public.team_ai_turns (chat_id, created_at desc);

create table if not exists public.team_ai_state (
  chat_id    bigint      primary key,
  draft_id   bigint,
  last_list  jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.team_ai_state is
  'Открытый черновик и последний показанный список ассистента на человека';

alter table public.team_ai_turns enable row level security;
alter table public.team_ai_state enable row level security;

drop policy if exists "Service role manages team_ai_turns" on public.team_ai_turns;
create policy "Service role manages team_ai_turns" on public.team_ai_turns
  for all to service_role using (true) with check (true);
drop policy if exists "Service role manages team_ai_state" on public.team_ai_state;
create policy "Service role manages team_ai_state" on public.team_ai_state
  for all to service_role using (true) with check (true);

revoke all on table public.team_ai_turns from anon, authenticated;
revoke all on table public.team_ai_state from anon, authenticated;
