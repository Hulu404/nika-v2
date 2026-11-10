-- Бесплатные встречи клубов (книжный клуб NIKA | YOU'LL NEVER READ ALONE и следующие).
--
-- Встреча с priceRub = 0 в lib/clubs/sessions.ts подтверждается сразу, без ЮKassa:
-- строка ложится с payment_status = 'paid' и amount_rub = 0, место занимает как оплаченная.
-- Почта для бесплатной встречи не нужна (чек не выбиваем): пишем пустую строку,
-- столбец остаётся not null.
--
-- Применить ДО выкладки API и бота с клубом 'read'. Без миграции insert упадёт на
-- club_signups_amount_rub_check, и заявка вернёт 500.
begin;

alter table public.club_signups
  drop constraint if exists club_signups_amount_rub_check;
alter table public.club_signups
  add constraint club_signups_amount_rub_check check (amount_rub >= 0);

comment on column public.club_signups.amount_rub is
  'Сумма заказа в рублях, зафиксированная при заявке. 0 — бесплатная встреча, подтверждается без оплаты';

commit;
