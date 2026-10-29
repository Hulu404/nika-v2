-- 069_club_yookassa.sql
-- Оплата занятий клуба напрямую через API ЮKassa (вместо счёта Telegram Payments).
--
-- Поток: форма на лендинге → заявка pending_payment с холдом мест на 20 минут
-- (hold_club_seats) → платёж ЮKassa (redirect) → человек платит и возвращается
-- на /paid?o=<confirm_token> → вебхук ЮKassa (источник правды) подтверждает
-- оплату: confirm_club_payment в транзакции проверяет вместимость; мест нет —
-- заявка refunded_overbooked, приложение делает возврат через API.
--
-- Статусы:
--   pending             — форма без оплаты (старый поток, до этой миграции);
--   pending_payment     — платёж создан, места держатся до hold_expires_at;
--   paid                — оплачено, места закреплены;
--   canceled            — платёж отменён (ЮKassa payment.canceled), места свободны;
--   expired             — холд истёк до оплаты, места свободны;
--   refunded_overbooked — оплата пришла, когда мест уже не было, деньги вернули;
--   refunded, waitlist  — как раньше.
--
-- Идемпотентна.

begin;

alter table public.club_signups
  drop constraint if exists club_signups_payment_status_check;
alter table public.club_signups
  add constraint club_signups_payment_status_check
  check (payment_status in (
    'pending', 'pending_payment', 'paid', 'refunded', 'waitlist',
    'canceled', 'expired', 'refunded_overbooked'
  ));

alter table public.club_signups
  add column if not exists hold_expires_at     timestamptz,
  add column if not exists payment_attempt     integer not null default 0,
  add column if not exists yk_payment_id       text,
  add column if not exists yk_confirmation_url text,
  add column if not exists refund_id           text,
  add column if not exists refunded_at         timestamptz;

comment on column public.club_signups.hold_expires_at is
  'До какого момента pending_payment держит места на занятии (20 минут с создания платежа)';
comment on column public.club_signups.payment_attempt is
  'Номер попытки оплаты: Idempotence-Key платежа ЮKassa = club-<id>-<attempt>';
comment on column public.club_signups.yk_payment_id is
  'id текущего платежа ЮKassa (API v3)';

create unique index if not exists club_signups_yk_payment
  on public.club_signups (yk_payment_id) where yk_payment_id is not null;
create index if not exists club_signups_active_holds
  on public.club_signups (hold_expires_at) where payment_status = 'pending_payment';

-- Занятые места занятия, кроме заявки except_id: оплаченные, активные холды
-- нового потока и резервы старых счетов Telegram (reserved_until).
create or replace function public.club_taken_seats(
  p_club text, p_date date, p_time text, except_id uuid
) returns bigint
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(quantity), 0) from public.club_signups
  where club = p_club and event_date = p_date and event_time = p_time
    and counts_seat and id is distinct from except_id
    and (payment_status = 'paid'
      or (payment_status = 'pending_payment' and hold_expires_at > now())
      or (payment_status = 'pending' and reserved_until > now()));
$$;

