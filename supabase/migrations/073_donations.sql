-- Поддержка клуба (донаты) в боте мероприятий + переносы и отмены забегов в базе.
--
-- Применить ДО деплоя бота с кнопкой «🧡 Поддержать». После 072_coffee_run_attendance.sql.
--
--   donations            — добровольные оплаты через ЮKassa (lib/donations);
--   donation_drafts      — бот ждёт от человека сумму или почту (как шаги опроса клуба);
--   coffee_run_changes   — /moved и /cancel переживают перезапуск процесса;
--   event_followups      — одно сообщение «спасибо, что был(а)» на событие, кто бы его ни запустил;
--   donation_asked_at    — в заявках: когда человеку писали после события (не чаще раза в 28 дней).

begin;

-- ── Донаты ────────────────────────────────────────────────────────────────────
create table if not exists public.donations (
  id                  uuid        primary key default gen_random_uuid(),
  tg_chat_id          bigint,
  tg_username         text,
  email               text        not null,
  amount_rub          int         not null check (amount_rub >= 100 and amount_rub <= 50000),
  source              text        not null check (source in ('menu', 'after_event')),
  event_kind          text        check (event_kind in ('coffee_run', 'club')),
  event_ref           text,
  payment_status      text        not null default 'pending_payment'
                                  check (payment_status in ('pending_payment', 'paid', 'canceled')),
  yk_payment_id       text        unique,
  yk_confirmation_url text,
  payment_attempt     int         not null default 0,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz
);

comment on table public.donations is
  'Поддержка клуба NIKA: добровольная оплата через ЮKassa из бота мероприятий (lib/donations)';
comment on column public.donations.event_ref is
  '<spot>:<run_date> или <club>:<event_date> для сообщения после события; NULL — из меню';
comment on column public.donations.payment_attempt is
  'Номер попытки оплаты: Idempotence-Key ЮKassa = donation-<id>-<attempt>';

create index if not exists donations_chat_paid on public.donations (tg_chat_id, paid_at);
create index if not exists donations_paid_at on public.donations (paid_at) where payment_status = 'paid';

alter table public.donations enable row level security;
drop policy if exists "no client access" on public.donations;
create policy "no client access" on public.donations for all using (false) with check (false);

-- ── Бот ждёт ввода: своя сумма или почта для чека ──────────────────────────────
create table if not exists public.donation_drafts (
  tg_chat_id  bigint      primary key,
  step        text        not null check (step in ('amount', 'email')),
  amount_rub  int,
  source      text        not null check (source in ('menu', 'after_event')),
  event_kind  text        check (event_kind in ('coffee_run', 'club')),
  event_ref   text,
  tg_username text,
  updated_at  timestamptz not null default now()
);

alter table public.donation_drafts enable row level security;
drop policy if exists "no client access" on public.donation_drafts;
create policy "no client access" on public.donation_drafts for all using (false) with check (false);

-- ── Переносы и отмены забегов ─────────────────────────────────────────────────
create table if not exists public.coffee_run_changes (
  run_date   date        not null,
  spot       text        not null,
  kind       text        not null check (kind in ('moved', 'cancelled')),
  new_start  text,
  created_by bigint,
  created_at timestamptz not null default now(),
  unique (run_date, spot, kind)
);

comment on table public.coffee_run_changes is
  '/moved и /cancel бота мероприятий. Память процесса (poll-store.ts) — только кэш, правда здесь';

alter table public.coffee_run_changes enable row level security;
drop policy if exists "no client access" on public.coffee_run_changes;
create policy "no client access" on public.coffee_run_changes for all using (false) with check (false);

-- ── Одно сообщение после события ──────────────────────────────────────────────
create table if not exists public.event_followups (
  event_ref  text        primary key,
  trigger    text        not null check (trigger in ('done', 'auto')),
  started_by bigint,
  started_at timestamptz not null default now(),
  sent_count int         not null default 0
);

alter table public.event_followups enable row level security;
drop policy if exists "no client access" on public.event_followups;
create policy "no client access" on public.event_followups for all using (false) with check (false);

-- ── Когда человеку писали после события ───────────────────────────────────────
alter table public.coffee_run_signups add column if not exists donation_asked_at timestamptz;
alter table public.club_signups       add column if not exists donation_asked_at timestamptz;

commit;
