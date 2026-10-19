-- 063_club_surveys.sql
-- Опросы перед запуском клубов в боте мероприятий (первый — клуб йоги).
-- Сценарий и тексты: docs/club-survey.md. Пишет и читает только бот
-- (lib/clubs/survey-store.ts) под service_role.
--
-- Почему таблицы, а не память процесса (как у опроса про дождь в poll-store):
-- опрос живёт несколько дней, напоминания уходят сами по тикеру из
-- instrumentation.ts, а тикер делает первый проход на каждом деплое. Шаг
-- человека, его ответы и отметки «уже напомнили» обязаны пережить рестарт —
-- та же причина, что у coffee_run_invites (034) и reminder_sent_at (029).
--
-- Даты-кандидаты, подписи и окна напоминаний живут в коде
-- (lib/clubs/survey-config.ts), здесь — только то, что меняется во время опроса.
--
-- Идемпотентна: create table if not exists, revoke — повторяемая операция.

-- ── Итог опроса: дата, время и место первой встречи ───────────────────────────
-- Каждая версия итога — отдельная строка. Организатор шлёт /surveyresult,
-- бот пишет черновик (confirmed_at пуст) и показывает предпросмотр; кнопка
-- «Разослать» несёт id строки и проставляет confirmed_at. Действующий итог —
-- последняя подтверждённая строка опроса. Исправление места или времени —
-- новая строка, по ней видно, кому ушла старая версия.

