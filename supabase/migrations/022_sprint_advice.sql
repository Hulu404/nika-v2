-- ─────────────────────────────────────────────────────────────────────────────
-- Персональные советы спринта (Про-фича). Кэш сгенерированных советов по неделям
-- спринта: правила выбирают тему по сигналам (бег/чат/цель/состояние), LLM
-- формулирует текст. Обновление привязано к неделе спринта (чек-ин), поэтому
-- ключ — (sprint_id, week_number).
-- Запустить в Supabase SQL Editor или через Supabase CLI.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists sprint_advice (
  user_id      uuid  not null references auth.users(id) on delete cascade,
  sprint_id    uuid  not null references sprints(id) on delete cascade,
  week_number  int2  not null check (week_number between 1 and 3),

  -- [{ theme, text }] — 2-3 совета, уже сформулированные голосом Ники.
  -- Данные цикла в текст НЕ попадают (только внутренний сигнал при генерации).
  tips         jsonb not null default '[]'::jsonb,

  created_at   timestamptz not null default now(),

  primary key (sprint_id, week_number)
);

-- Типичный доступ — по владельцу.
create index if not exists sprint_advice_user_idx on sprint_advice (user_id);

-- ─── Row Level Security ──────────────────────────────────────────────────────
alter table sprint_advice enable row level security;

create policy "Users manage own sprint advice"
  on sprint_advice for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
