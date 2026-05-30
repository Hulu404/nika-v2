-- 005_gender.sql
-- Гендер в профиле: чтобы обращаться к пользователю в правильном роде
-- (онбординг, тексты на /analytics и т.п.). Шаг 2 онбординга его собирает.

create type gender as enum ('male', 'female');

alter table public.profiles
  add column gender gender;
