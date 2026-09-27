-- 037_databot.sql
-- Бот данных команды: кто в него допущен (и в какой зоне), по каким
-- приглашениям люди входят и что они спрашивали (часть 1, секции 1–4);
-- справочник, план явки, поля атрибуции и SQL-функции отчётов (часть 2,
-- секции 5–8); права на функции и таблицы — в самом конце (секции 9–10).
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

-- ═════════════════════════════════════════════════════════════════════════════
-- ЧАСТЬ 2 (Промт 3): справочник, план явки, поля атрибуции, функции отчётов
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. databot_kb: справочник команды
-- ─────────────────────────────────────────────────────────────────────────────
-- Редактируемые статьи. Тексты в репозиторий не кладём (он публичный, а в
-- «Предложениях» для совета есть суммы) — их заливает Али отдельным SQL.
-- prev_body — одна прошлая версия: «Вернуть прошлую версию» после неудачной
-- правки, а не история изменений.
create table if not exists public.databot_kb (
  slug       text        primary key,
  title      text        not null,
  body       text        not null,
  zones      text[]      not null default '{council,events,smm}',
  aliases    text[]      not null default '{}',
  sort       int         not null default 100,
  updated_at timestamptz not null default now(),
  updated_by bigint,
  prev_body  text
);

alter table public.databot_kb drop constraint if exists databot_kb_slug_check;
alter table public.databot_kb
  add constraint databot_kb_slug_check check (slug ~ '^[a-z0-9-]{2,40}$');

-- 3500, а не 4096 (лимит сообщения Telegram): к тексту добавляются заголовок
-- и подпись «обновлено 27.09, Али», и статья должна влезать одним сообщением.
alter table public.databot_kb drop constraint if exists databot_kb_body_check;
alter table public.databot_kb
  add constraint databot_kb_body_check check (char_length(body) <= 3500);

-- Статья без зон не видна никому — это не статья, а ошибка ввода.
alter table public.databot_kb drop constraint if exists databot_kb_zones_check;
alter table public.databot_kb
  add constraint databot_kb_zones_check
  check (cardinality(zones) > 0 and zones <@ array['council', 'events', 'smm']::text[]);

comment on table public.databot_kb is
  'Справочник бота данных: редактируемые статьи. Тексты заливаются вне репозитория';
comment on column public.databot_kb.zones is
  'Каким зонам видна статья: council, events, smm';
comment on column public.databot_kb.aliases is
  'Слова для поиска статьи по вопросу текстом';
comment on column public.databot_kb.prev_body is
  'Прошлая версия текста — для «Вернуть прошлую версию»';

alter table public.databot_kb enable row level security;
-- Политик нет: ходит только service_role через бота.

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. databot_run_plans: план явки на забег
-- ─────────────────────────────────────────────────────────────────────────────
-- «Сколько человек считаем полной точкой» — ручная цифра ведущих, от неё
-- считается процент и строка «ниже 60 % плана». Новое число заменяет старое,
-- поэтому ключ — сама пара (спот, дата), без истории.
create table if not exists public.databot_run_plans (
  spot     text        not null,
  run_date date        not null,
  target   int         not null,
  set_by   bigint      not null,
  set_at   timestamptz not null default now(),
  primary key (spot, run_date)
);

alter table public.databot_run_plans drop constraint if exists databot_run_plans_target_check;
alter table public.databot_run_plans
  add constraint databot_run_plans_target_check check (target between 5 and 200);

comment on table public.databot_run_plans is
  'План явки на забег (спот, дата): число «полной точки», задают ивенты и совет';
comment on column public.databot_run_plans.set_by is
  'chat_id того, кто задал план';

alter table public.databot_run_plans enable row level security;
-- Политик нет: ходит только service_role через бота.

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Изменения существующих таблиц
-- ─────────────────────────────────────────────────────────────────────────────

