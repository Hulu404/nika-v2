-- 064_club_survey_day_times.sql
-- Опрос клуба: разное время по дням. Человек может ответить одним сообщением
-- «чт с 19 до 21, пт с 18 до 20, сб с 11 до 14» — разбор в
-- lib/clubs/day-times.ts, сценарий — docs/club-survey.md.
--
-- day_times — время по дням недели, ключ — JS getDay строкой ("0" = вс …
-- "6" = сб): {"4": {"from": "19:00", "to": "21:00"}, "6": {"any": true}}.
-- Своё время дня важнее времени группы (wd_* / we_*): группа остаётся для
-- ответа без дней, кнопки «Подойдёт любое время» и ответа текстом.
--
-- Идемпотентна: add column if not exists, constraint пересоздаётся.

alter table public.club_survey_responses
  add column if not exists day_times jsonb not null default '{}'::jsonb;

comment on column public.club_survey_responses.day_times is
  'Время по дням недели (ключ — JS getDay строкой): {"4": {"from": "19:00", "to": "21:00"}, "6": {"any": true}}. Важнее wd_*/we_*';

alter table public.club_survey_responses
  drop constraint if exists club_survey_responses_day_times_object;
alter table public.club_survey_responses
  add constraint club_survey_responses_day_times_object check (jsonb_typeof(day_times) = 'object');

-- Без согласия — ни имени, ни ответов: теперь и без времени по дням.
alter table public.club_survey_responses
  drop constraint if exists club_survey_responses_consent_gate;
alter table public.club_survey_responses
  add constraint club_survey_responses_consent_gate check (
    consent_at is not null or (
      name is null and username is null and attend is null
      and days = '{}' and weekdays = '{}'
      and wd_from is null and wd_to is null and wd_raw is null and not wd_any
      and we_from is null and we_to is null and we_raw is null and not we_any
      and day_times = '{}'::jsonb
      and result_id is null and result_answer is null
    )
  );
