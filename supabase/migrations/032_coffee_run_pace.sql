-- Темп, который бегун выбрал на лендинге кофе-рана.
--
-- Забег один, а бегут в нём по-разному: на старте людей разводят по группам с
-- пейсерами, и знать это надо ДО старта, а не выяснять в 9:29 на месте.
-- Источник правды о наборе значений — lib/coffeerun/pace.ts (COFFEE_RUN_PACES),
-- констрейнт ниже просто держит базу в тех же рамках.

-- Столбец необязательный, и это осознанно: заявки, сделанные до появления
-- выбора (в том числе с закешированной страницы), остаются валидными — у них
-- просто нет темпа, а не «неверный» темп.
alter table public.coffee_run_signups
  add column if not exists pace text;

comment on column public.coffee_run_signups.pace is
  'Выбранный темп, мин/км (6:30 | 7:00 | 8:00) — источник правды lib/coffeerun/pace.ts. NULL = заявка без выбора темпа';

alter table public.coffee_run_signups
  drop constraint if exists coffee_run_signups_pace_check;

alter table public.coffee_run_signups
  add constraint coffee_run_signups_pace_check
  check (pace is null or pace in ('6:30', '7:00', '8:00'));

-- Разбивка по группам считается внутри забега: спот + дата + темп.
create index if not exists coffee_run_signups_spot_run_date_pace_idx
  on public.coffee_run_signups (spot, run_date, pace);

-- Аналитическая вьюха (025 → 027 → 031) — темп рядом со спотом и датой.
create or replace view public.v_coffeerun_promo as
select
  cr.email                                               as signup_email,
  cr.name                                                as signup_name,
  cr.contact                                             as signup_contact,
  cr.source                                              as signup_source,
  cr.created_at                                          as signup_at,
  pt.token                                               as promo_token,
  pt.status                                              as token_status,
  pt.issued_at,
  pt.redeemed_at,
  case when cr.email is not null and pt.token is not null
       then 'участник_забега'
       else 'гость_кофейни'
  end                                                    as segment,
  cr.run_date                                            as run_date,
  cr.spot                                                as spot,
  cr.pace                                                as pace
from public.promo_tokens pt
join public.users u         on u.id = pt.redeemed_by
left join public.coffee_run_signups cr
       on lower(trim(cr.email)) = lower(trim(u.email));
