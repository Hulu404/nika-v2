-- 013_robokassa_billing_period.sql
-- Период подписки для платежа. Пригодится, когда появится годовой тариф.
-- paid_at уже добавлен ранее (см. 012_robokassa.sql) — не трогаем.
-- idempotent: add column if not exists.

alter table robokassa_payments
  add column if not exists billing_period text not null default 'monthly'
    check (billing_period in ('monthly', 'yearly'));
