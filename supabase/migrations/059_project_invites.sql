-- «Пятница»: приглашения в проект.
-- Одноразовая ссылка t.me/<bot>?start=join_<token>: живёт 7 дней, срабатывает
-- один раз (used_by, used_at). Пишет lib/team/projects/invites.ts.

create table if not exists public.project_invites (
  token       text        primary key,
  project_id  text        not null references public.projects(id) on delete cascade,
  role        text        not null default 'member' check (role in ('admin', 'member')),
  title       text,
  departments text[]      not null default '{}',
  created_by  bigint      not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_by     bigint,
  used_at     timestamptz
);

comment on table public.project_invites is 'Одноразовые приглашения в проект «Пятницы» (7 дней)';

create index if not exists project_invites_project_idx on public.project_invites (project_id, created_at desc);

alter table public.project_invites enable row level security;

drop policy if exists "Service role manages project_invites" on public.project_invites;
create policy "Service role manages project_invites" on public.project_invites
  for all to service_role using (true) with check (true);

revoke all on table public.project_invites from anon, authenticated;
