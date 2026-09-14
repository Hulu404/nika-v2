-- 035_team_bot.sql
-- Внутренний бот команды: кто в него допущен и как не перепутать его апдейты
-- с апдейтами основного бота.
--
-- Идемпотентна: create table/index if not exists, drop policy if exists,
-- смена первичного ключа — под проверкой его текущего вида. Прогон дважды
-- подряд проходит без ошибок.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. team_members: состав команды
-- ─────────────────────────────────────────────────────────────────────────────
-- Почему таблица, а не память процесса (в отличие от опроса про погоду в
-- lib/telegram/poll-store.ts): нынешний список админов живёт в памяти и
-- обнуляется на каждом деплое — после релиза организатор заново ищет ключ в
-- панели хостинга и вводит /admin. Для разового опроса это терпимо, для
-- рабочего инструмента команды — нет: доступ должен пережить релиз, а «кто у
-- нас вообще в боте» должно быть видно списком, а не вспоминаться.
--
-- Ключ — chat_id, а не ник: ник в Telegram человек меняет когда захочет, id —
-- никогда. Ник храним рядом, чтобы команда узнавала друг друга в /team и
-- чтобы /kick работал по @нику, а не по числу.
create table if not exists public.team_members (
  chat_id      bigint      primary key,
  username     text,
  display_name text,
  -- owner может добавлять и убирать людей, member — только смотреть данные.
  -- Первый вошедший становится owner: иначе убрать случайного человека было бы
  -- некому, пока кто-то не полезет в SQL.
  role         text        not null default 'member',
  joined_at    timestamptz not null default now(),
  -- chat_id того, кто позвал. Для первого owner'а пусто — он вошёл по ключу.
  added_by     bigint,
  -- Когда человек последний раз что-то спрашивал у бота. Нужно ровно для
  -- одного: понять по /team, кто пользуется, а кого пора убрать.
  last_seen_at timestamptz,
  constraint team_members_role_check check (role in ('owner', 'member'))
);

comment on table public.team_members is
  'Кому открыт внутренний бот команды. Пишет и читает только бот (lib/team/access.ts)';
comment on column public.team_members.chat_id is
  'Telegram chat_id (он же user_id в личке) — ключ, переживающий смену ника';
comment on column public.team_members.role is
  'owner — может звать и убирать людей; member — только читает оперативку';

-- Поиск по нику для /kick @ник. Ник не уникален во времени (человек его
-- освободил, другой занял), поэтому индекс обычный, не unique.
create index if not exists team_members_username_idx
  on public.team_members (lower(username))
  where username is not null;

alter table public.team_members enable row level security;

-- Политик нет: ходит только service_role через бота, а он RLS обходит.
drop policy if exists "Service role manages team_members" on public.team_members;
create policy "Service role manages team_members" on public.team_members
  for all to service_role using (true) with check (true);

-- Supabase раздаёт anon и authenticated гранты на объекты public-схемы
-- автоматически. Здесь лежит список тех, кто видит операционку, — снимаем,
-- как в 033 и 034.
revoke all on table public.team_members from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. processed_updates: развести дедуп двух ботов
-- ─────────────────────────────────────────────────────────────────────────────
-- В 020 первичный ключ — один update_id. Пока бот был один, этого хватало.
-- Теперь ботов два, и update_id у каждого свой, со своей нумерацией с нуля:
-- апдейт №7 командного бота встретил бы в таблице апдейт №7 основного, получил
-- бы 23505 и был бы МОЛЧА выброшен как повторный. Снаружи это выглядит как
-- «бот через раз не отвечает» — самый неприятный вид поломки.
--
-- Поэтому в ключ добавляется бот. Существующие строки получают 'nika'
-- (основной бот) через default, и роут app/api/telegram/webhook править не
-- нужно: он вставляет по-прежнему только update_id.
alter table public.processed_updates
  add column if not exists bot text not null default 'nika';

comment on column public.processed_updates.bot is
  'Какому боту принадлежит update_id: nika — основной, team — внутренний бот команды';

do $$
begin
  -- Меняем ключ только если он всё ещё старый, одноколоночный. Повторный
  -- прогон миграции увидит уже составной и ничего не тронет.
  if exists (
    select 1
      from pg_constraint
     where conrelid = 'public.processed_updates'::regclass
       and contype  = 'p'
       and pg_get_constraintdef(oid) = 'PRIMARY KEY (update_id)'
  ) then
    alter table public.processed_updates drop constraint processed_updates_pkey;
    alter table public.processed_updates
      add constraint processed_updates_pkey primary key (bot, update_id);
  end if;
end $$;
