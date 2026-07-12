-- 016_robokassa_pro_plan.sql
-- Тариф 'pro' для robokassa_payments: подписка PRO со стартовой ценой первой
-- недели 1 ₽. Расширяем CHECK по колонке plan (было только monthly/halfyear).
-- billing_period не трогаем — для PRO он остаётся дефолтным 'monthly' (013).
--
-- ВНИМАНИЕ: автопродление 249 ₽/мес (Robokassa Recurring) этой миграцией НЕ
-- вводится — это открытый вопрос на стороне бэкенда/Robokassa.

alter table public.robokassa_payments
  drop constraint if exists robokassa_payments_plan_check;

alter table public.robokassa_payments
  add constraint robokassa_payments_plan_check
    check (plan in ('monthly', 'halfyear', 'pro'));
