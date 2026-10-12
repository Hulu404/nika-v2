-- «Пятница»: учёт расхода Yandex AI Studio (голос и свободный текст).
-- Только объёмы: тексты запросов и голосовые не хранятся.
-- Пишет и читает lib/team/ai/yandex.ts; по этой же таблице считается лимит
-- 40 запросов к LLM на человека в час.

create table if not exists public.team_ai_usage (
  id            bigserial   primary key,
  chat_id       bigint      not null,
  kind          text        not null check (kind in ('stt', 'llm')),
  tokens_in     integer,
  tokens_out    integer,
  audio_seconds integer,
  created_at    timestamptz not null default now()
);

comment on table public.team_ai_usage is
  'Расход Yandex AI Studio по людям: распознавание (stt) и разбор текста (llm). Без текстов запросов';

create index if not exists team_ai_usage_chat_kind_created_idx
  on public.team_ai_usage (chat_id, kind, created_at desc);

alter table public.team_ai_usage enable row level security;

drop policy if exists "Service role manages team_ai_usage" on public.team_ai_usage;
create policy "Service role manages team_ai_usage" on public.team_ai_usage
  for all to service_role using (true) with check (true);

revoke all on table public.team_ai_usage from anon, authenticated;
