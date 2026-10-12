-- «Пятница»: имена, должности и варианты имени участников.
-- Начальные данные — lib/team/roster.ts: пишутся только в пустые поля и только
-- тем, чей профиль ещё не меняли в боте (profile_edited_at is null).
-- По имени и вариантам код находит человека во фразе («поставь Маше…»).

alter table public.team_members add column if not exists first_name text;
alter table public.team_members add column if not exists title text;
alter table public.team_members add column if not exists name_aliases text[] not null default '{}';
alter table public.team_members add column if not exists profile_edited_at timestamptz;

comment on column public.team_members.first_name is 'Имя, как его называют в команде (Маша). Начальное — lib/team/roster.ts';
comment on column public.team_members.title is 'Должность (Ивент-отдел). Прав не даёт: фаундеры — TEAM_FOUNDER_IDS';
comment on column public.team_members.name_aliases is 'Другие варианты имени (Дима) для поиска во фразе';
comment on column public.team_members.profile_edited_at is 'Когда профиль меняли в боте; после этого roster.ts его не трогает';
