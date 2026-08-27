-- Подтверждение записи на кофе-ран через Telegram-бота.
--
-- Флоу: форма на лендинге → заявка (confirm_token) → кнопка «Подтвердить в
-- Telegram» → t.me/<bot>?start=cr_<token> → бот сверяет ник, ставит confirmed_at
-- и присылает участнику его данные + время и место старта.

alter table public.coffee_run_signups
  -- Ник Telegram в каноне: нижний регистр, без «@». Столбец contact остаётся
  -- как есть (там же лежит «@nick») — на нём висит вся прошлая аналитика.
  add column if not exists tg_username   text,
  -- Одноразовый секрет из формы: доказывает, что бота открыл автор заявки.
  add column if not exists confirm_token text,
  add column if not exists confirmed_at  timestamptz,
  -- chat_id того, кто подтвердил: по нему бот сможет написать позже (напоминание).
  add column if not exists tg_chat_id    bigint;

comment on column public.coffee_run_signups.tg_username is
  'Ник Telegram без @, в нижнем регистре — ключ поиска заявки ботом';
comment on column public.coffee_run_signups.confirm_token is
  'Одноразовый токен из deep-link t.me/<bot>?start=cr_<token>';
comment on column public.coffee_run_signups.confirmed_at is
  'Момент подтверждения в боте. NULL = заявка оставлена, но участие не подтверждено';

-- Токен уникален (частичный индекс: старые строки без токена не мешают).
create unique index if not exists coffee_run_signups_confirm_token_key
  on public.coffee_run_signups (confirm_token)
  where confirm_token is not null;

-- Поиск заявки ботом по нику в рамках забега.
create index if not exists coffee_run_signups_tg_username_idx
  on public.coffee_run_signups (tg_username, run_date)
  where tg_username is not null;

-- RLS уже включён в 019 (select запрещён всем, пишет только service role) —
-- новые столбцы наследуют те же правила, дополнять политики не нужно.
