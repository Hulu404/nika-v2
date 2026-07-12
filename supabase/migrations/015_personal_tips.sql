-- 015_personal_tips.sql
-- Личные советы (/tips): персональная лента вместо старой статичной библиотеки.
-- Совет пишет НИКА из чата (серверный инструмент save_tip, см. Промт 2) в строку
-- этого юзера. На странице совет можно удалить (мягко — deleted_at).
--
-- category — text из фиксированного набора (валидируется CHECK'ом и в приложении,
-- тип TipCategory). Enum намеренно не заводим: набор ещё может расширяться.

-- ── public.personal_tips ─────────────────────────────────────────────────────
create table public.personal_tips (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  title      text not null,
  body       text not null,
  category   text not null
             check (category in ('before','technique','breathing','gear','recovery','mindset')),
  source     text,                            -- короткий контекст, откуда совет (необязательно)
  created_at timestamptz not null default now(),
  deleted_at timestamptz                      -- мягкое удаление: NULL = виден в ленте
);

-- Лента: свежие сверху, только не удалённые.
create index personal_tips_user_created_idx
  on public.personal_tips (user_id, created_at desc)
  where deleted_at is null;

-- Дедуп по нормализованному заголовку (логика записи — в save_tip, Промт 2).
create index personal_tips_dedup_idx
  on public.personal_tips (user_id, lower(title))
  where deleted_at is null;

-- ── RLS: каждый видит, вставляет и удаляет только свои строки ─────────────────
alter table public.personal_tips enable row level security;

create policy "Users can read own personal_tips" on public.personal_tips
  for select using (auth.uid() = user_id);
create policy "Users can insert own personal_tips" on public.personal_tips
  for insert with check (auth.uid() = user_id);
create policy "Users can update own personal_tips" on public.personal_tips
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own personal_tips" on public.personal_tips
  for delete using (auth.uid() = user_id);

-- ── Снос старых закладок статичной библиотеки ────────────────────────────────
-- Фича «Библиотека / Сохранённые» убрана целиком. Данные в saved_tips тестовые.
drop table if exists public.saved_tips;