-- 7.1 coffee_run_signups: метка перехода, с которой человек записался.
-- Пишет /api/coffeerun-signup после эпика 5 (Промт 11). source остаётся как
-- был — это лендинг, а не источник перехода.
alter table public.coffee_run_signups add column if not exists attr_first text;
alter table public.coffee_run_signups add column if not exists attr_last  text;

comment on column public.coffee_run_signups.attr_first is
  'Код метки первого касания (кука nika_attr_first); только коды из link_codes, иначе null';
comment on column public.coffee_run_signups.attr_last is
  'Код метки последнего касания (кука nika_attr_last) — по нему считаются «заявки по метке»';

-- «Заявки по метке за период» — отбор по attr_last и created_at.
create index if not exists coffee_run_signups_attr_last_idx
  on public.coffee_run_signups (attr_last, created_at);

-- 7.2 link_codes: кто и как создал метку. Метки из миграций — 'sql', выданные
-- кнопкой в боте — 'databot' с chat_id сотрудника.
alter table public.link_codes add column if not exists created_by_chat bigint;
alter table public.link_codes add column if not exists created_via text not null default 'sql';

alter table public.link_codes drop constraint if exists link_codes_created_via_check;
alter table public.link_codes
  add constraint link_codes_created_via_check check (created_via in ('sql', 'databot'));

comment on column public.link_codes.created_by_chat is
  'chat_id сотрудника, выдавшего метку в боте данных; пусто у меток из миграций';
comment on column public.link_codes.created_via is
  'sql — метка заведена миграцией или руками; databot — выдана кнопкой в боте данных';

-- Канал метки: отчёт «соцсети» — это instagram, telegram и vk. Засеянные в 033
-- метки уже записаны правильно (instagram, telegram, offline); update ниже —
-- страховка на случай ручных правок: регистр и пробелы приводятся, чужое
-- значение становится other. Повторный прогон ничего не меняет.
update public.link_codes
   set channel = lower(btrim(channel))
 where channel is not null
   and channel <> lower(btrim(channel));

update public.link_codes
   set channel = 'other'
 where channel is not null
   and channel not in ('instagram', 'telegram', 'vk', 'offline', 'partner', 'other');

-- null разрешён: метка без канала попадает в «прочее», а не валит вставку.
alter table public.link_codes drop constraint if exists link_codes_channel_check;
alter table public.link_codes
  add constraint link_codes_channel_check
  check (channel is null or channel in ('instagram', 'telegram', 'vk', 'offline', 'partner', 'other'));

-- 7.3 profiles.cohort — определение из nika-analytics-spec.md, раздел 5. Колонки
-- в базе нет (аудит, п. 6); если её к моменту прогона завела Фаза 0, блок
-- ничего не трогает — ни колонку, ни её check.
do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'profiles'
       and column_name  = 'cohort'
  ) then
    alter table public.profiles
      add column cohort text
      constraint profiles_cohort_check
      check (cohort in ('beta_f', 'beta_m', 'organic', 'coffeerun', 'team'));
    comment on column public.profiles.cohort is
      'Когорта пользователя (nika-analytics-spec.md, раздел 5); team — аккаунт команды, исключается из статистики';
  end if;
end $$;

-- 7.4 Индексы под отчёты за период.
create index if not exists users_created_at_idx
  on public.users (created_at);
create index if not exists robokassa_payments_paid_at_idx
  on public.robokassa_payments (paid_at) where status = 'paid';
create index if not exists promo_tokens_redeemed_at_idx
  on public.promo_tokens (redeemed_at) where status = 'redeemed';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Функции отчётов
