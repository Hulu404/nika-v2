-- 067_club_signups_counts_seat.sql
-- Оплаченная заявка, которая НЕ занимает коврик: тестовые оплаты команды,
-- гости организатора. Деньги и статус paid остаются как были (бот по-прежнему
-- отвечает «коврик твой»), но в счёт мест (capacity в lib/clubs/sessions.ts)
-- такая строка не идёт — см. countPaidSeats в lib/clubs/seats.ts.
--
-- Идемпотентна.

alter table public.club_signups
  add column if not exists counts_seat boolean not null default true;

comment on column public.club_signups.counts_seat is
  'false — оплаченная заявка не занимает место на занятии (тест, гость команды). По умолчанию true';

-- Тестовая оплата 100 ₽ (Жозе Бнаят, @hulu404, 27.10.2026) — проверка ЮKassa, а не участник.
update public.club_signups
  set counts_seat = false, updated_at = now()
  where id = '69b31651-5439-4a71-9f6d-84bcbfa3853c';
