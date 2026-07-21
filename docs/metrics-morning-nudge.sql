-- metrics-morning-nudge.sql
-- Метрики петли «нудж → клик → чек-ин» (раздел 11 ТЗ, эпик 3).
-- НЕ миграция: готовые запросы/вьюхи для ручной выгрузки (SQL Editor Supabase).
-- Источники: notifications_log (Промт 1/4/5/7), checkins, notification_prefs.
--
-- ⚠️ Конверсия читает checkins с source='app'. In-app чек-ин пока пишет в
-- rhythm_checkins, а не в checkins — до реконсиляции (см. заметки эпика)
-- метрика #2 будет 0. Метрика #1 (open-rate) работает сразу.

-- ─────────────────────────────────────────────────────────────────────────────
-- Метрика 1: open-rate нуджа = clicked / sent
-- ─────────────────────────────────────────────────────────────────────────────
-- Разовый запрос:
select
  count(*) filter (where status = 'sent')                       as sent,
  count(*) filter (where status = 'sent' and clicked_at is not null) as clicked,
  round(
    count(*) filter (where status = 'sent' and clicked_at is not null)::numeric
    / nullif(count(*) filter (where status = 'sent'), 0),
    4
  ) as open_rate
from public.notifications_log
where type = 'morning';

-- Вьюха (по дням, для тренда):
create or replace view public.v_morning_open_rate as
select
  local_date,
  count(*) filter (where status = 'sent')                       as sent,
  count(*) filter (where status = 'sent' and clicked_at is not null) as clicked,
  round(
    count(*) filter (where status = 'sent' and clicked_at is not null)::numeric
    / nullif(count(*) filter (where status = 'sent'), 0),
    4
  ) as open_rate
from public.notifications_log
where type = 'morning'
group by local_date
order by local_date desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- Метрика 2: конверсия клик → чек-ин в тот же локальный день
-- Доля кликнувших, кто сделал in-app чек-ин (source='app') после клика в тот же
-- локальный день. Локальную дату чек-ина считаем в tz пользователя.
-- ─────────────────────────────────────────────────────────────────────────────
with clicked as (
  select
    nl.user_id,
    nl.local_date,
    nl.clicked_at,
    coalesce(np.timezone, 'Europe/Moscow') as tz
  from public.notifications_log nl
  left join public.notification_prefs np on np.user_id = nl.user_id
  where nl.type = 'morning' and nl.clicked_at is not null
),
converted as (
  select distinct c.user_id, c.local_date
  from clicked c
  join public.checkins ck
    on ck.user_id = c.user_id
   and ck.source = 'app'
   and ck.asked_at >= c.clicked_at
   and (ck.asked_at at time zone c.tz)::date = c.local_date
)
select
  (select count(*) from clicked)                                          as clicks,
  (select count(*) from converted)                                        as conversions,
  round((select count(*) from converted)::numeric
        / nullif((select count(*) from clicked), 0), 4)                   as checkin_conversion;

-- Вьюха варианта конверсии (для повторной выгрузки):
create or replace view public.v_morning_checkin_conversion as
with clicked as (
  select nl.user_id, nl.local_date, nl.clicked_at,
         coalesce(np.timezone, 'Europe/Moscow') as tz
  from public.notifications_log nl
  left join public.notification_prefs np on np.user_id = nl.user_id
  where nl.type = 'morning' and nl.clicked_at is not null
),
converted as (
  select distinct c.user_id, c.local_date
  from clicked c
  join public.checkins ck
    on ck.user_id = c.user_id
   and ck.source = 'app'
   and ck.asked_at >= c.clicked_at
   and (ck.asked_at at time zone c.tz)::date = c.local_date
)
select
  (select count(*) from clicked)   as clicks,
  (select count(*) from converted) as conversions,
  round((select count(*) from converted)::numeric
        / nullif((select count(*) from clicked), 0), 4) as checkin_conversion;
