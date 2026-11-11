-- Ответ на перекличку в день забега («кто придёт сегодня»), в заявке участника.
--
-- До этой миграции ответы переклички жили только в памяти процесса бота
-- (lib/telegram/poll-store.ts) и терялись при перезапуске. Теперь бот пишет
-- ответ ещё и сюда (lib/telegram/coffeerun-poll.ts → handleCoffeeRunPollAnswer),
-- а экран «🎟 Мои записи» считает по нему посещения (lib/telegram/attendance.ts).
--
-- Применить ДО деплоя бота с меню. Если забыть, бот не сломается: запись ответа
-- только пишет ошибку в лог, а «Мои записи» читают заявки без этих колонок.
-- Но ответы переклички, пришедшие до миграции, в базу не попадут.

alter table public.coffee_run_signups
  add column if not exists rollcall_answer text;

alter table public.coffee_run_signups
  add column if not exists rollcall_answered_at timestamptz;

alter table public.coffee_run_signups
  drop constraint if exists coffee_run_signups_rollcall_answer_check;

alter table public.coffee_run_signups
  add constraint coffee_run_signups_rollcall_answer_check
  check (rollcall_answer in ('yes', 'no'));

comment on column public.coffee_run_signups.rollcall_answer is
  'Ответ на перекличку в день забега: yes — приду, no — не приду. NULL — не отвечал или переклички не было';

comment on column public.coffee_run_signups.rollcall_answered_at is
  'Когда человек ответил на перекличку. Хоть одна непустая на забеге = перекличка была (см. lib/telegram/attendance.ts)';
