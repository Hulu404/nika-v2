-- 033_analytics_events.sql
-- Фундамент собственной аналитики: единый сток событий (analytics_events),
-- справочник ссылок /s/<КОД> (link_codes), журнал переходов по ним
-- (link_clicks) и склейка «человек ↔ источник» (user_attribution).
-- Плюс починка вью v_qr_funnel из 025_qr_promo.sql — см. секцию 1.
--
-- ДОСТУП: всё пишет и читает ТОЛЬКО service_role. RLS включён, политик нет
-- (service_role обходит RLS), а в секции 7 с новых таблиц и с обеих
-- аналитических вьюх снимаются гранты anon/authenticated, которые Supabase
-- выдаёт объектам public-схемы автоматически. Для вьюх это принципиально:
-- вью исполняется с правами владельца и RLS нижележащих таблиц не применяет,
-- поэтому грант анониму = публичная выгрузка (v_coffeerun_promo отдаёт email).
--
-- ПРИВАТНОСТЬ (152-ФЗ, как в lib/track-server.ts): в analytics_events.props
-- кладём только структурные значения — enum'ы, бакеты, флаги, счётчики.
-- Ни сырого IP, ни email, ни имён, ни текстов сообщений. В link_clicks вместо
-- IP хранится ip_hash (sha256 + соль), тем же способом, что в qr_scans.
--
-- Идемпотентна: create table/index if not exists, create or replace view/function,
-- insert ... on conflict do nothing, revoke — повторяемая операция.
-- Прогон дважды подряд проходит без ошибок.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Починка v_qr_funnel (баг из 025_qr_promo.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- В 025 последняя строка select'а — `count(sub2.id) as converted_to_paid`, где
-- sub2 = public.robokassa_payments. Колонки id там нет: первичный ключ таблицы —
-- `inv_id bigint generated always as identity` (012_robokassa.sql), потому что
-- Robokassa требует целочисленный InvId. В таком виде вью не создаётся —
-- Postgres падает с 42703 «column sub2.id does not exist».
--
-- 025 не редактируем: она уже применена (в проде вью существует и отдаёт
-- данные — значит, её создавали в обход миграции). Исправление живёт здесь.
--
-- create or replace сохраняет гранты и не требует пересоздания зависимостей;
-- список колонок, их порядок и типы совпадают с текущей вью один в один
-- (11 колонок, converted_to_paid как был bigint, так и остаётся — count()
-- возвращает bigint независимо от аргумента), поэтому replace проходит.
create or replace view public.v_qr_funnel as
select
  s.code,
  qc.label,
  date_trunc('day', s.scanned_at at time zone 'Europe/Moscow') as day,
  count(*)                                                       as scans,
  count(distinct s.ip_hash)                                      as unique_ips,
  count(pt.token)                                                as tokens_issued,
  count(pt.token) filter (where pt.status in ('clicked','redeemed','expired')) as clicks,
  count(pt.token) filter (where pt.status = 'redeemed')         as redeemed,
  count(sub.id)   filter (where sub.status = 'active'
                             and sub.current_period_end > now()) as promo_active,
  count(pt.token) filter (where pt.status = 'expired'
                            or (pt.status = 'redeemed'
                                and sub.current_period_end < now())) as promo_expired,
  -- купили платный Pro после окончания промо
  -- ИСПРАВЛЕНО: было count(sub2.id) — такой колонки у robokassa_payments нет
  count(sub2.inv_id)                                             as converted_to_paid
from public.qr_scans s
join public.qr_codes  qc on qc.code = s.code
left join public.promo_tokens pt  on pt.scan_id = s.id
left join public.subscriptions sub on sub.promo_token = pt.token
-- конверсия: есть платная оплата созданная позже промо
left join public.robokassa_payments sub2
       on sub2.user_id = pt.redeemed_by
      and sub2.status  = 'paid'
      and sub2.paid_at > pt.redeemed_at
group by s.code, qc.label, date_trunc('day', s.scanned_at at time zone 'Europe/Moscow');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. analytics_events — единый сток событий
-- ─────────────────────────────────────────────────────────────────────────────
-- Одна строка = одно событие продукта, откуда бы оно ни пришло: браузер
-- (/api/track), бот, крон или серверный роут. Схема нарочно широкая и плоская:
-- атрибуция (source/first_source), контекст (path/platform/ua_*) и полезная
-- нагрузка (props) лежат рядом, чтобы воронка считалась одним запросом без
-- джойнов по пяти таблицам.
create table if not exists public.analytics_events (
  id           bigint      generated always as identity primary key,
  event        text        not null,
  occurred_at  timestamptz not null default now(),
  anon_id      uuid,                    -- устройство, из cookie nika_aid
  user_id      uuid        references public.users (id) on delete set null,
  session_id   text,                    -- вкладка/сессия, короткий id
  source       text,                    -- код ссылки последнего касания (nika_attr_last)
  first_source text,                    -- код ссылки первого касания (nika_attr_first)
  path         text,                    -- маршрут без query
  props        jsonb       not null default '{}',
  platform     text        check (platform in ('web', 'telegram', 'server')),
  ua_browser   text,                    -- 'instagram' | 'telegram' | 'safari' | 'chrome' | ...
  ua_device    text        check (ua_device in ('mobile', 'tablet', 'desktop', 'bot', 'unknown')),
  is_bot       boolean     not null default false
);

comment on table public.analytics_events is
  'Сток продуктовых событий. Только структурные значения — PII в props не кладём (152-ФЗ)';
comment on column public.analytics_events.anon_id is
  'Идентификатор устройства из cookie nika_aid. Живёт до регистрации; после — склеивается через attach_anon_to_user()';
comment on column public.analytics_events.user_id is
  'on delete set null, а не cascade: удаление аккаунта не должно выбивать дыру в исторической воронке';

-- Основной индекс отчётов: «событие X за период», свежие сверху.
create index if not exists analytics_events_event_idx
  on public.analytics_events (event, occurred_at desc);

-- Путь одного человека и одного устройства во времени.
create index if not exists analytics_events_user_idx
  on public.analytics_events (user_id, occurred_at);

create index if not exists analytics_events_anon_idx
  on public.analytics_events (anon_id, occurred_at);

-- Разрез по источнику: сколько дала каждая ссылка.
create index if not exists analytics_events_source_idx
  on public.analytics_events (source, occurred_at);

-- Голый occurred_at — под ретеншн и выборки «всё за сутки» без фильтра по событию.
create index if not exists analytics_events_occurred_at_idx
  on public.analytics_events (occurred_at);

alter table public.analytics_events enable row level security;

-- Политик нет: приём событий идёт через /api/track сервисной ролью, чтение —
-- в админке. Клиенту с anon/authenticated ключом таблица недоступна.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. link_codes — справочник ссылок /s/<КОД>
-- ─────────────────────────────────────────────────────────────────────────────
-- Надстройка над qr_codes, а не замена: qr_codes отвечает за промо-квоты
-- (quota/grant_days) и трогать её не будем. link_codes отвечает за атрибуцию —
-- куда ведёт ссылка и в какой канал её положили. Коды, которые ещё и раздают
-- Pro, помечены grants_promo = true и уходят по старому пути через /activate.
create table if not exists public.link_codes (
  code          text        primary key
                            -- До 12 символов, латиница/цифры/дефис, верхний
                            -- регистр: код печатают на стакане и диктуют вслух.
                            constraint link_codes_code_format
                            check (code ~ '^[A-Z0-9-]{1,12}$'),
  label         text        not null,
  destination   text        not null default '/',
  channel       text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_content   text,
  owner_user_id uuid        references public.users (id),  -- задел под рефералы, пока null
  grants_promo  boolean     not null default false,        -- true → путь как раньше, через /activate
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now()
);

comment on table public.link_codes is
  'Справочник ссылок /s/<КОД> для атрибуции. Промо-квоты живут отдельно, в qr_codes';
comment on column public.link_codes.grants_promo is
  'true → код ещё и выдаёт Pro: /s/<КОД> ведёт на /activate, как в 025_qr_promo.sql. false → простая атрибуция, редирект на destination';
comment on column public.link_codes.owner_user_id is
  'Владелец ссылки — задел под реферальные коды. Пока везде null';

create index if not exists link_codes_is_active_idx
  on public.link_codes (is_active);

alter table public.link_codes enable row level security;

-- Стартовые коды. Все ведут на «/» и Pro не раздают — это чистая атрибуция
-- входящего трафика. Промо-коды (SC1/SC2/SURF21/DIRECT) остаются в qr_codes.
insert into public.link_codes (code, label, destination, channel, utm_source, utm_medium, utm_campaign, grants_promo) values
  ('IGBIO',  'Instagram — ссылка в шапке профиля', '/', 'instagram', 'instagram', 'social',  'bio',        false),
  ('IGST',   'Instagram — сторис',                 '/', 'instagram', 'instagram', 'social',  'stories',    false),
  ('TGPIN',  'Telegram — закреп в канале',         '/', 'telegram',  'telegram',  'social',  'pinned',     false),
  ('CRLUZH', 'Кофе-ран в Лужниках',                '/', 'offline',   'coffeerun', 'offline', 'luzhniki',   false),
  ('SCLUZH', 'Стакан Surf Coffee (Лужники)',       '/', 'offline',   'surfcoffee','offline', 'luzhniki',   false)
on conflict (code) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. link_clicks — каждый переход по /s/<КОД>
-- ─────────────────────────────────────────────────────────────────────────────
-- Аналог qr_scans, но для атрибуционных ссылок: сырой IP не храним, только
-- солёный хеш. anon_id пишется тем же значением, что уедет в cookie nika_aid,
-- поэтому переход и последующие события одного устройства сходятся.
create table if not exists public.link_clicks (
  id         uuid        primary key default gen_random_uuid(),
  code       text        not null references public.link_codes (code),
  clicked_at timestamptz not null default now(),
  anon_id    uuid,
  ip_hash    text,
  user_agent text,
  referer    text,
  ua_browser text,
  ua_device  text,
  is_bot     boolean     not null default false
);

comment on table public.link_clicks is
  'Переходы по /s/<КОД>. Сырой IP не хранится — только ip_hash (sha256 + IP_HASH_SALT), как в qr_scans';

create index if not exists link_clicks_code_idx
  on public.link_clicks (code, clicked_at);

create index if not exists link_clicks_anon_idx
  on public.link_clicks (anon_id);

alter table public.link_clicks enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. user_attribution — склейка «человек ↔ источник»
-- ─────────────────────────────────────────────────────────────────────────────
-- Одна строка на пользователя: чем его привели впервые и по какой ссылке он
-- пришёл в последний раз перед регистрацией. Первое касание отвечает на вопрос
-- «какой канал работает», последнее — «что сработало в моменте»; они часто
-- разные, поэтому храним оба, а не переписываем одно поле.
create table if not exists public.user_attribution (
  user_id       uuid        primary key references public.users (id) on delete cascade,
  first_source  text,
  first_seen_at timestamptz,
  last_source   text,
  last_seen_at  timestamptz,
  anon_id       uuid,
  signup_at     timestamptz not null default now()
);

comment on table public.user_attribution is
  'Одна строка на пользователя: первое и последнее касание перед регистрацией';

create index if not exists user_attribution_first_source_idx
  on public.user_attribution (first_source);

create index if not exists user_attribution_last_source_idx
  on public.user_attribution (last_source);

alter table public.user_attribution enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. attach_anon_to_user — склейка событий, случившихся до регистрации
-- ─────────────────────────────────────────────────────────────────────────────
-- Человек ходит по сайту анонимно (есть только anon_id), а user_id появляется
-- лишь в момент регистрации. Без этой функции весь верх воронки — просмотры
-- лендинга, клики CTA — остаётся бесхозным, и конверсия «источник → аккаунт»
-- не считается вообще. Функция задним числом проставляет владельца событиям
-- устройства.
--
-- Переписываем только строки с user_id is null: если событие уже привязано
-- (человек вошёл со второго устройства, anon_id переиспользован), чужого
-- владельца не затираем.
create or replace function public.attach_anon_to_user(
  p_anon_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Нечего склеивать — тихо выходим: вызов из auth-колбэка не должен падать
  -- из-за отсутствующей cookie.
  if p_anon_id is null or p_user_id is null then
    return;
  end if;

  update analytics_events
     set user_id = p_user_id
   where anon_id = p_anon_id
     and user_id is null;
end;
$$;

-- Доступ только service_role: функция переписывает владельца событий, дать её
-- залогиненному пользователю — значит разрешить присвоить чужую сессию.
revoke all on function public.attach_anon_to_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.attach_anon_to_user(uuid, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Права: снимаем дефолтные гранты anon/authenticated
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase выдаёт anon и authenticated гранты на объекты public-схемы по
-- умолчанию (alter default privileges), поэтому свежесозданные таблицы выше
-- уже доступны публичному ключу. RLS их прикрывает, но полагаться только на
-- него не будем — аналитика целиком серверная, клиенту здесь делать нечего.
revoke all on table public.analytics_events,
                    public.link_codes,
                    public.link_clicks,
                    public.user_attribution
  from anon, authenticated;

-- Вьюхи — отдельный и более острый случай: они исполняются с правами владельца
-- и RLS нижележащих таблиц НЕ применяют. Грант анониму означает публичную
-- выгрузку в обход всех политик. v_coffeerun_promo отдаёт email, имя и контакт
-- участников кофе-ранов — она не должна быть доступна анонимам ни при каких
-- условиях. Секция стоит последней: create or replace view из секции 1 гранты
-- сохраняет, поэтому revoke обязан идти после него.
revoke all on table public.v_qr_funnel,
                    public.v_coffeerun_promo
  from anon, authenticated;
