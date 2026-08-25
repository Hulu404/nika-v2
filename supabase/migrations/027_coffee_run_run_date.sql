-- Дата забега, на который записался участник кофе-рана.
-- Нужна, чтобы отделить волну регистраций на 22 августа от новой — на 29 августа.

-- 1. Добавляем столбец с default '2026-08-22': все уже существующие строки
--    (регистрации на первый забег) сразу получают эту дату.
alter table public.coffee_run_signups
  add column if not exists run_date date not null default date '2026-08-22';

-- 2. Меняем default на актуальную дату забега — так его получат новые записи,
--    даже если клиент не пришлёт run_date явно.
alter table public.coffee_run_signups
  alter column run_date set default date '2026-08-29';

comment on column public.coffee_run_signups.run_date is
  'Дата кофе-рана, на который зарегистрировался участник (не дата подачи заявки — она в created_at)';

create index if not exists coffee_run_signups_run_date_idx
  on public.coffee_run_signups (run_date);

-- 3. Аналитическая вьюха из 025_qr_promo.sql — добавляем run_date.
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
  cr.run_date                                            as run_date
from public.promo_tokens pt
join public.users u         on u.id = pt.redeemed_by
left join public.coffee_run_signups cr
       on lower(trim(cr.email)) = lower(trim(u.email));
