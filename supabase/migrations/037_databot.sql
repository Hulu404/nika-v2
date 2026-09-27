-- 037_databot.sql
-- Бот данных команды: кто в него допущен (и в какой зоне), по каким
-- приглашениям люди входят и что они спрашивали.
--
-- Идемпотентна: create table/index if not exists, drop constraint if exists +
-- add constraint, смена первичного ключа — под проверкой его текущего вида.
-- Файл дописывается следующими частями и прогоняется ЦЕЛИКОМ повторно, поэтому
-- каждая секция обязана спокойно проходить второй и третий раз.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. databot_members: кому открыт бот данных
-- ─────────────────────────────────────────────────────────────────────────────
-- Отдельная таблица, а не team_members из 035: у командного бота роли
-- owner/member, а здесь доступ режется по зонам: деньги, продукт и состав
-- команды видит только совет, список участников забега — совет и ивенты.
-- Смешать два списка значило бы, что человек, позванный в оперативку по
-- забегам, автоматически увидел бы выручку.
--
-- Ключ — chat_id, а не ник: ник человек меняет когда захочет, id — никогда.
-- Убранного не удаляем, а гасим (is_active = false, removed_at): иначе в
-- журнале остались бы chat_id без имени и «кто это спрашивал выручку» было бы
-- не восстановить.
create table if not exists public.databot_members (
  chat_id      bigint      primary key,
  username     text,
  display_name text,
  zone         text        not null,
  -- Отражение DATABOT_OWNER_IDS на момент последнего визита. Права бот
  -- считает по env на каждом апдейте, столбец — только для списка «Команда».
  is_owner     boolean     not null default false,
  -- chat_id пригласившего. У владельцев из env пусто — они вошли без ссылки.
  invited_by   bigint,
  joined_at    timestamptz not null default now(),
  last_seen_at timestamptz,
  is_active    boolean     not null default true,
  removed_at   timestamptz
);

alter table public.databot_members
  drop constraint if exists databot_members_zone_check;
alter table public.databot_members
  add constraint databot_members_zone_check
  check (zone in ('council', 'events', 'smm'));

comment on table public.databot_members is
  'Кому открыт бот данных команды и в какой зоне. Пишет и читает только бот (lib/databot/data/supabase-store.ts)';
comment on column public.databot_members.chat_id is
  'Telegram chat_id (он же user_id в личке) — ключ, переживающий смену ника';
comment on column public.databot_members.zone is
  'council — все разделы; events и smm — забеги, соцсети и справочник своей зоны; матрица — lib/databot/access.ts';
comment on column public.databot_members.is_owner is
  'Отражение DATABOT_OWNER_IDS на последнем визите; права считаются по env, не по столбцу';
comment on column public.databot_members.invited_by is
  'chat_id того, чьё приглашение погашено; пусто у владельцев из env';
comment on column public.databot_members.last_seen_at is
  'Последний апдейт от человека — чтобы по «Команде» было видно, кто пользуется';
comment on column public.databot_members.is_active is
  'false — убран из бота; строка остаётся ради журнала';
comment on column public.databot_members.removed_at is
  'Когда убрали. Сбрасывается в null, если человек вошёл по новому приглашению';

alter table public.databot_members enable row level security;

-- Политик нет: ходит только service_role через бота, а он RLS обходит.
-- Включённый RLS без политик — это «anon и authenticated не видят ни строки»,
-- даже если гранты кто-то вернёт руками.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. databot_invites: одноразовые приглашения
-- ─────────────────────────────────────────────────────────────────────────────
-- Приглашение — это deep-link t.me/<бот>?start=inv_<token>. Зона зашита в само
-- приглашение, а не выбирается вошедшим: иначе ссылка для СММ открывала бы
-- выручку любому, кто догадался нажать другую кнопку.
--
-- Погашение — одной командой update … where used_at is null and expires_at >
-- now(): двое, нажавшие одну пересланную ссылку одновременно, не войдут оба.
-- Поэтому отдельного «статуса» нет — он выводится из used_at и expires_at.
create table if not exists public.databot_invites (
  token      text        primary key,
  zone       text        not null,
  created_by bigint      not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz,
  used_by    bigint
);

-- 32 hex-символа = 128 бит из crypto.randomBytes(16). Проверка в базе, а не
-- только в коде: токен уходит в deep-link, и мусор в ключе (пробелы, регистр)
-- означал бы ссылку, которую бот сам же не узнает.
alter table public.databot_invites
  drop constraint if exists databot_invites_token_check;
alter table public.databot_invites
  add constraint databot_invites_token_check
  check (token ~ '^[0-9a-f]{32}$');

alter table public.databot_invites
  drop constraint if exists databot_invites_zone_check;
alter table public.databot_invites
  add constraint databot_invites_zone_check
  check (zone in ('council', 'events', 'smm'));

comment on table public.databot_invites is
  'Одноразовые приглашения в бот данных. Неиспользованные старше 7 дней удаляет уборка (lib/databot/cleanup.ts)';
