-- 012_robokassa.sql
-- Платежи Robokassa. Отдельная таблица заказов с числовым inv_id —
-- Robokassa требует целочисленный InvId, а subscriptions.id — uuid.
-- Источник истины об оплате — Result URL (/api/robokassa/result), который
-- по факту оплаты помечает платёж paid и активирует подписку в
-- public.subscriptions + users.is_pro (см. app/api/robokassa/result/route.ts).

create table public.robokassa_payments (
  inv_id     bigint generated always as identity primary key,
  user_id    uuid not null references public.users (id) on delete cascade,
  plan       text not null check (plan in ('monthly', 'halfyear')),
  amount     numeric(10, 2) not null,
  status     text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  created_at timestamptz not null default now(),
  paid_at    timestamptz
);

create index robokassa_payments_user_id_idx on public.robokassa_payments (user_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Запись — только service-role клиентом (create-payment / result-вебхук),
-- поэтому INSERT/UPDATE-политик нет. Пользователю доступно только чтение своих.
alter table public.robokassa_payments enable row level security;

create policy "Users can read own robokassa payments" on public.robokassa_payments
  for select using (auth.uid() = user_id);
