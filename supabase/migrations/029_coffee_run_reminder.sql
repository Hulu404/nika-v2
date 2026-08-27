-- Напоминание за сутки до кофе-рана.
--
-- Идемпотентность рассылки держится на reminder_sent_at: крон может тикать хоть
-- ежечасно, но каждый участник получает напоминание один раз.

alter table public.coffee_run_signups
  add column if not exists reminder_sent_at timestamptz;

comment on column public.coffee_run_signups.reminder_sent_at is
  'Когда ушло напоминание за сутки. NULL = ещё не отправляли (крон возьмёт эту строку)';

-- Выборка крона: подтверждённые участники конкретного забега, которым ещё
-- не напоминали. Частичный индекс — после рассылки строки из него выпадают.
create index if not exists coffee_run_signups_reminder_due_idx
  on public.coffee_run_signups (run_date)
  where confirmed_at is not null
    and tg_chat_id is not null
    and reminder_sent_at is null;
