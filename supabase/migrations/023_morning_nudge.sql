-- 023_morning_nudge.sql
-- Модель данных под раздел 5 ТЗ: утренний pure-push нудж в Telegram
-- (одно сообщение + одна URL-кнопка). Три части:
--   1) notification_prefs — недостающие поля утреннего нуджа;
--   2) notifications_log — НОВАЯ таблица журнала нуджей (НЕ notification_log
--      web-push крона — та не трогается);
--   3) checkins — source по умолчанию 'app' для in-app чек-инов + индекс дедупа
--      по локальной дате.
--
-- Идемпотентна: add column if not exists / create table if not exists /
-- create index if not exists / drop policy if exists перед create. Повторный
-- прогон не падает, применяется и на чистой, и на текущей БД.
--
-- РЕШЕНИЯ:
--   • timezone НЕ дублируем — он уже живёт в notification_prefs.timezone
--     (в profiles его нет), см. миграцию 019. Здесь только новые поля нуджа.
--   • Идемпотентность отправки — UNIQUE (user_id, type, local_date):
--     один нудж на пользователя в сутки (слот-инсерт, Промт 4).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. notification_prefs — поля утреннего нуджа
-- ─────────────────────────────────────────────────────────────────────────────
-- timezone уже есть (019) — не добавляем. quiet_hours опционально: {start,end}.
alter table public.notification_prefs
  add column if not exists morning_enabled boolean not null default true;
alter table public.notification_prefs
  add column if not exists morning_time time not null default '08:00';
alter table public.notification_prefs
  add column if not exists pause_until date;               -- null = не на паузе
alter table public.notification_prefs
  add column if not exists quiet_hours jsonb;               -- {start,end} | null

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. notifications_log — журнал утренних нуджей (НОВАЯ таблица)
-- ─────────────────────────────────────────────────────────────────────────────
-- Отдельная от notification_log (web-push крон): у той другое назначение и
-- схема, её не переиспользуем. Здесь — идемпотентность отправки + атрибуция клика.
create table if not exists public.notifications_log (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  type             text not null default 'morning',        -- пока только 'morning'
  local_date       date not null,                          -- локальная дата пользователя
  question_variant text,                                    -- какая формулировка ушла (ротация)
  sent_at          timestamptz,
  status           text not null
                     check (status in ('sent','failed','skipped_dedup','skipped_prefs')),
  error            text,
  clicked_at       timestamptz                             -- заход с src=tg_morning
);

-- Гарант идемпотентности: один слот (user_id, type, local_date) — одна запись.
create unique index if not exists notifications_log_user_type_date_uidx
  on public.notifications_log (user_id, type, local_date);

-- ── RLS: владелец читает свой лог; пишет/обновляет только сервисная роль ──────
alter table public.notifications_log enable row level security;

drop policy if exists "Users read own notifications_log" on public.notifications_log;
create policy "Users read own notifications_log" on public.notifications_log
  for select to authenticated using (auth.uid() = user_id);

-- INSERT/UPDATE — только сервисной роли (крон и роут атрибуции ходят
-- сервисным ключом). Для authenticated write-политик нет → запись запрещена.
drop policy if exists "Service role manages notifications_log" on public.notifications_log;
create policy "Service role manages notifications_log" on public.notifications_log
  for all to service_role using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. checkins — source по умолчанию 'app' + индекс дедупа по дате
-- ─────────────────────────────────────────────────────────────────────────────
-- Колонка source уже есть (019, default был 'telegram'). Для нового in-app
-- утреннего чек-ина источник = 'app', поэтому меняем дефолт. Бот пишет source
-- явно ('telegram'), так что смена дефолта его не задевает.
alter table public.checkins alter column source set default 'app';

-- Быстрый дедуп «есть ли чек-ин за сегодня» по локальной дате. asked_at —
-- timestamptz; фиксируем зону явно (AT TIME ZONE 'UTC' immutable), чтобы
-- выражение годилось для индекса.
create index if not exists checkins_user_local_date_idx
  on public.checkins (user_id, ((asked_at at time zone 'UTC')::date));
