-- Cave: темп 6:00 и адрес старта в каждой новой заявке.
-- Применить до выкладки API. Старые строки остаются с address = NULL.
-- Откат приложения безопасен: оставить расширенную схему и сохранённые адреса.
-- Сужение набора темпов допустимо отдельной миграцией только после проверки
-- отсутствия строк с pace = '6:00'; данные автоматически не удаляем.
set lock_timeout = '5s';

alter table public.coffee_run_signups
  add column if not exists address text;

comment on column public.coffee_run_signups.address is
  'Адрес старта на момент регистрации; API берёт его из lib/coffeerun/run.ts';

alter table public.coffee_run_signups
  drop constraint if exists coffee_run_signups_pace_check;

alter table public.coffee_run_signups
  add constraint coffee_run_signups_pace_check
  check (pace is null or pace in ('6:00', '6:30', '7:00', '8:00'));

comment on column public.coffee_run_signups.pace is
  'Выбранный темп, мин/км (6:00 | 6:30 | 7:00 | 8:00); NULL = без выбора темпа';