comment on column public.databot_invites.token is
  '32 hex-символа, часть deep-link ?start=inv_<token>';
comment on column public.databot_invites.zone is
  'Зона, которую получит вошедший: council, events или smm';
comment on column public.databot_invites.created_by is
  'chat_id владельца, выпустившего приглашение';
comment on column public.databot_invites.expires_at is
  'После этого момента приглашение не гасится';
comment on column public.databot_invites.used_at is
  'Когда погашено; null — ещё нет. Гасится одной командой update … where used_at is null';
comment on column public.databot_invites.used_by is
  'chat_id вошедшего по приглашению';

alter table public.databot_invites enable row level security;

-- Политик нет: ходит только service_role через бота.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. databot_audit: журнал запросов
-- ─────────────────────────────────────────────────────────────────────────────
-- Кто, какой отчёт и с какими параметрами смотрел. Нужен для двух вещей:
-- экрана «Команда» (кто чем пользуется) и разбора «бот не понял» — поэтому
-- у нераспознанных текстов хранится raw_text. Сам текст — это то, что человек
-- написал боту, то есть потенциально персональные данные: через 30 дней
-- уборка его обнуляет, через 180 дней удаляет строку целиком.
create table if not exists public.databot_audit (
  id         bigint      generated always as identity primary key,
  chat_id    bigint      not null,
  zone       text,
  -- ID отчёта из lib/databot/types.ts (run.card, tr.codes…) или служебный
  -- (start, unknown, rate_limited…). Без check: каталог отчётов растёт вместе
  -- с ботом, и каждая новая кнопка не должна требовать миграции.
  report     text        not null,
  -- Только проверенные валидаторами значения без персональных данных.
  params     jsonb       not null default '{}',
  source     text,
  ok         boolean     not null,
  error      text,
  latency_ms int,
  raw_text   text,
  created_at timestamptz not null default now()
);

alter table public.databot_audit
  drop constraint if exists databot_audit_source_check;
alter table public.databot_audit
  add constraint databot_audit_source_check
  check (source in ('button', 'command', 'text', 'llm'));

comment on table public.databot_audit is
  'Журнал запросов к боту данных. raw_text обнуляется через 30 дней, строки удаляются через 180 (lib/databot/cleanup.ts)';
comment on column public.databot_audit.report is
  'ID отчёта (run.card, tr.codes…) или служебный (start, unknown, rate_limited…)';
comment on column public.databot_audit.params is
  'Проверенные параметры запроса без персональных данных';
comment on column public.databot_audit.source is
  'Откуда пришёл запрос: button, command, text или llm; null — не определено';
comment on column public.databot_audit.ok is
  'Ответ построен без ошибки';
comment on column public.databot_audit.error is
  'Короткий код или текст ошибки, если ok = false';
comment on column public.databot_audit.latency_ms is
  'Сколько миллисекунд занял ответ';
comment on column public.databot_audit.raw_text is
  'Исходный текст — только у нераспознанных запросов; обнуляется через 30 дней';

-- Уборка режет по возрасту, «Команда» считает активность за период.
create index if not exists databot_audit_created_at_idx
  on public.databot_audit (created_at);
-- История одного человека — «что он смотрел за неделю».
create index if not exists databot_audit_chat_created_idx
  on public.databot_audit (chat_id, created_at);

alter table public.databot_audit enable row level security;

-- Политик нет: ходит только service_role через бота.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. processed_updates: третий бот в дедупе
-- ─────────────────────────────────────────────────────────────────────────────
-- Бот данных пишет свои апдейты с bot = 'data'. Check на колонку bot в 035 не
-- ставили, так что новое значение проходит без изменений схемы.
--
-- Но всё держится на составном ключе (bot, update_id) из 035, а то, что смена
-- ключа там реально прошла в проде, никто не проверял. Если ключ остался
-- одноколоночным, у третьего бота повторится ровно та поломка, ради которой
-- 035 писалась: update_id у каждого бота нумеруется сам по себе, апдейт №7
-- бота данных встретит №7 основного, получит 23505 и будет МОЛЧА выброшен как
-- повторный. Поэтому тот же блок повторяем здесь: на уже составном ключе он
-- ничего не трогает, на старом — чинит.
do $$
begin
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

comment on column public.processed_updates.bot is
  'Какому боту принадлежит update_id: nika — основной, team — внутренний бот команды, data — бот данных команды';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Гранты
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase раздаёт anon и authenticated гранты на объекты public-схемы
-- автоматически. Здесь список тех, кто видит выручку, приглашения-пропуска и
-- журнал вопросов, — снимаем, как в 033–036. Держим в самом конце файла, чтобы
-- снятие шло после всех create.
revoke all on table public.databot_members from anon, authenticated;
revoke all on table public.databot_invites from anon, authenticated;
revoke all on table public.databot_audit   from anon, authenticated;