-- ─────────────────────────────────────────────────────────────────────────────
-- Общие правила (ТЗ, раздел 5):
--   • language sql stable security invoker, set search_path = public. Вызывает
--     только service_role (секция 9), он обходит RLS — поэтому invoker, а не
--     definer: у функции нет прав больше, чем у того, кто её зовёт.
--   • Периоды timestamptz — полуинтервал [p_from, p_to). Границы считает бот
--     (московская полночь); функции даты не угадывают.
--   • Везде, где есть связь с users, аккаунты с profiles.cohort = 'team'
--     исключены (databot_is_team). Пользователь без строки в profiles командой
--     не считается.
--   • Новых вьюх нет: вьюха выполняется с правами владельца и RLS не применяет.
--   • Приватность (раздел 8 ТЗ): тела функций не читают daily_state,
--     period_marks, rhythm_*, conversations.messages, заметки, personal_tips,
--     sprint_advice, цели и рефлексии спринтов, ответы чек-инов. У runs,
--     conversations, checkins берётся только время активности.
--
-- Сменить тип результата у функции через create or replace нельзя: если
-- понадобится, отдельная миграция делает drop function и создаёт заново.

-- 8.1 Аккаунт команды?
create or replace function public.databot_is_team(p_user uuid)
returns boolean
language sql stable security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.user_id = p_user and p.cohort = 'team'
  );
$$;

comment on function public.databot_is_team(uuid) is
  'true — аккаунт команды (profiles.cohort = team); без строки в profiles — false';

-- 8.2 Ключ человека (ТЗ 4.4): ник из tg_username; если пусто, а contact
-- начинается с «@», — ник из contact; иначе email. Всё в нижнем регистре, без
-- пробелов по краям и ведущего «@». Ни ника, ни email — null.
--
-- Префиксов «tg:»/«em:» нет, как в ТЗ: пересечься ник и email не могут — в
-- email всегда есть «@», а в нике Telegram его не бывает.
--
-- Известное ограничение (аудит, вопрос к Али): у одного человека в одной
-- заявке может быть ник, а в другой только email — тогда ключи разные и он
-- дважды «новый». Решение отложено до ответа Али; меняется только эта функция.
create or replace function public.databot_person_key(p_tg_username text, p_contact text, p_email text)
returns text
language sql immutable security invoker
set search_path = public
as $$
  select coalesce(
    nullif(lower(ltrim(btrim(p_tg_username), '@')), ''),
    case when btrim(p_contact) like '@%'
         then nullif(lower(ltrim(btrim(p_contact), '@')), '')
    end,
    nullif(lower(btrim(p_email)), '')
  );
$$;

comment on function public.databot_person_key(text, text, text) is
  'Ключ человека для «новых и повторных» (ТЗ 4.4): ник → @ник из contact → email; null, если нет ничего';

-- 8.3 Люди на забеге: сколько заявок, новые и повторные, по меткам.
-- «Новый» — у ключа нет заявок на забеги с более ранней датой, на любом споте.
-- Заявка без ключа (null) — новая: прошлых заявок у null не бывает. Поэтому
-- каждая заявка либо новая, либо повторная: new_people + returning_people = total.
-- by_link — по attr_last (ТЗ 4.6: «заявки по метке»); заявки без метки под
-- ключом "none" — у ключа jsonb не бывает null.
create or replace function public.databot_run_people(p_spot text, p_date date)
returns table (total bigint, new_people bigint, returning_people bigint, by_link jsonb)
language sql stable security invoker
set search_path = public
as $$
  with run as (
    select coalesce(cs.attr_last, 'none') as link,
           public.databot_person_key(cs.tg_username, cs.contact, cs.email) as pkey
      from public.coffee_run_signups cs
     where cs.spot = p_spot
       and cs.run_date = p_date
  ),
  flagged as (
    select r.link,
           (r.pkey is not null and exists (
              select 1
                from public.coffee_run_signups e
               where e.run_date < p_date
                 and public.databot_person_key(e.tg_username, e.contact, e.email) = r.pkey
           )) as is_returning
      from run r
  )
  select count(*)                                  as total,
         count(*) filter (where not f.is_returning) as new_people,
         count(*) filter (where f.is_returning)     as returning_people,
         coalesce(
           (select jsonb_object_agg(x.link, x.n)
              from (select link, count(*) as n from flagged group by link) x),
           '{}'::jsonb
         )                                          as by_link
    from flagged f;
