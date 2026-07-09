-- 008_onboarding.sql
-- Поля нового чат-онбординга. Все колонки nullable, чтобы не ломать
-- существующие строки profiles. goal/level/fears НЕ трогаем — просто
-- перестаём их писать; gender и users.display_name уже есть.

alter table public.profiles
  add column cycle            text    check (cycle in ('on', 'self', 'off')),        -- учёт «тяжёлых дней»: NULL = не спрашивали/пропустил
  add column proactive        boolean,                                               -- можно ли НИКЕ писать первой
  add column notif_permission text    check (notif_permission in ('granted', 'denied', 'default')); -- результат системного запроса
