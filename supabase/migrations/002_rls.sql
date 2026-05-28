-- 002_rls.sql
-- Row Level Security: каждый пользователь видит и меняет только свои строки.
-- subscriptions пишутся только service-role клиентом (вебхуки ЮKassa),
-- поэтому публичных INSERT/UPDATE-политик у них нет.

-- ── Включаем RLS ─────────────────────────────────────────────────────────────
alter table public.users         enable row level security;
alter table public.profiles      enable row level security;
alter table public.conversations enable row level security;
alter table public.subscriptions enable row level security;

-- ── users ────────────────────────────────────────────────────────────────────
create policy "Users can read own row" on public.users
  for select using (auth.uid() = id);

create policy "Users can update own row" on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ── profiles ─────────────────────────────────────────────────────────────────
create policy "Users can read own profile" on public.profiles
  for select using (auth.uid() = user_id);

create policy "Users can insert own profile" on public.profiles
  for insert with check (auth.uid() = user_id);

create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── conversations ────────────────────────────────────────────────────────────
create policy "Users can read own conversations" on public.conversations
  for select using (auth.uid() = user_id);

create policy "Users can insert own conversations" on public.conversations
  for insert with check (auth.uid() = user_id);

create policy "Users can update own conversations" on public.conversations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── subscriptions ────────────────────────────────────────────────────────────
-- Только чтение своих подписок; запись — через service role (обходит RLS).
create policy "Users can read own subscriptions" on public.subscriptions
  for select using (auth.uid() = user_id);
