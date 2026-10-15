-- «Пятница»: очередь отложенных сообщений (тихие часы 22:00–09:00 МСК).
-- Автоматическое сообщение, которое пришлось бы на ночь, ложится сюда с
-- send_after = 09:00 и уходит тикером; несколько сообщений одному человеку —
-- одним «Пока тебя не было:». Пишет и читает lib/team/outbox.ts.

create table if not exists public.team_outbox (
  id          bigint      generated always as identity primary key,
  chat_id     bigint      not null,
  project_id  text        not null default 'nika',
  kind        text        not null,
  payload     jsonb       not null,
  send_after  timestamptz not null,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);

comment on table public.team_outbox is 'Отложенные на тихие часы сообщения «Пятницы»';

create index if not exists team_outbox_due_idx on public.team_outbox (send_after) where sent_at is null;

alter table public.team_outbox enable row level security;

drop policy if exists "Service role manages team_outbox" on public.team_outbox;
create policy "Service role manages team_outbox" on public.team_outbox
  for all to service_role using (true) with check (true);

revoke all on table public.team_outbox from anon, authenticated;