$$;

comment on function public.databot_run_people(text, date) is
  'Заявки на забег: total, new_people, returning_people (в сумме total), by_link {код|none: n} по attr_last';

-- 8.4 Таблица забегов: строка на пару (spot, run_date), даты включительно с
-- обеих сторон. confirmed и reminded — ОДИН В ОДИН как в lib/team/stats.ts:
--   signupStatus:      reminded   ⇔ reminder_sent_at is not null;
--                      waiting    ⇔ confirmed_at и tg_chat_id заполнены (и не reminded);
--   summarizeSignups:  confirmed  = reminded + waiting.
-- Значит confirmed ⇔ reminder_sent_at is not null
--                    or (confirmed_at is not null and tg_chat_id is not null).
-- Заявка с confirmed_at, но без tg_chat_id подтверждённой НЕ считается —
-- бот до неё не дотянется, так же и в карточке.
-- new_people — то же определение, что в databot_run_people: первая дата ключа
-- не раньше даты забега (или ключа нет).
create or replace function public.databot_runs_table(p_from date, p_to date)
returns table (spot text, run_date date, total bigint, confirmed bigint, reminded bigint, new_people bigint)
language sql stable security invoker
set search_path = public
as $$
  with keyed as (
    select cs.spot, cs.run_date, cs.confirmed_at, cs.tg_chat_id, cs.reminder_sent_at,
           public.databot_person_key(cs.tg_username, cs.contact, cs.email) as pkey
      from public.coffee_run_signups cs
  ),
  first_run as (
    select k.pkey, min(k.run_date) as first_date
      from keyed k
     where k.pkey is not null
     group by k.pkey
  )
  select k.spot,
         k.run_date,
         count(*) as total,
         count(*) filter (
           where k.reminder_sent_at is not null
              or (k.confirmed_at is not null and k.tg_chat_id is not null)
         ) as confirmed,
         count(*) filter (where k.reminder_sent_at is not null) as reminded,
         count(*) filter (where k.pkey is null or fr.first_date >= k.run_date) as new_people
    from keyed k
    left join first_run fr on fr.pkey = k.pkey
   where k.run_date between p_from and p_to
   group by k.spot, k.run_date
   order by k.run_date desc, k.spot;
$$;

comment on function public.databot_runs_table(date, date) is
  'Забеги с p_from по p_to включительно: total, confirmed и reminded как в lib/team/stats.ts, new_people';

-- 8.5 Переходы по меткам (ТЗ 4.6). Строка на КАЖДУЮ метку, в том числе
-- неактивную и без переходов в периоде (с нулями): свод по каналам бот делает
-- сам, и метка не должна пропадать из отчёта только потому, что её выключили.
--   clicks            — строки link_clicks с is_bot = false в периоде;
--   visitors          — count(distinct coalesce(anon_id::text, ip_hash));
--   signups_coffeerun — заявки с attr_last = код и created_at в периоде;
--   signups_app       — user_attribution.last_source = код и signup_at в
--                       периоде, без аккаунтов команды.
create or replace function public.databot_traffic(p_from timestamptz, p_to timestamptz)
returns table (
  code text, label text, channel text,
  clicks bigint, visitors bigint, signups_coffeerun bigint, signups_app bigint
)
language sql stable security invoker
set search_path = public
as $$
  select lc.code,
         lc.label,
         lc.channel,
         coalesce(c.clicks, 0)   as clicks,
         coalesce(c.visitors, 0) as visitors,
         coalesce(cr.n, 0)       as signups_coffeerun,
         coalesce(ap.n, 0)       as signups_app
    from public.link_codes lc
    left join (
      select cl.code,
             count(*) as clicks,
             count(distinct coalesce(cl.anon_id::text, cl.ip_hash)) as visitors
        from public.link_clicks cl
       where cl.is_bot = false
         and cl.clicked_at >= p_from
         and cl.clicked_at <  p_to
       group by cl.code
    ) c on c.code = lc.code
    left join (
      select cs.attr_last as code, count(*) as n
        from public.coffee_run_signups cs
       where cs.attr_last is not null
         and cs.created_at >= p_from
         and cs.created_at <  p_to
       group by cs.attr_last
    ) cr on cr.code = lc.code
    left join (
      select ua.last_source as code, count(*) as n
        from public.user_attribution ua
       where ua.last_source is not null
         and ua.signup_at >= p_from
         and ua.signup_at <  p_to
         and not public.databot_is_team(ua.user_id)
       group by ua.last_source
    ) ap on ap.code = lc.code
   order by coalesce(c.clicks, 0) desc, lc.code;
