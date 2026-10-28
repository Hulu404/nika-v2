-- Один заказ может содержать несколько билетов, в том числе в подарок.
-- Применить перед выкладкой API, лендинга и бота.
begin;

alter table public.club_signups
  add column if not exists quantity integer not null default 1 check (quantity between 1 and 16),
  add column if not exists is_gift boolean not null default false,
  add column if not exists gift_recipient text check (
    not is_gift or (gift_recipient is not null and char_length(trim(gift_recipient)) between 2 and 200)
  ),
  add column if not exists reserved_until timestamptz;

-- Покупатель подарка может не знать предпочтения получателя.
alter table public.club_signups
  alter column level drop not null,
  alter column mat drop not null,
  alter column towel drop not null,
  alter column water drop not null;

drop index if exists public.club_signups_person_session;
create index if not exists club_signups_buyer_session
  on public.club_signups (club, event_date, event_time, tg_username);

-- Блокировка на занятие сериализует pre_checkout разных покупателей.
-- Брошенная форма место не держит; одобренный платёж держит его 15 минут.
create or replace function public.reserve_club_tickets(
  signup_id uuid, expected_amount integer, session_capacity integer
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  booking public.club_signups%rowtype;
  occupied bigint;
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
  -- Повторный checkout уже оплачиваемого заказа не открывает второе списание.
  if booking.reserved_until > now() then return false; end if;
  select coalesce(sum(quantity), 0) into occupied from public.club_signups
    where club = booking.club and event_date = booking.event_date
      and event_time = booking.event_time and counts_seat
      and id <> booking.id
      and (payment_status = 'paid' or (payment_status = 'pending' and reserved_until > now()));
  if booking.counts_seat and occupied + booking.quantity > session_capacity then
    return false;
  end if;
  update public.club_signups set reserved_until = now() + interval '15 minutes'
    where id = booking.id;
  return true;
end;
$$;
revoke all on function public.reserve_club_tickets(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_club_tickets(uuid, integer, integer) to service_role;

commit;
