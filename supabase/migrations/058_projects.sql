-- «Пятница» → бот компании JBD: проекты NIKA и RESCAN.
--   projects        — проекты и их модули (ядро у всех: tasks, schedule, team, my_day, assistant);
--   project_members — кто в каком проекте, роль (admin | member), должность и отделы в проекте;
--   team_members.current_project — какой проект человек сейчас смотрит.
-- Всё существующее (задачи, события, напоминания, память ассистента, сводки)
-- остаётся в проекте nika: колонки project_id с default 'nika'.
-- Должность и отделы переезжают из team_members в project_members (для nika);
-- старые колонки не удаляются, код читает новые.
-- Идемпотентна: if not exists, on conflict do nothing, проверки ключей.

create table if not exists public.projects (
  id         text        primary key,
  name       text        not null,
  emoji      text        not null default '',
  modules    text[]      not null default '{}',
  sort       integer     not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.projects is 'Проекты компании в «Пятнице»; modules — какие разделы, кнопки и тикеры включены';

insert into public.projects (id, name, emoji, modules, sort) values
  ('nika', 'NIKA', '🏃', array['tasks', 'schedule', 'team', 'my_day', 'assistant', 'events', 'coffee_run', 'attendance', 'founders_digest', 'social'], 1),
  ('rescan', 'RESCAN', '🔬', array['tasks', 'schedule', 'team', 'my_day', 'assistant', 'roadmap', 'about'], 2)
on conflict (id) do nothing;

create table if not exists public.project_members (
  project_id  text        not null references public.projects(id) on delete cascade,
  chat_id     bigint      not null,
  role        text        not null default 'member' check (role in ('admin', 'member')),
  title       text,
  departments text[]      not null default '{}',
  added_by    bigint,
  joined_at   timestamptz not null default now(),
  primary key (project_id, chat_id)
);

comment on table public.project_members is 'Участники проектов: роль, должность и отделы — у человека в каждом проекте свои';

create index if not exists project_members_chat_idx on public.project_members (chat_id);

alter table public.team_members add column if not exists current_project text references public.projects(id) on delete set null;

-- Все текущие участники — в nika, с их должностью и отделами.
insert into public.project_members (project_id, chat_id, title, departments, joined_at)
select 'nika', chat_id, title, coalesce(departments, '{}'), joined_at from public.team_members
on conflict (project_id, chat_id) do nothing;

-- project_id: всё, что было, — nika.
alter table public.databot_assigned_tasks add column if not exists project_id text not null default 'nika' references public.projects(id);
alter table public.team_events            add column if not exists project_id text not null default 'nika' references public.projects(id);
alter table public.team_reminders         add column if not exists project_id text not null default 'nika' references public.projects(id);
alter table public.team_ai_turns          add column if not exists project_id text not null default 'nika' references public.projects(id);
alter table public.team_ai_drafts         add column if not exists project_id text not null default 'nika' references public.projects(id);
alter table public.team_digests           add column if not exists project_id text not null default 'nika' references public.projects(id);

create index if not exists databot_assigned_tasks_project_assignee_idx on public.databot_assigned_tasks (project_id, assignee_id);
create index if not exists team_events_project_starts_idx on public.team_events (project_id, starts_at);
create index if not exists team_reminders_project_chat_idx on public.team_reminders (project_id, chat_id);
create index if not exists team_ai_turns_project_chat_idx on public.team_ai_turns (project_id, chat_id, created_at desc);

-- Дедуп сводок — с проектом в ключе.
do $$
declare pk_name text;
begin
  select c.conname into pk_name
    from pg_constraint c
   where c.conrelid = 'public.team_digests'::regclass and c.contype = 'p';
  if pk_name is not null and not exists (
    select 1 from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.conname = pk_name and c.conrelid = 'public.team_digests'::regclass and a.attname = 'project_id'
  ) then
    execute format('alter table public.team_digests drop constraint %I', pk_name);
    alter table public.team_digests add primary key (kind, spot, run_date, project_id);
  end if;
end $$;

alter table public.projects enable row level security;
alter table public.project_members enable row level security;

drop policy if exists "Service role manages projects" on public.projects;
create policy "Service role manages projects" on public.projects
  for all to service_role using (true) with check (true);
drop policy if exists "Service role manages project_members" on public.project_members;
create policy "Service role manages project_members" on public.project_members
  for all to service_role using (true) with check (true);

revoke all on table public.projects from anon, authenticated;
revoke all on table public.project_members from anon, authenticated;
