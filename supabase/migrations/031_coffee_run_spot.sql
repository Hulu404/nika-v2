-- Спот забега: с какой страницы человек записался и, значит, куда ему приходить.
--
-- Раньше забег однозначно задавался датой — забег был один. Теперь их два в
-- соседние дни и от разных спотов (Усачёва, 62 и Лужники, 24 стр. 41), и одной
-- даты мало: бот должен подтверждать ИМЕННО тот забег, на который пришла заявка,
-- а не ближайший по календарю. Ключ пары «забег» — (spot, run_date),
-- см. lib/coffeerun/run.ts.

-- 1. Столбец с default 'usachevo': все существующие строки — это регистрации на
--    забеги у спота Surf Coffee × Sport на Усачёва, 62 (22 августа, 29 августа,
--    5 сентября). Так они сразу получают верный спот, без отдельного UPDATE.
alter table public.coffee_run_signups
  add column if not exists spot text not null default 'usachevo';

comment on column public.coffee_run_signups.spot is
  'Слаг спота забега (usachevo | luzhniki) — источник правды lib/coffeerun/run.ts. Вместе с run_date однозначно задаёт забег';

-- 2. Выборки бота и рассылки идут по паре «забег»: спот + дата.
create index if not exists coffee_run_signups_spot_run_date_idx
  on public.coffee_run_signups (spot, run_date);

-- 3. Аналитическая вьюха (025 → 027) — добавляем спот рядом с датой и источником.
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
  cr.spot                                                as spot
from public.promo_tokens pt
join public.users u         on u.id = pt.redeemed_by
left join public.coffee_run_signups cr
       on lower(trim(cr.email)) = lower(trim(u.email));
