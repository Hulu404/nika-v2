-- 014_saved_tips.sql
-- Закладки советов: какие карточки раздела «Советы» (/tips) сохранил юзер.
-- tip_id это Tip.id из статического конфига lib/tips/data.ts (не FK на таблицу).
-- Закладка = наличие строки; тоггл сохранения = insert / delete (update не нужен).

create table public.saved_tips (
  user_id    uuid not null references public.users (id) on delete cascade,
  tip_id     integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, tip_id)
);

create index saved_tips_user_idx on public.saved_tips (user_id);

-- ── RLS: каждый видит и меняет только свои закладки ──────────────────────────
alter table public.saved_tips enable row level security;

create policy "Users can read own saved_tips" on public.saved_tips
  for select using (auth.uid() = user_id);
create policy "Users can insert own saved_tips" on public.saved_tips
  for insert with check (auth.uid() = user_id);
create policy "Users can delete own saved_tips" on public.saved_tips
  for delete using (auth.uid() = user_id);
