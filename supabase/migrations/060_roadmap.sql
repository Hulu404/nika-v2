-- «Пятница»: модуль «🗺 План развития» (roadmap).
--   roadmap_items — контрольные точки (milestone), этапы (stage) и пункты (item)
--                   плана проекта; пункт может быть условием контрольной точки
--                   (milestone_id); код (КТ1, B4, FE3) уникален в проекте.
--   databot_assigned_tasks.roadmap_item_id — задача, привязанная к пункту.
-- Пишет lib/team/roadmap/store.ts, начальное наполнение RESCAN —
-- lib/team/projects/rescan-seed.ts (идемпотентно по project_id + code).

create table if not exists public.roadmap_items (
  id            bigint      generated always as identity primary key,
  project_id    text        not null references public.projects(id) on delete cascade,
  kind          text        not null check (kind in ('milestone', 'stage', 'item')),
  code          text,
  title         text        not null,
  details       text,
  "group"       text,
  milestone_id  bigint      references public.roadmap_items(id) on delete set null,
  start_date    date,
  due_date      date,
  status        text        not null default 'planned' check (status in ('planned', 'in_progress', 'done', 'blocked', 'dropped')),
  owner_chat_id bigint,
  sort          integer     not null default 0,
  updated_by    bigint,
  updated_at    timestamptz not null default now()
);

comment on table public.roadmap_items is 'План развития проекта: контрольные точки, этапы и пункты по группам';

create unique index if not exists roadmap_items_project_code_idx on public.roadmap_items (project_id, code) where code is not null;
create index if not exists roadmap_items_project_idx on public.roadmap_items (project_id, kind, sort);

alter table public.databot_assigned_tasks add column if not exists roadmap_item_id bigint references public.roadmap_items(id) on delete set null;
create index if not exists databot_assigned_tasks_roadmap_idx on public.databot_assigned_tasks (roadmap_item_id) where roadmap_item_id is not null;

alter table public.roadmap_items enable row level security;

drop policy if exists "Service role manages roadmap_items" on public.roadmap_items;
create policy "Service role manages roadmap_items" on public.roadmap_items
  for all to service_role using (true) with check (true);

revoke all on table public.roadmap_items from anon, authenticated;