create table if not exists public.club_survey_results (
  id           bigint      generated always as identity primary key,
  survey_key   text        not null,
  meet_date    date        not null,
  meet_time    text        not null check (meet_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  place        text        not null check (length(place) between 1 and 300),
  bring        text        check (bring is null or length(bring) between 1 and 300),
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz
);

comment on table public.club_survey_results is
  'Версии итога опроса клуба (/surveyresult). confirmed_at пуст — черновик под предпросмотром; действующий итог — последняя подтверждённая строка';
comment on column public.club_survey_results.survey_key is
  'Ключ опроса из lib/clubs/survey-config.ts (yoga)';
comment on column public.club_survey_results.meet_time is
  'Время начала встречи, HH:MM по Москве';
comment on column public.club_survey_results.bring is
  'Что взять с собой; NULL — в сообщении участнику нет фразы «С собой: …»';

create index if not exists club_survey_results_key_idx
  on public.club_survey_results (survey_key, id desc);

-- ── Ответы участников ─────────────────────────────────────────────────────────
-- Одна строка на человека в опросе. Строка появляется при первом сообщении
-- опроса (рассылка или ссылка start=<payload>) и заодно служит дедупом
-- «уже спросили».
--
-- Приватность: пока нет согласия (consent_at), храним только chat_id, шаг,
-- источник и служебные отметки — check ниже не даёт записать имя или ответы
-- без согласия.
--
-- Промежутки времени — по группам дней: wd_* для будней (пн–пт), we_* для
-- выходных (сб–вс). Состояние группы:
--   промежуток        — *_from и *_to заполнены (HH:MM), *_raw — как написал человек;
--   любое время       — *_any = true;
--   ответ текстом     — *_raw заполнен, *_from пуст, *_any = false
--                       (после двух неудачных попыток разбора);
--   группа не нужна   — всё пусто.

create table if not exists public.club_survey_responses (
  survey_key      text        not null,
  chat_id         bigint      not null,
  source          text        not null check (source in ('broadcast', 'link')),
  step            text        not null default 'interest' check (step in (
                    'interest', 'skipped', 'consent', 'declined', 'attend',
                    'days', 'later', 'time', 'done', 'later_done')),
  last_msg_id     bigint,
  asked_at        timestamptz not null default now(),
  blocked_at      timestamptz,

  name            text,
  username        text,
  consent_at      timestamptz,
  consent_version text,

  attend          text        check (attend in ('come', 'later')),
  days            date[]      not null default '{}',
  weekdays        smallint[]  not null default '{}',
  time_q          text        check (time_q in ('all', 'wd', 'we')),
  wd_from         text        check (wd_from ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  wd_to           text        check (wd_to ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  wd_any          boolean     not null default false,
  wd_raw          text        check (length(wd_raw) <= 500),
  we_from         text        check (we_from ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  we_to           text        check (we_to ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  we_any          boolean     not null default false,
  we_raw          text        check (length(we_raw) <= 500),
  fail_count      smallint    not null default 0,
  finished_at     timestamptz,
  reminded_at     timestamptz,

  result_id          bigint   references public.club_survey_results (id) on delete set null,
  result_variant     text     check (result_variant in ('match', 'nomatch')),
  result_msg_id      bigint,
  result_sent_at     timestamptz,
  result_answer      text     check (result_answer in ('yes', 'no')),
  result_answered_at timestamptz,
  eve_result_id      bigint   references public.club_survey_results (id) on delete set null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  primary key (survey_key, chat_id),

  -- Без согласия — ни имени, ни ответов.
  constraint club_survey_responses_consent_gate check (
    consent_at is not null or (
      name is null and username is null and attend is null
      and days = '{}' and weekdays = '{}'
      and wd_from is null and wd_to is null and wd_raw is null and not wd_any
      and we_from is null and we_to is null and we_raw is null and not we_any
      and result_id is null and result_answer is null
    )
  ),
  -- Дни недели для «Присоединюсь позже»: JS getDay, Вс=0…Сб=6.
  constraint club_survey_responses_weekdays_range check (
    weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  )
);

comment on table public.club_survey_responses is
  'Ответы на опрос клуба в боте мероприятий: шаг сценария, ответы и отметки рассылок. Пишет и читает lib/clubs/survey-store.ts';
comment on column public.club_survey_responses.chat_id is
  'Telegram chat_id участника (личный чат с ботом)';
comment on column public.club_survey_responses.source is
  'Откуда пришёл: broadcast — рассылка /surveysend, link — ссылка t.me/<бот>?start=<payload>';
comment on column public.club_survey_responses.step is
  'Шаг сценария docs/club-survey.md: skipped — «Пока пропущу», declined — «Посмотрю итог в чате», later_done — завершил веткой «Присоединюсь позже»';
comment on column public.club_survey_responses.last_msg_id is
  'Сообщение бота с активными кнопками — с него снимаем кнопки при следующем шаге';
comment on column public.club_survey_responses.asked_at is
  'Первое сообщение опроса; от него считаются 24 часа до напоминания';
comment on column public.club_survey_responses.blocked_at is
  'Telegram ответил 403 (бот заблокирован) — больше не пишем';
comment on column public.club_survey_responses.consent_at is
  'Нажал «Даю согласие»; consent_version — LEGAL_VERSION из lib/legal.ts на этот момент';
comment on column public.club_survey_responses.days is
  'Выбранные даты-кандидаты первой встречи (ветка «Приду»)';
comment on column public.club_survey_responses.weekdays is
  'Удобные дни недели (ветка «Присоединюсь позже»), JS getDay: Вс=0…Сб=6';
comment on column public.club_survey_responses.time_q is
  'Какой вопрос о времени задан сейчас: all — один общий, wd — про будни, we — про выходные';
comment on column public.club_survey_responses.fail_count is
  'Неудачные попытки разбора времени подряд на текущем вопросе; на второй сохраняем текст как есть';
comment on column public.club_survey_responses.reminded_at is
  'Когда ушло напоминание незавершившим — оно одно';
comment on column public.club_survey_responses.result_id is
  'Какая версия итога ушла человеку; меньше действующей — пора прислать исправление';
comment on column public.club_survey_responses.result_variant is
  'match — день и время итога совпали с ответами (текст 8), nomatch — остальным с согласием (текст 9)';
comment on column public.club_survey_responses.result_answer is
  'Ответ на итог: yes — «Буду»/«Приду», no — «Планы поменялись»/«В этот раз пропущу»';
comment on column public.club_survey_responses.eve_result_id is
  'По какой версии итога ушло напоминание накануне';

-- Выборки идут по одному опросу, строк — сотни: первичный ключ (survey_key —
-- префикс) их покрывает, отдельных индексов не заводим.

alter table public.club_survey_results enable row level security;
alter table public.club_survey_responses enable row level security;

-- Политик нет: пишет и читает только service_role через бота.

-- Supabase выдаёт anon и authenticated гранты на объекты public-схемы по
-- умолчанию. Здесь связка «телеграм-чат ↔ ответы» — снимаем, как в 034.
revoke all on table public.club_survey_results from anon, authenticated;
revoke all on table public.club_survey_responses from anon, authenticated;