$$;

comment on function public.databot_traffic(timestamptz, timestamptz) is
  'Метки за [p_from, p_to): clicks, visitors (без ботов), signups_coffeerun (attr_last), signups_app (last_source, без команды)';

-- 8.6 С какого момента пишутся переходы — для строки «Переходы считаются с дд.мм».
-- Первая строка вообще, включая ботов: вопрос «когда начали записывать», а не
-- «когда пришёл первый человек». null — не записано ни одной.
create or replace function public.databot_traffic_since()
returns timestamptz
language sql stable security invoker
set search_path = public
as $$
  select min(cl.clicked_at) from public.link_clicks cl;
$$;

comment on function public.databot_traffic_since() is
  'Время первой строки link_clicks; null — переходов ещё не записывали';

-- 8.7 Про и оплаты (ТЗ 4.7), без аккаунтов команды.
--
-- Категории «Про сейчас» не пересекаются, приоритет оплачено → по коду →
-- вручную, поэтому pro_paid + pro_promo + pro_manual = pro_now по построению.
--   Про сейчас — users.is_pro = true.
--   Активная подписка — status = 'active' и current_period_end > now().
--   Оплачено — активная подписка и одно из:
--     • source = 'payment' (начнёт писаться после Промта 11);
--     • source не 'promo' и есть платёж paid (ТЗ дословно);
--     • source = 'promo', но есть платёж paid ПОЗЖЕ погашения кода этой
--       подписки. Выбор сверх ТЗ: обработчик Robokassa source не перезаписывает
--       (аудит, п. 9), и оплативший после промокода иначе навсегда числился бы
--       «по коду».
--   По коду — активная подписка с source = 'promo' (и не «оплачено»).
--   Вручную — всё остальное среди Про.
--
-- Оплаты: robokassa_payments.status = 'paid', paid_at в периоде; сумма —
-- amount, это РУБЛИ (numeric(10,2), lib/robokassa.ts), перевода не нужно.
-- TODO(вопрос 8 ТЗ): признака тестового платежа в базе нет — все 17 платежей на
-- 27.09 по 1 ₽ (тариф pro). Пока Али не решит, как их отличать, тестовые
-- платежи считаются как настоящие.
--
-- Погашения: promo_tokens.status = 'redeemed', redeemed_at в периоде; подписи
-- кодов — из qr_codes. «Оплатили после кода» — ЛЮДИ (count distinct), у
-- которых есть платёж paid с paid_at > redeemed_at; v_qr_funnel считает то же
-- условие, но платежами, — здесь сознательно людьми.
-- expiring_7d — Про с активной подпиской, которая кончается в ближайшие 7 дней.
create or replace function public.databot_pro(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable security invoker
set search_path = public
as $$
  with pro as (
    select u.id
      from public.users u
     where u.is_pro = true
       and not public.databot_is_team(u.id)
  ),
  active_sub as (
    select s.user_id, s.source, s.promo_token, s.current_period_end
      from public.subscriptions s
     where s.status = 'active'
       and s.current_period_end > now()
  ),
  categorized as (
    select p.id,
           case
             when exists (
               select 1
                 from active_sub a
                where a.user_id = p.id
                  and (
                    a.source = 'payment'
                    or exists (
                      select 1
                        from public.robokassa_payments rp
                        left join public.promo_tokens pt on pt.token = a.promo_token
                       where rp.user_id = p.id
                         and rp.status = 'paid'
                         and (a.source is distinct from 'promo' or rp.paid_at > pt.redeemed_at)
                    )
                  )
             ) then 'paid'
             when exists (
               select 1 from active_sub a where a.user_id = p.id and a.source = 'promo'
             ) then 'promo'
             else 'manual'
           end as category
      from pro p
  ),
  payments as (
    select rp.plan, rp.amount
      from public.robokassa_payments rp
     where rp.status = 'paid'
       and rp.paid_at >= p_from
       and rp.paid_at <  p_to
       and not public.databot_is_team(rp.user_id)
  ),
  redeemed as (
    select pt.code, pt.redeemed_by, pt.redeemed_at
      from public.promo_tokens pt
     where pt.status = 'redeemed'
       and pt.redeemed_at >= p_from
       and pt.redeemed_at <  p_to
       and (pt.redeemed_by is null or not public.databot_is_team(pt.redeemed_by))
  )
  select jsonb_build_object(
    'pro_now',    (select count(*) from categorized),
    'pro_paid',   (select count(*) from categorized where category = 'paid'),
    'pro_promo',  (select count(*) from categorized where category = 'promo'),
    'pro_manual', (select count(*) from categorized where category = 'manual'),
    'payments_count', (select count(*) from payments),
    'payments_sum',   (select coalesce(sum(amount), 0) from payments),
    'payments_by_plan', coalesce(
      (select jsonb_object_agg(x.plan, jsonb_build_object('count', x.n, 'sum', x.total))
         from (select plan, count(*) as n, sum(amount) as total from payments group by plan) x),
      '{}'::jsonb
    ),
    'redeemed_by_code', coalesce(
      (select jsonb_agg(jsonb_build_object('code', x.code, 'label', qc.label, 'count', x.n)
                        order by x.n desc, x.code)
         from (select code, count(*) as n from redeemed group by code) x
         left join public.qr_codes qc on qc.code = x.code),
      '[]'::jsonb
    ),
    'redeemed_to_paid', (
      select count(distinct r.redeemed_by)
        from redeemed r
       where r.redeemed_by is not null
         and exists (
           select 1 from public.robokassa_payments rp
            where rp.user_id = r.redeemed_by
              and rp.status  = 'paid'
              and rp.paid_at > r.redeemed_at
         )
    ),
    'expiring_7d', (
      select count(distinct p.id)
        from pro p
        join active_sub a on a.user_id = p.id
       where a.current_period_end < now() + interval '7 days'
    )
  );
$$;

comment on function public.databot_pro(timestamptz, timestamptz) is
  'Про и оплаты за [p_from, p_to) без команды: категории Про (в сумме pro_now), оплаты Robokassa в рублях, погашения кодов';

-- 8.8 Продукт (ТЗ 4.8), без аккаунтов команды.
--   signups     — users.created_at в периоде;
--   onboarded   — из них profiles.gender is not null (то же правило, что
--                 isProfileComplete в lib/profile.ts);
--   tg_linked   — из них есть активная строка tg_bindings;
--   by_channel  — из них последнее касание user_attribution.last_source →
--                 link_codes.channel; нет касания — "none", касание не по
--                 метке или метка без канала — "other";
--   active_7d   — есть runs.created_at, conversations.updated_at или
--                 checkins.answered_at в [p_to − 7 дней; p_to). Считаются все
--                 пользователи, не только зарегистрированные в периоде;
--   sprints_*   — начато по created_at в периоде, активно сейчас по
--                 status = 'active', закрыто по closed_at в периоде;
--   nudge_*     — notifications_log с type = 'morning' и local_date в
--                 периоде (московские даты границ): отправлено — status =
--                 'sent', перешли — из отправленных clicked_at is not null.
--   nsm         — всегда null. SQL-функция не может ссылаться на таблицу,
--                 которой ещё нет, а user_day_facts появится в Фазе 0. Когда
--                 появится, эту функцию пересоздаст отдельная миграция.
create or replace function public.databot_product(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable security invoker
set search_path = public
as $$
  with signups as (
    select u.id
      from public.users u
     where u.created_at >= p_from
       and u.created_at <  p_to
       and not public.databot_is_team(u.id)
  ),
  active as (
    select a.user_id from (
      select r.user_id from public.runs r
       where r.created_at >= p_to - interval '7 days' and r.created_at < p_to
      union
      select c.user_id from public.conversations c
       where c.updated_at >= p_to - interval '7 days' and c.updated_at < p_to
      union
      select ch.user_id from public.checkins ch
       where ch.answered_at >= p_to - interval '7 days' and ch.answered_at < p_to
    ) a
    where not public.databot_is_team(a.user_id)
  ),
  nudges as (
    select n.status, n.clicked_at
      from public.notifications_log n
     where n.type = 'morning'
       and n.local_date >= (p_from at time zone 'Europe/Moscow')::date
       and n.local_date <  (p_to   at time zone 'Europe/Moscow')::date
       and not public.databot_is_team(n.user_id)
  )
  select jsonb_build_object(
    'signups',   (select count(*) from signups),
    'onboarded', (select count(*) from signups s
                   where exists (select 1 from public.profiles p
                                  where p.user_id = s.id and p.gender is not null)),
    'tg_linked', (select count(*) from signups s
                   where exists (select 1 from public.tg_bindings b
                                  where b.user_id = s.id and b.is_active = true)),
    'by_channel', coalesce(
      (select jsonb_object_agg(x.channel, x.n)
         from (
           select case
                    when ua.last_source is null then 'none'
                    else coalesce(lc.channel, 'other')
                  end as channel,
                  count(*) as n
             from signups s
             left join public.user_attribution ua on ua.user_id = s.id
             left join public.link_codes lc on lc.code = ua.last_source
            group by 1
         ) x),
      '{}'::jsonb
    ),
    'active_7d', (select count(*) from active),
    'sprints_started', (select count(*) from public.sprints sp
                         where sp.created_at >= p_from and sp.created_at < p_to
                           and not public.databot_is_team(sp.user_id)),
    'sprints_active',  (select count(*) from public.sprints sp
                         where sp.status = 'active'
                           and not public.databot_is_team(sp.user_id)),
    'sprints_closed',  (select count(*) from public.sprints sp
                         where sp.closed_at >= p_from and sp.closed_at < p_to
                           and not public.databot_is_team(sp.user_id)),
    'nudge_sent',    (select count(*) from nudges where status = 'sent'),
    'nudge_clicked', (select count(*) from nudges where status = 'sent' and clicked_at is not null),
    'nsm', null
  );
$$;

comment on function public.databot_product(timestamptz, timestamptz) is
  'Продукт за [p_from, p_to) без команды; nsm = null до user_day_facts (Фаза 0)';

-- 8.9 Список участников забега (Промт 6, ТЗ 4.4 «Список участников»).
-- Отдельная функция, а не select из coffee_run_signups в коде: список — самые
-- чувствительные данные бота, и телефона и email в нём не должно быть даже в
-- выборке. Функция отдаёт только то, что попадает в строку списка:
--   name, nick       — имя и ник без «@»: tg_username, а если он пуст и contact
--                      начинается с «@», — ник из contact (как в
--                      databot_person_key); телефон из contact не отдаётся;
--   pace, created_at — темп и время заявки (порядок внутри группы);
--   confirmed_at, reminder_sent_at, tg_linked — ровно то, что нужно
--                      signupStatus из lib/team/stats.ts; вместо tg_chat_id —
--                      только признак «чат есть», сам chat_id не отдаётся;
--   is_new           — «впервые»: то же определение, что new_people в
--                      databot_run_people.
create or replace function public.databot_run_roster(p_spot text, p_date date)
returns table (
  name text, nick text, pace text, created_at timestamptz,
  confirmed_at timestamptz, reminder_sent_at timestamptz, tg_linked boolean, is_new boolean
)
language sql stable security invoker
set search_path = public
as $$
  with run as (
    select cs.name, cs.tg_username, cs.contact, cs.pace, cs.created_at,
           cs.confirmed_at, cs.reminder_sent_at, cs.tg_chat_id,
           public.databot_person_key(cs.tg_username, cs.contact, cs.email) as pkey
      from public.coffee_run_signups cs
     where cs.spot = p_spot
       and cs.run_date = p_date
  )
  select r.name,
         coalesce(
           nullif(lower(ltrim(btrim(r.tg_username), '@')), ''),
           case when btrim(r.contact) like '@%'
                then nullif(lower(ltrim(btrim(r.contact), '@')), '')
           end
         ) as nick,
         r.pace,
         r.created_at,
         r.confirmed_at,
         r.reminder_sent_at,
         r.tg_chat_id is not null as tg_linked,
         not (r.pkey is not null and exists (
           select 1
             from public.coffee_run_signups e
            where e.run_date < p_date
              and public.databot_person_key(e.tg_username, e.contact, e.email) = r.pkey
         )) as is_new
    from run r
   order by r.created_at;
$$;

comment on function public.databot_run_roster(text, date) is
  'Список участников забега без телефона и email: имя, ник, темп, поля статуса, is_new';

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Права на функции
-- ─────────────────────────────────────────────────────────────────────────────
-- В Supabase функции схемы public по умолчанию может вызвать кто угодно через
-- /rest/v1/rpc — в том числе anon с публичным ключом из браузера. Здесь
-- выручка и активность, поэтому execute только у service_role.
revoke execute on function public.databot_is_team(uuid)                          from public, anon, authenticated;
revoke execute on function public.databot_person_key(text, text, text)           from public, anon, authenticated;
revoke execute on function public.databot_run_people(text, date)                 from public, anon, authenticated;
revoke execute on function public.databot_runs_table(date, date)                 from public, anon, authenticated;
revoke execute on function public.databot_traffic(timestamptz, timestamptz)      from public, anon, authenticated;
revoke execute on function public.databot_traffic_since()                        from public, anon, authenticated;
revoke execute on function public.databot_pro(timestamptz, timestamptz)          from public, anon, authenticated;
revoke execute on function public.databot_product(timestamptz, timestamptz)      from public, anon, authenticated;
revoke execute on function public.databot_run_roster(text, date)                 from public, anon, authenticated;

grant execute on function public.databot_is_team(uuid)                           to service_role;
grant execute on function public.databot_person_key(text, text, text)            to service_role;
grant execute on function public.databot_run_people(text, date)                  to service_role;
grant execute on function public.databot_runs_table(date, date)                  to service_role;
grant execute on function public.databot_traffic(timestamptz, timestamptz)       to service_role;
grant execute on function public.databot_traffic_since()                         to service_role;
grant execute on function public.databot_pro(timestamptz, timestamptz)           to service_role;
grant execute on function public.databot_product(timestamptz, timestamptz)       to service_role;
grant execute on function public.databot_run_roster(text, date)                  to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Гранты на таблицы
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase раздаёт anon и authenticated гранты на объекты public-схемы
-- автоматически. Здесь список тех, кто видит выручку, приглашения-пропуска и
-- журнал вопросов, — снимаем, как в 033–036. Держим в самом конце файла, чтобы
-- снятие шло после всех create.
revoke all on table public.databot_members   from anon, authenticated;
revoke all on table public.databot_invites   from anon, authenticated;
revoke all on table public.databot_audit     from anon, authenticated;
revoke all on table public.databot_kb        from anon, authenticated;
revoke all on table public.databot_run_plans from anon, authenticated;
