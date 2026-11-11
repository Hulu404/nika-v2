begin;

create table if not exists public.club_promo_codes (
  code text primary key check (code = upper(code) and code ~ '^[A-Z0-9_-]{4,40}$'),
  discount_percent integer not null check (discount_percent between 10 and 50),
  usage_limit integer not null check (usage_limit > 0),
  reserved_uses integer not null default 0 check (reserved_uses >= 0),
  redeemed_uses integer not null default 0 check (redeemed_uses >= 0),
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

insert into public.club_promo_codes (code, discount_percent, usage_limit) values
  ('NIKA-7F3K9Q', 10, 1),
  ('NIKA-4P8M2X', 20, 1),
  ('NIKA-9D6R1W', 30, 1),
  ('NIKA-2H5V8C', 40, 1),
  ('NIKA-6B3T7L', 50, 1)
on conflict (code) do nothing;

alter table public.club_signups
  add column if not exists base_amount_rub integer,
  add column if not exists promo_code text,
  add column if not exists promo_discount_percent integer,
  add column if not exists promo_discount_rub integer;

update public.club_signups set base_amount_rub = amount_rub where base_amount_rub is null;

alter table public.club_signups enable row level security;
alter table public.club_promo_codes enable row level security;
drop policy if exists "no client access" on public.club_promo_codes;
create policy "no client access" on public.club_promo_codes for all using (false) with check (false);

create or replace function public.reserve_club_promo_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare promo public.club_promo_codes%rowtype;
begin
  if new.promo_code is null or new.promo_code = '' then
    new.promo_code := null;
    new.promo_discount_percent := null;
    new.promo_discount_rub := 0;
    if new.base_amount_rub is not null then new.amount_rub := new.base_amount_rub; end if;
    return new;
  end if;
  if new.payment_status = 'waitlist' then
    raise exception 'promo_not_available' using errcode = 'P0001';
  end if;
  if new.base_amount_rub is null or new.base_amount_rub < 0 then
    raise exception 'promo_base_amount_missing' using errcode = 'P0001';
  end if;
  select * into promo from public.club_promo_codes where code = upper(new.promo_code) for update;
  if not found or not promo.active or (promo.expires_at is not null and promo.expires_at <= now())
    or promo.reserved_uses + promo.redeemed_uses >= promo.usage_limit then
    raise exception 'promo_invalid_or_exhausted' using errcode = 'P0001';
  end if;
  new.promo_code := promo.code;
  new.promo_discount_percent := promo.discount_percent;
  new.promo_discount_rub := round(new.base_amount_rub * promo.discount_percent / 100.0)::integer;
  new.amount_rub := new.base_amount_rub - new.promo_discount_rub;
  update public.club_promo_codes set reserved_uses = reserved_uses + 1 where code = promo.code;
  return new;
end;
$$;

drop trigger if exists club_signup_reserve_promo on public.club_signups;
create trigger club_signup_reserve_promo before insert on public.club_signups
for each row execute function public.reserve_club_promo_code();

create or replace function public.finish_club_promo_reservation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.promo_code is not null and old.payment_status is distinct from new.payment_status then
    if new.payment_status = 'paid' then
      update public.club_promo_codes set reserved_uses = greatest(0, reserved_uses - 1), redeemed_uses = redeemed_uses + 1 where code = old.promo_code;
    elsif new.payment_status in ('canceled', 'expired', 'refunded_overbooked', 'waitlist') then
      update public.club_promo_codes set reserved_uses = greatest(0, reserved_uses - 1) where code = old.promo_code;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists club_signup_finish_promo on public.club_signups;
create trigger club_signup_finish_promo after update of payment_status on public.club_signups
for each row execute function public.finish_club_promo_reservation();

commit;