-- Холд мест под новую попытку оплаты. Блокировка на занятие сериализует
-- проверки разных покупателей. Результат: held | no_seats | bad_status | not_found.
create or replace function public.hold_club_seats(
  signup_id uuid, session_capacity integer, hold_minutes integer
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  booking public.club_signups%rowtype;
begin
  select * into booking from public.club_signups where id = signup_id;
  if not found then return 'not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    booking.club || ':' || booking.event_date::text || ':' || booking.event_time, 0));
  select * into booking from public.club_signups where id = signup_id for update;
  if booking.payment_status not in ('pending', 'pending_payment', 'canceled', 'expired') then
    return 'bad_status';
  end if;
  if session_capacity is null or session_capacity < 1 or hold_minutes not between 1 and 60 then
    return 'bad_status';
  end if;
  if booking.counts_seat and public.club_taken_seats(
       booking.club, booking.event_date, booking.event_time, booking.id) + booking.quantity > session_capacity then
    return 'no_seats';
  end if;
  update public.club_signups set
    payment_status = 'pending_payment',
    hold_expires_at = now() + make_interval(mins => hold_minutes),
    payment_attempt = payment_attempt + 1,
    yk_payment_id = null,
    yk_confirmation_url = null,
    updated_at = now()
  where id = booking.id;
  return 'held';
end;
$$;

-- Подтверждение успешного платежа ЮKassa (уже проверенного запросом к API).
-- Результат:
--   paid         — заявка стала оплаченной этим вызовом;
--   already_paid — уже оплачена этим же платежом (повтор вебхука);
--   duplicate    — заявка оплачена ДРУГИМ платежом: этот вернуть;
--   overbooked   — мест нет: заявка refunded_overbooked, платёж вернуть
--                  (повторяется, пока приложение не запишет refund_id);
--   refunded     — возврат уже записан;
--   amount_mismatch | not_found | bad_status — разобрать руками.
create or replace function public.confirm_club_payment(
  signup_id uuid, payment_id text, paid_kopecks integer, session_capacity integer
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  booking public.club_signups%rowtype;
  own_hold boolean;
begin
  select * into booking from public.club_signups where id = signup_id;
  if not found then return 'not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    booking.club || ':' || booking.event_date::text || ':' || booking.event_time, 0));
  select * into booking from public.club_signups where id = signup_id for update;

  if booking.payment_status = 'paid' then
    return case when booking.yk_payment_id = payment_id then 'already_paid' else 'duplicate' end;
  end if;
  if booking.payment_status = 'refunded_overbooked' and booking.yk_payment_id = payment_id then
    return case when booking.refund_id is null then 'overbooked' else 'refunded' end;
  end if;
  if booking.payment_status in ('refunded', 'refunded_overbooked') then return 'duplicate'; end if;
  if booking.amount_rub * 100 <> paid_kopecks then return 'amount_mismatch'; end if;
  if booking.payment_status not in ('pending', 'pending_payment', 'canceled', 'expired', 'waitlist') then
    return 'bad_status';
  end if;

  -- Свой активный холд под этим платежом — места уже за ним.
  own_hold := booking.payment_status = 'pending_payment'
    and booking.hold_expires_at > now()
    and booking.yk_payment_id = payment_id;
  if not own_hold and booking.counts_seat and public.club_taken_seats(
       booking.club, booking.event_date, booking.event_time, booking.id) + booking.quantity > session_capacity then
    update public.club_signups set
      payment_status = 'refunded_overbooked', yk_payment_id = payment_id,
      hold_expires_at = null, updated_at = now()
    where id = booking.id;
    return 'overbooked';
  end if;

  update public.club_signups set
    payment_status = 'paid', paid_at = now(), yk_payment_id = payment_id,
    hold_expires_at = null, updated_at = now()
  where id = booking.id;
  return 'paid';
end;
$$;

-- Старый счёт Telegram (фоллбэк для счетов, отправленных до этой миграции):
-- резерв учитывает и холды нового потока, иначе продал бы место дважды.
create or replace function public.reserve_club_tickets(
  signup_id uuid, expected_amount integer, session_capacity integer
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  booking public.club_signups%rowtype;
begin
  select * into booking from public.club_signups where id = signup_id;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    booking.club || ':' || booking.event_date::text || ':' || booking.event_time, 0));
  select * into booking from public.club_signups where id = signup_id for update;
  if not found then return false; end if;
  if booking.payment_status <> 'pending' or booking.amount_rub * 100 <> expected_amount
    or booking.event_date < (now() at time zone 'Europe/Moscow')::date
    or expected_amount is null or session_capacity is null
    or session_capacity not between 1 and 16 then
    return false;
  end if;
  if booking.reserved_until > now() then return false; end if;
  if booking.counts_seat and public.club_taken_seats(
       booking.club, booking.event_date, booking.event_time, booking.id) + booking.quantity > session_capacity then
    return false;
  end if;
  update public.club_signups set reserved_until = now() + interval '15 minutes'
    where id = booking.id;
  return true;
end;
$$;

revoke all on function public.club_taken_seats(text, date, text, uuid) from public, anon, authenticated;
revoke all on function public.hold_club_seats(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.confirm_club_payment(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.reserve_club_tickets(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.club_taken_seats(text, date, text, uuid) to service_role;
grant execute on function public.hold_club_seats(uuid, integer, integer) to service_role;
grant execute on function public.confirm_club_payment(uuid, text, integer, integer) to service_role;
grant execute on function public.reserve_club_tickets(uuid, integer, integer) to service_role;

commit;
