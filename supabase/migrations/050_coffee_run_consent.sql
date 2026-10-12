-- 050_coffee_run_consent.sql
-- Согласие на обработку персональных данных с лендинга кофе-рана.
--
-- На новой странице /coffeerunsurfsport без галочки согласия форма не уходит;
-- сервер записывает момент согласия. Столбец необязательный: заявки со старых
-- (закешированных) страниц и с лендинга Лужников согласия не присылают и
-- остаются валидными, у них просто consent_at = NULL.
--
-- RLS и гранты таблицы не меняются: пишет только сервер (service_role).
-- Идемпотентна: add column if not exists.

alter table public.coffee_run_signups
  add column if not exists consent_at timestamptz;

comment on column public.coffee_run_signups.consent_at is
  'Когда человек отметил согласие на обработку персональных данных на лендинге. NULL — страница без чекбокса согласия';
