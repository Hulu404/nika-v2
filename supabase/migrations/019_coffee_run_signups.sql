-- Заявки на Кофе-ран × Surf Coffee × НИКА (22 августа)
create table if not exists public.coffee_run_signups (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text        not null,
  contact     text        not null,   -- телефон / telegram
  email       text        not null,
  source      text        not null default 'coffeerunsurfsport'
);

-- RLS: включаем, но анонимному чтение закрыто; insert только через service role
alter table public.coffee_run_signups enable row level security;

-- Никто (включая анонимов) не может читать строки через клиент
create policy "no anon read"
  on public.coffee_run_signups
  for select
  using (false);

-- Вставку делает только API-роут с service role key (минует RLS)
-- Явных insert-политик не нужно: service role всегда имеет полный доступ.
