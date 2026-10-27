-- 066_club_signups_waitlist.sql
-- Лист ожидания занятий клуба: когда все места занятия оплачены
-- (capacity в lib/clubs/sessions.ts), новая заявка ложится со статусом
-- 'waitlist'. Это люди, которым напишем, когда откроется запись на следующее
-- занятие клуба. Неоплаченная заявка (pending), чей хозяин не успел оплатить
-- до распродажи, переводится в 'waitlist' при входе в бота или на оплате.
--
-- Идемпотентна: ограничение пересоздаётся.

alter table public.club_signups
  drop constraint if exists club_signups_payment_status_check;

alter table public.club_signups
  add constraint club_signups_payment_status_check
  check (payment_status in ('pending', 'paid', 'refunded', 'waitlist'));

comment on column public.club_signups.payment_status is
  'pending — заявка без оплаты; paid — оплачено, коврик закреплён; refunded — деньги вернули; '
  'waitlist — места кончились, ждёт записи на следующее занятие клуба';
