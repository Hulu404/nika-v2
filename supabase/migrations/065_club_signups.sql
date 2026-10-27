-- 065_club_signups.sql
-- Заявки на занятия клубов NIKA (первый — /stretch, пилатес 1 ноября).
--
-- Отдельная таблица, а не coffee_run_signups: у занятия своя анкета (уровень,
-- коврик, полотенце, вода) и, главное, оплата. Кофе-ран бесплатный, занятие —
-- нет, и coffee_run_signups не должна обрастать платёжными столбцами.
--
-- Поток: лендинг → POST /api/club-signup (строка, payment_status = 'pending')
-- → кнопка «Оплатить в Telegram» (t.me/<bot>?start=st_<confirm_token>)
-- → бот присылает счёт ЮKassa (Telegram Payments) → successful_payment
-- → payment_status = 'paid', paid_at и id платежа. Коврик закрепляется только
-- после оплаты.
--
-- RLS: включена, клиентам ничего не видно. Пишут только API-роут и бот
-- (service_role минует RLS).
-- Идемпотентна: if not exists.

create table if not exists public.club_signups (
  id            uuid        primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- какое занятие: клуб + формат + место + дата/время (см. lib/clubs/sessions.ts)
  club          text        not null,               -- 'stretch'
  format        text        not null,               -- 'pilates'
  spot          text        not null,               -- 'klimashkina'
  event_date    date        not null,
  event_time    text        not null,               -- '10:30', МСК
  source        text        not null,               -- с какой страницы пришла заявка

  -- анкета
  name          text        not null,
  tg_username   text        not null,               -- канон без @, нижний регистр
  email         text        not null,
  level         text        not null check (level in ('first', 'sometimes', 'regular')),
  mat           text        not null check (mat in ('own', 'studio')),
  towel         boolean     not null,
  water         boolean     not null,
  consent_at    timestamptz not null,

  -- Telegram: токен deep-link и чат, из которого человек открыл бота
  confirm_token text        not null unique,
  tg_chat_id    bigint,
  confirmed_at  timestamptz,                        -- первый вход в бота по заявке

  -- оплата (ЮKassa через Telegram Payments)
  payment_status text       not null default 'pending'
                 check (payment_status in ('pending', 'paid', 'refunded')),
  amount_rub    integer     not null check (amount_rub > 0),  -- цена на момент заявки
  paid_at       timestamptz,
  tg_payment_charge_id       text unique,           -- telegram_payment_charge_id
  provider_payment_charge_id text                   -- id платежа в ЮKassa
);

comment on table public.club_signups is
  'Заявки на занятия клубов NIKA (/stretch и следующие). Оплата — счёт ЮKassa в Telegram-боте мероприятий';
comment on column public.club_signups.payment_status is
  'pending — заявка без оплаты; paid — оплачено, коврик закреплён; refunded — деньги вернули';
comment on column public.club_signups.amount_rub is
  'Сумма счёта в рублях, зафиксированная при заявке. Сверяется в pre_checkout_query';

-- Один человек — одна заявка на занятие: повторная форма обновляет её.
create unique index if not exists club_signups_person_session
  on public.club_signups (club, event_date, event_time, tg_username);

-- Списки занятия и подсчёт оплаченных мест.
create index if not exists club_signups_session_status
  on public.club_signups (club, event_date, payment_status);

alter table public.club_signups enable row level security;

drop policy if exists "no client access" on public.club_signups;
create policy "no client access"
  on public.club_signups
  for all
  using (false)
  with check (false);
