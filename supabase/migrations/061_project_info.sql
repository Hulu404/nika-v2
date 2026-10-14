-- «Пятница»: модуль «📌 О проекте» (about).
--   project_info      — разделы: summary, links, facts, rules, questions (Telegram HTML);
--   project_questions — открытые вопросы проекта с ответственным, сроком и ответом.
-- Пишет lib/team/about/store.ts; начальное наполнение RESCAN — lib/team/projects/rescan-about-seed.ts
-- (только пустые разделы и вопросы, которых ещё нет).

create table if not exists public.project_info (
  project_id text        not null references public.projects(id) on delete cascade,
  section    text        not null check (section in ('summary', 'links', 'facts', 'rules', 'questions')),
  content    text        not null default '',
  updated_by bigint,
  updated_at timestamptz not null default now(),
  primary key (project_id, section)
);

comment on table public.project_info is 'Разделы «О проекте»: суть, материалы, цифры, правила (Telegram HTML)';

create table if not exists public.project_questions (
  id            bigint      generated always as identity primary key,
  project_id    text        not null references public.projects(id) on delete cascade,
  question      text        not null,
  owner_chat_id bigint,
  owner_label   text,
  due_date      date,
  due_label     text,
  status        text        not null default 'open' check (status in ('open', 'answered')),
  answer        text,
  answered_by   bigint,
  answered_at   timestamptz,
  created_at    timestamptz not null default now()
);

comment on table public.project_questions is 'Открытые вопросы проекта: кто решает, к какому сроку, ответ';

create unique index if not exists project_questions_project_question_idx on public.project_questions (project_id, question);

alter table public.project_info enable row level security;
alter table public.project_questions enable row level security;

drop policy if exists "Service role manages project_info" on public.project_info;
create policy "Service role manages project_info" on public.project_info
  for all to service_role using (true) with check (true);
drop policy if exists "Service role manages project_questions" on public.project_questions;
create policy "Service role manages project_questions" on public.project_questions
  for all to service_role using (true) with check (true);

revoke all on table public.project_info from anon, authenticated;
revoke all on table public.project_questions from anon, authenticated;
