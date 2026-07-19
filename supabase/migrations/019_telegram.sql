-- 019_telegram.sql
-- Модель данных под Telegram-бота (раздел 7 ТЗ): токены связки, биндинги
-- user↔chat, чек-ины, настройки уведомлений. Плюс бэкофилл существующих
-- users.telegram_id в tg_bindings.
--
-- Идемпотентна: create table/index if not exists, drop policy if exists перед
-- create, бэкофилл через on conflict do nothing. Повторный прогон не падает.
--
-- РЕШЕНИЯ:
--   • opt-in (согласие на сообщения) живёт ТОЛЬКО в tg_bindings
--     (tg_opt_in / tg_opt_in_at) — согласие привязано к конкретному chat.
--     В notification_prefs этих полей НЕТ (не дублируем).
--   • Таймзоны/notif_channel в profiles нет → notification_prefs — отдельная
--     таблица.
--   • RLS: владельцу SELECT/UPDATE (роль authenticated), сервисной роли полный
--     доступ (to service_role). Политики scoped по ролям, без using(true) для всех.
--   • chat_id — bigint (Telegram id бывает большим).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. tg_link_tokens — одноразовые токены связки (читает только сервис)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.tg_link_tokens (
  id         uuid primary key default gen_random_uuid(),
  token      text not null unique,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);

create index if not exists tg_link_tokens_token_idx on public.tg_link_tokens (token);
create index if not exists tg_link_tokens_user_idx  on public.tg_link_tokens (user_id);

-- Перенос старой telegram_link_tokens, если она когда-либо была заведена.
-- На текущем проекте таблицы нет — блок не выполнится. Копируются стандартные
-- колонки (token/user_id/created_at/expires_at/used_at); если старая схема иная,
-- перенос надо будет адаптировать вручную.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'telegram_link_tokens'
  ) then
    insert into public.tg_link_tokens (id, token, user_id, created_at, expires_at, used_at)
    select id, token, user_id, created_at, expires_at, used_at
    from public.telegram_link_tokens
    on conflict (token) do nothing;

    drop table public.telegram_link_tokens;
    raise notice '019: telegram_link_tokens перенесена в tg_link_tokens и удалена';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. tg_bindings — связь 1:1 user↔chat (+ opt-in согласия)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.tg_bindings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  chat_id      bigint not null unique,
  tg_username  text,
  first_name   text,
  linked_at    timestamptz not null default now(),
  is_active    boolean not null default true,
  unlinked_at  timestamptz,
  unlink_reason text,
  tg_opt_in    boolean not null default false,
  tg_opt_in_at timestamptz
);

-- Одна активная связка на пользователя (partial unique). Неактивные (отвязанные)
-- строки остаются историей и под ограничение не попадают.
create unique index if not exists tg_bindings_user_active_uidx
  on public.tg_bindings (user_id) where is_active;

create index if not exists tg_bindings_chat_idx on public.tg_bindings (chat_id);
create index if not exists tg_bindings_user_idx on public.tg_bindings (user_id);

-- ── Бэкофилл существующих users.telegram_id → tg_bindings ─────────────────────
-- chat_id = telegram_id::bigint, is_active=true, tg_opt_in=false (согласие
-- соберём заново при следующем контакте). Нечисловые значения пропускаем и
-- считаем. users.telegram_id оставляем как зеркало (не трогаем).
do $$
declare
  v_inserted int := 0;
  v_skipped  int := 0;
  r record;
begin
  for r in
    select id, telegram_id from public.users where telegram_id is not null
  loop
    if r.telegram_id ~ '^-?[0-9]+$' then
      insert into public.tg_bindings (user_id, chat_id, is_active, tg_opt_in)
      values (r.id, r.telegram_id::bigint, true, false)
      on conflict (chat_id) do nothing;
      if found then
        v_inserted := v_inserted + 1;
      end if;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;
  raise notice '019: tg_bindings backfill — перенесено=%, пропущено(не число)=%', v_inserted, v_skipped;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. checkins — состояние деликатных чек-инов
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.checkins (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  asked_at         timestamptz not null default now(),
  question_variant text,
  answer           text check (answer in ('full','ok','tired','bad','skipped')),
  answered_at      timestamptz,
  source           text not null default 'telegram'
);

create index if not exists checkins_user_asked_idx on public.checkins (user_id, asked_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. notification_prefs — настройки уведомлений (БЕЗ opt-in: он в tg_bindings)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.notification_prefs (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  quiet_mode boolean not null default false,
  frequency  text not null default 'adaptive',
  timezone   text
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS + политики
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.tg_link_tokens    enable row level security;
alter table public.tg_bindings        enable row level security;
alter table public.checkins           enable row level security;
alter table public.notification_prefs enable row level security;

-- tg_link_tokens: доступ только сервисной роли (пользователю читать не нужно).
drop policy if exists "Service role manages tg_link_tokens" on public.tg_link_tokens;
create policy "Service role manages tg_link_tokens" on public.tg_link_tokens
  for all to service_role using (true) with check (true);

-- tg_bindings: владелец видит и обновляет свою связку; сервис — всё.
drop policy if exists "Users read own tg_bindings"   on public.tg_bindings;
drop policy if exists "Users update own tg_bindings" on public.tg_bindings;
drop policy if exists "Service role manages tg_bindings" on public.tg_bindings;
create policy "Users read own tg_bindings" on public.tg_bindings
  for select to authenticated using (auth.uid() = user_id);
create policy "Users update own tg_bindings" on public.tg_bindings
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Service role manages tg_bindings" on public.tg_bindings
  for all to service_role using (true) with check (true);

-- checkins: владелец видит и обновляет свои; сервис (бот/крон) — всё.
drop policy if exists "Users read own checkins"   on public.checkins;
drop policy if exists "Users update own checkins" on public.checkins;
drop policy if exists "Service role manages checkins" on public.checkins;
create policy "Users read own checkins" on public.checkins
  for select to authenticated using (auth.uid() = user_id);
create policy "Users update own checkins" on public.checkins
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Service role manages checkins" on public.checkins
  for all to service_role using (true) with check (true);

-- notification_prefs: владелец видит и обновляет свои; сервис — всё
-- (создание строки — на стороне сервиса/апсертом сервисным ключом).
drop policy if exists "Users read own notification_prefs"   on public.notification_prefs;
drop policy if exists "Users update own notification_prefs" on public.notification_prefs;
drop policy if exists "Service role manages notification_prefs" on public.notification_prefs;
create policy "Users read own notification_prefs" on public.notification_prefs
  for select to authenticated using (auth.uid() = user_id);
create policy "Users update own notification_prefs" on public.notification_prefs
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Service role manages notification_prefs" on public.notification_prefs
  for all to service_role using (true) with check (true);
