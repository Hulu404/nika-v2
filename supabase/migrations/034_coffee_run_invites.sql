-- 034_coffee_run_invites.sql
-- Кого уже звали на забег: дедуп приглашений «открылась запись».
--
-- Почему таблица, а не память процесса (как у /moved и /cancel в poll-store):
-- те объявления разовые и уходят по кнопке, организатор видит счётчик до
-- отправки, и повтор ловится глазами. Приглашение уходит САМО, по понедельникам,
-- а тикер в instrumentation.ts делает первый проход сразу при старте процесса —
-- то есть на каждом деплое. Дедуп в памяти обнулялся бы вместе с процессом, и
-- очередной понедельничный релиз разослал бы приглашение семи десяткам человек
-- повторно. Это ровно та причина, по которой напоминания за сутки держатся за
-- столбец reminder_sent_at, а не за память.
--
-- Ключ — (спот, дата забега, чат): один человек, один забег, одно приглашение.
-- Спот в ключе не избыточен: даты забегов на разных спотах совпадают редко, но
-- совпадают, и Усачёва не должна гасить приглашение в Лужники.
--
-- Идемпотентна: create table/index if not exists, revoke — повторяемая операция.

create table if not exists public.coffee_run_invites (
  spot     text        not null,
  run_date date        not null,
  chat_id  bigint      not null,
  sent_at  timestamptz not null default now(),
  primary key (spot, run_date, chat_id)
);

comment on table public.coffee_run_invites is
  'Кому уже уходило приглашение на забег. Пишет рассылка (lib/coffeerun/invite-dispatch.ts), читает она же';
comment on column public.coffee_run_invites.chat_id is
  'Telegram chat_id из coffee_run_signups.tg_chat_id. Ссылки на заявку нет намеренно: приглашают ДО того, как заявка на этот забег появится';

-- Выборка «кого уже звали на этот забег» — основной и единственный запрос.
-- Первичный ключ его уже покрывает (spot, run_date — префикс), отдельного
-- индекса не заводим.

-- Чистка старых приглашений по прошедшим забегам — ручная, по необходимости:
-- таблица растёт на десятки строк за забег, спешить некуда.

alter table public.coffee_run_invites enable row level security;

-- Политик нет: пишет и читает только service_role через бота.

-- Supabase выдаёт anon и authenticated гранты на объекты public-схемы по
-- умолчанию. Здесь лежит связка «телеграм-чат ↔ забег» — снимаем, как в 033.
revoke all on table public.coffee_run_invites from anon, authenticated;
