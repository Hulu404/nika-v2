-- Новая волна регистраций кофе-рана — на 5 сентября.
--
-- Дефолт столбца это страховка: run_date почти всегда приходит явно из формы
-- (lib/coffeerun/run.ts → лендинг → POST /api/coffeerun-signup). Но если клиент
-- пришлёт заявку без даты, она должна лечь в ближайший забег, а не в прошедший.
alter table public.coffee_run_signups
  alter column run_date set default date '2026-09-05';
