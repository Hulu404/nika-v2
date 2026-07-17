-- 018_rhythm_cycles.sql
-- Мой ритм 2.0: цикловые данные, чек-ины и кэш совета дня.

-- ── rhythm_cycles: отметки начала цикла (одна запись на цикл) ─────────────────
create table public.rhythm_cycles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  started_at   date not null,
  cycle_length int,       -- заполняется при следующей отметке (фактическая длина)
  created_at   timestamptz not null default now()
);

create index rhythm_cycles_user_date_idx on public.rhythm_cycles (user_id, started_at desc);

alter table public.rhythm_cycles enable row level security;
create policy "Users can manage own rhythm_cycles" on public.rhythm_cycles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── rhythm_checkins: дневные чек-ины самочувствия (новые) ─────────────────────
create table public.rhythm_checkins (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references public.users (id) on delete cascade,
  date     date not null,
  tags     text[] not null default '{}',
  note     text,
  unique (user_id, date)
);

create index rhythm_checkins_user_date_idx on public.rhythm_checkins (user_id, date desc);

alter table public.rhythm_checkins enable row level security;
create policy "Users can manage own rhythm_checkins" on public.rhythm_checkins
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── rhythm_daily_advice: кэш совета дня от Haiku ──────────────────────────────
create table public.rhythm_daily_advice (
  user_id      uuid not null references public.users (id) on delete cascade,
  date         date not null,
  phase        text not null check (phase in ('menses','rise','peak','slow')),
  cycle_day    int not null,
  advice_short text not null,
  advice_full  text not null,
  primary key (user_id, date)
);

alter table public.rhythm_daily_advice enable row level security;
create policy "Users can read own rhythm_daily_advice" on public.rhythm_daily_advice
  for select using (auth.uid() = user_id);
-- Запись делает только сервис (service_role), поэтому insert/update policy только для него.
create policy "Service role can manage rhythm_daily_advice" on public.rhythm_daily_advice
  for all using (true) with check (true);
