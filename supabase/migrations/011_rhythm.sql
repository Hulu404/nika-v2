-- 011_rhythm.sql
-- Раздел «Мой ритм»: слой данных состояния девушки.
--
-- ВАЖНО (решение продукта): это НЕ трекер цикла. Из period_marks НЕ вычисляется
-- «день цикла», не выводятся фазы, овуляция или прогноз следующих месячных —
-- ни в схеме, ни в коде. Здесь только факты, которые отметил сам пользователь.

-- ── public.daily_state ───────────────────────────────────────────────────────
-- Одна запись на дату пользователя. Дату считает клиент по своей таймзоне и
-- присылает как date (YYYY-MM-DD) — так же, как это делает журнал пробежек.
-- Повторный чек-ин за тот же день обновляет строку (unique + upsert).
create table public.daily_state (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  date       date not null,
  moods      text[]  not null default '{}',  -- канонические ключи чипов; словарь валидируется в приложении (см. lib/rhythm.ts)
  ran        boolean,                         -- факт пробежки за день, если знаем (иначе NULL)
  note       text,                            -- свободная заметка (на будущее)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);

-- Раздел тянет состояние по дате, обычно последние дни — сортировка по дате desc.
create index daily_state_user_date_idx on public.daily_state (user_id, date desc);

-- ── public.period_marks ──────────────────────────────────────────────────────
-- Опциональная отметка месячных за конкретный день. «Диапазон» — это просто
-- набор помеченных дней. Источником фаз/прогноза НЕ является.
create table public.period_marks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  date       date not null,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

create index period_marks_user_date_idx on public.period_marks (user_id, date desc);

-- ── Согласие на хранение (152-ФЗ) ────────────────────────────────────────────
-- Отдельный одноразовый consent на чувствительные данные раздела. Храним факт,
-- версию текста и дату — чтобы при смене формулировок можно было перезапросить.
alter table public.profiles
  add column rhythm_consent_at      timestamptz,  -- когда пользователь согласился (NULL = ещё нет)
  add column rhythm_consent_version text;         -- версия текста согласия на момент согласия

-- ── RLS: каждый видит и меняет только свои записи ────────────────────────────
alter table public.daily_state  enable row level security;
alter table public.period_marks enable row level security;

create policy "Users can read own daily_state" on public.daily_state
  for select using (auth.uid() = user_id);
create policy "Users can insert own daily_state" on public.daily_state
  for insert with check (auth.uid() = user_id);
create policy "Users can update own daily_state" on public.daily_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own daily_state" on public.daily_state
  for delete using (auth.uid() = user_id);

create policy "Users can read own period_marks" on public.period_marks
  for select using (auth.uid() = user_id);
create policy "Users can insert own period_marks" on public.period_marks
  for insert with check (auth.uid() = user_id);
create policy "Users can delete own period_marks" on public.period_marks
  for delete using (auth.uid() = user_id);

-- ── Автообновление updated_at (функция из 003_triggers.sql) ───────────────────
create trigger set_updated_at_daily_state
  before update on public.daily_state
  for each row execute function public.set_updated_at();
