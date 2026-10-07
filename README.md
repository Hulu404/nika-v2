# НИКА

НИКА — русскоязычный ментальный ИИ-ассистент для бегунов-любителей. Приложение помогает поддерживать привычку бегать, возвращаться после пропусков, вести журнал пробежек и замечать своё состояние.

В репозитории находятся веб-приложение, лендинги кофе-ранов, три Telegram-бота, SQL-миграции Supabase, интеграции оплаты и уведомлений. Это один Next.js-проект: API и production-вебхуки работают в том же приложении.

README описывает код на момент изучения **30 сентября 2026 года**. Исторические документы и комментарии отдельных файлов местами отличаются от текущей реализации.

## Возможности и страницы

| Маршрут | Назначение |
| --- | --- |
| `/` | Гость видит `public/landing.html` через middleware rewrite. Вошедший пользователь после онбординга попадает на `/day1` в первые 24 часа или на `/today` позже. |
| `/auth`, `/signup` | Вход и регистрация через email/password в Supabase Auth; `/signup` переводит на форму регистрации с параметрами промо. |
| `/onboarding` | Чат-знакомство: имя, форма обращения, при необходимости учёт цикла, согласие на инициативные сообщения. |
| `/day1`, `/today` | Первый день и основной экран: разговоры, пробежки, статистика недели, серия дней, цитата, спринт. |
| `/chat`, `/chat/[scenario]` | Последний диалог либо выбранный сценарий, история и потоковый ответ НИКИ. |
| `/journal` | Добавление, редактирование и удаление пробежек: дистанция, длительность, интенсивность и заметка. |
| `/analytics` | Наблюдения за 14 дней: интенсивность пробежек, частые слова и паттерны. При активном спринте переводит на `/sprint`. |
| `/sprint`, `/sprint/setup` | PRO-спринт на 21 день: опрос, архетип, цель, ориентиры, недельный фокус, советы и рефлексия. |
| `/rhythm` | «Мой ритм»: цикл, ежедневные отметки и советы. Видимость задаёт `showRhythm()` в `lib/profile.ts`. |
| `/tips` | Базовые советы для FREE и персональные сохранённые советы для PRO. |
| `/meditations` | Пока страница-заглушка будущего раздела. |
| `/profile` | Профиль, тема, настройки уведомлений и подключение Telegram. |
| `/upgrade`, `/payment/success`, `/payment/fail` | Предложение PRO и страницы результата оплаты. |
| `/install` | Инструкции установки PWA. |
| `/forgot-password`, `/auth/callback`, `/auth/confirm` | Восстановление доступа и обработка ссылок Supabase. См. ограничение `/reset-password` ниже. |
| `/activate`, `/s/[code]`, `/admin/qr` | Активация промо, переходы по QR-кодам и управление QR. |
| `/manifesto`, `/landing` | Манифест и переход на публичный лендинг. |
| `/coffeerunsurfsport`, `/coffeerunluzhniki` | Лендинги записи на кофе-раны. |
| `/start` | Приложение NIKA (public/app/index.html): вход, регистрация и онбординг; для вошедших оно же на `/`. |

Интерфейс адаптирован под мобильный экран и десктоп: нижняя навигация, боковое меню, панели, светлая и тёмная темы, обработка клавиатуры и safe-area. Шрифты — Fraunces и Geist. Токены темы находятся в `app/globals.css`, Tailwind ссылается на CSS-переменные.

## Стек и архитектура

| Слой | Технологии в репозитории |
| --- | --- |
| Веб и сервер | Next.js **14.2.35**, App Router, React **18.3.1**, TypeScript |
| Стили | Tailwind CSS 3, PostCSS, `clsx`, `tailwind-merge` |
| Данные и авторизация | Supabase PostgreSQL, Auth, RLS, `@supabase/ssr` |
| Генерация текста | Anthropic SDK; чат — `claude-sonnet-4-6`, советы ритма и спринта — `claude-haiku-4-5-20251001` |
| Telegram | grammY, auto-retry, webhook в production, polling для разработки |
| Оплата | Robokassa, серверная проверка подписи |
| PWA | Web App Manifest, Service Worker, `web-push` и VAPID |
| Тесты | Vitest 4, Node-окружение; тесты рядом с исходниками |

Серверные страницы получают данные через Supabase, клиентские компоненты отвечают за интерактивность. Часть пользовательских операций выполняется напрямую через Supabase с RLS: отдельного REST API для каждой сущности нет.

- `lib/supabase.ts` создаёт браузерный клиент и серверный клиент с cookies пользователя. Браузерный экземпляр переиспользуется, чтобы избежать конкурирующего обновления сессии.
- `lib/supabase-server.ts` создаёт серверный service-role клиент, обходящий RLS, для доверенных операций.
- `middleware.ts` обновляет cookies, проверяет вход и онбординг на перечисленных маршрутах, формирует CSP в режиме **Report-Only**. API самостоятельно проверяют доступ.
- `instrumentation.ts` в production регистрирует вебхуки и запускает периодические задачи внутри Node.js-процесса.

```text
app/                    Страницы App Router, API, auth callbacks, QR-переходы
components/             Интерфейс и компоненты разделов
hooks/                  Общие UI-хуки
lib/                    Доменная логика и интеграции
  coffeerun/            Расписание, темп и рассылки кофе-ранов
  telegram/             Бот участников, привязки, уведомления
  team/                 Внутренний бот организаторов
  databot/              Бот данных, доступы, отчёты, справочник, аудит
  rhythm/               Циклы, состояния, контекст и расчёты ритма
  plans/                Квоты тарифов
  tips/                 Категории, сохранение и аналитика советов
public/                 Лендинги, изображения, иконки, manifest и Service Worker
scripts/                Запуск ботов, упаковка HTML, настройка Auth
supabase/migrations/    SQL-схема, политики, функции, индексы и изменения данных
types/                  Типы приложения, диалогов и базы данных
test/stubs/             Подмены для тестового окружения
docs/                   Исторический scope, план безопасности, описание team-бота
prompts/                Спецификации экранов; runtime-промпты находятся в lib/
.github/workflows/      Внешние cron-вызовы через GitHub Actions
```

## Локальный запуск

Нужны Node.js и npm, отдельный Supabase-проект и ключ Anthropic для генерации. Для совместимости с установленным набором Vitest/Vite используйте **Node.js 22.12+ в ветке 22 либо 24+**. В `package.json` версия Node через `engines` не зафиксирована.

1. Установите зависимости: `npm ci`.
2. Если `.env` ещё нет, скопируйте шаблон: PowerShell — `Copy-Item .env.example .env`, Bash — `cp .env.example .env`. Существующий файл не перезаписывайте.
3. Заполните Supabase и Anthropic, задайте `NEXT_PUBLIC_APP_URL=http://localhost:3000`. У неиспользуемых интеграций уберите значения-заглушки.
4. Примените SQL-миграции с учётом порядка ниже. В Supabase Auth настройте Site URL и разрешённые redirect URL для локального адреса, `/auth/callback` и используемых сценариев подтверждения. Подтверждение email зависит от настроек Supabase.
5. Запустите `npm run dev` и откройте `http://localhost:3000`.

Лендинги кофе-ранов доступны на том же сервере; отправка формы требует API и настроенной БД. В PowerShell с запрещённым запуском `npm.ps1` используйте **`npm.cmd`**, например `npm.cmd run dev`.

Next.js читает `.env` и `.env.local`. Основной и командный polling-скрипты через `dotenv/config` читают `.env`, а databot явно читает сначала `.env.local`, затем `.env`.

| Команда | Действие |
| --- | --- |
| `npm run dev` | Сервер разработки Next.js |
| `npm run build` | Production-сборка |
| `npm start` | Запуск собранного приложения |
| `npm run lint` | ESLint через `next lint` |
| `npm test` | Все `*.test.ts` через Vitest |
| `npx tsc --noEmit --incremental false` | Отдельная проверка типов без обновления incremental-кэша |
| `npm run bot:dev` | Основной Telegram-бот через polling |
| `npm run team:dev` | Командный бот через polling |
| `npm run databot:dev` | Бот данных через polling |

## Переменные окружения

Шаблон: [`.env.example`](.env.example). `.env` и `.env*.local` исключены из Git. **`NEXT_PUBLIC_*` попадают в клиентскую сборку и требуют пересборки при изменении.** Серверные ключи нельзя переносить в эту группу.

| Группа | Переменные | Использование |
| --- | --- | --- |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Браузер, серверные страницы, авторизация |
| Сервер БД | `SUPABASE_SERVICE_ROLE_KEY` | Боты, заявки, платежи, cron и доверенные операции |
| ИИ | `ANTHROPIC_API_KEY` | Чат и генерация советов/уведомлений |
| Адрес | `NEXT_PUBLIC_APP_URL` | Ссылки, callback URL, вебхуки; в production — публичный HTTPS URL |
| Основной бот | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | Токен, проверка webhook, username без `@` |
| Командный бот | `TEAM_BOT_TOKEN`, `TEAM_WEBHOOK_SECRET`, `TEAM_BOT_SECRET`, `TEAM_FOUNDER_IDS` | Отдельный бот «Пятница»; ключ входа командой `/join`; Telegram ID фаундеров через запятую |
| Бот данных | `DATABOT_TOKEN`, `DATABOT_WEBHOOK_SECRET`, `DATABOT_OWNER_IDS` | Третий бот; Telegram ID владельцев через запятую |
| Соцсети | `NIKA_TG_CHANNEL` | `@username` Telegram-канала НИКИ: «Пятница» снимает число подписчиков через `getChatMemberCount`. **«Пятницу» нужно добавить в канал администратором без прав на публикацию**, иначе Telegram не отдаст число |
| Служебный доступ | `CRON_SECRET`, `ADMIN_SECRET` | Cron API, QR-админка и административные команды основного бота |
| Robokassa | `ROBOKASSA_MERCHANT_LOGIN`, `ROBOKASSA_PASSWORD_1`, `ROBOKASSA_PASSWORD_2` | Платежи и проверка Result URL |
| Режим оплаты | `ROBOKASSA_IS_TEST`, `ROBOKASSA_HASH_ALGO`, `ROBOKASSA_DEBUG` | Тестовый режим при `1`, хеш по умолчанию `md5`, отладка при `1` |
| Чек | `ROBOKASSA_FISCALIZATION`, `ROBOKASSA_SNO`, `ROBOKASSA_TAX` | Фискализация включена, если не `0`; defaults: `usn_income`, `none` |
| Web-push | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` | Подписка и отправка push; email в формате `mailto:...` |
| Аналитика | `AMPLITUDE_API_KEY` | Опциональные серверные события из `lib/track-server.ts` |
| QR | `IP_HASH_SALT` | Соль хеширования IP; код имеет резервное значение |
| Тестовый Telegram | `TELEGRAM_TEST_ALLOWLIST` | Дополнительные email через запятую для подключения из профиля |
| Управление Auth | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` | Административный скрипт; project ref может выводиться из Supabase URL |

`AMPLITUDE_API_KEY`, `IP_HASH_SALT`, `TELEGRAM_TEST_ALLOWLIST` и `SUPABASE_PROJECT_REF` отсутствуют в шаблоне. `DATABOT_LLM` и `DATABOT_LLM_MODEL` есть в шаблоне, но текущий маршрутизатор databot их не использует.

`node scripts/apply-auth-password-policy.mjs` **меняет удалённые настройки Supabase Auth** через Management API: длину пароля, состав и проверку утечек. Это отдельная административная операция, не обязательный шаг локального запуска.

## База данных и миграции

Схема — [`supabase/migrations/`](supabase/migrations), TypeScript-описание — [`types/database.ts`](types/database.ts). В репозитории нет `supabase/config.toml` и npm-команды применения миграций.

Для чистой базы выполняйте SQL через Supabase SQL Editor с проверкой результата каждого файла:

1. `001_schema.sql` → `018_rhythm_cycles.sql` по числовому префиксу.
2. **Оба** файла `019`: `019_coffee_run_signups.sql` и `019_telegram.sql`.
3. `020_telegram_webhook.sql`, затем `021_notification_log.sql`.
4. **`20240710_sprints.sql` перед `022_sprint_advice.sql`**: советы ссылаются на таблицу `sprints`.
5. `022_sprint_advice.sql` → `047_team_event_facts.sql` по номеру. Префикс `041` тоже занят **двумя** файлами: `041_app_v2.sql` и `041_avatars.sql`.

Лексикографическая сортировка всех файлов нарушает зависимости. Повторяющиеся префиксы `019` и `041` также требуют учёта при использовании Supabase CLI. На существующей базе сначала проверьте применённые изменения: ранние файлы не рассчитаны на повторный запуск.

| Область | Основные таблицы |
| --- | --- |
| Пользователь | `users`, `profiles`, Supabase `auth.users` |
| Чат и ограничения | `conversations`, `rate_limits`; сообщения хранятся JSON в диалоге |
| Бег и спринты | `runs`, `sprints`, `sprint_advice` |
| Советы | `personal_tips`; также существует прежняя `saved_tips` |
| Ритм | `rhythm_cycles`, `rhythm_checkins`, `rhythm_daily_advice`; прежние `daily_state`, `period_marks` |
| Оплата | `subscriptions`, `robokassa_payments` |
| Telegram | `tg_link_tokens`, `tg_bindings`, `tg_sessions`, `processed_updates`, `checkins` |
| Уведомления | `notification_prefs`, `push_subscriptions`, `notification_log`, `notifications_log` |
| Кофе-раны | `coffee_run_signups`, `coffee_run_invites` |
| Промо и атрибуция | `qr_codes`, `qr_scans`, `promo_tokens`, `analytics_events`, `link_codes`, `link_clicks`, `user_attribution` |
| Команда («Пятница») | `team_members`, `team_digests`, `team_events`, `team_event_facts`, `team_event_asks`; задачи — `databot_assigned_tasks` |
| Бот данных | `databot_members`, `databot_invites`, `databot_audit`, `databot_kb`, `databot_run_plans` |

`notification_log` и `notifications_log` — разные таблицы разных механизмов. Старые и новые таблицы ритма также сосуществуют. Миграции задают RLS, триггеры, индексы и функции; простого создания таблиц недостаточно.

## Чат, контекст и тарифы

Сценарии: `general`, `morning`, `after_run`, `after_skip`, `pre_race`, `after_failure`. Метаданные — `lib/scenarios.ts`, системные инструкции — `lib/prompts.ts`.

`components/Chat.tsx` отправляет новую реплику, сценарий, ID диалога и `clientMessageId` в `POST /api/chat`. Сервер проверяет сессию, размер, rate limit и тариф; историю загружает из БД. В контекст добавляются дата, активный спринт и доступные сведения о ритме. В модель передаётся окно до 50 реплик и 24 000 символов; полная история остаётся в БД.

Ответ приходит текстовым потоком с `X-Conversation-Id`. Инструмент `log_run` записывает пробежку, `save_tip` сохраняет совет для PRO. После действия интерфейс показывает ссылку на соответствующий раздел. Завершённый ход сохраняется с количеством входных токенов. Повтор сохранённого `clientMessageId` возвращает готовый ответ.

Единица квоты — до 250 входных токенов **новой реплики**. Длинные реплики расходуют несколько единиц. Суточный расход считается по сохранённым сообщениям; лимит диалогов учитывает разговоры с сегодняшними репликами, включая продолженные старые.

| Уровень | Единиц в сутки | Активных диалогов в сутки | Потолок токенов реплики |
| --- | ---: | ---: | ---: |
| FREE | 20 | 3 | 2 500 |
| PRO | 350 | 6 | 2 500 |
| Premium, заготовка | 1 000, мягкий лимит | Без ограничения | 4 000 |

Источник — `lib/plans/limits-config.ts`. Сейчас `resolveTier()` возвращает только FREE/PRO по `users.is_pro`; Premium ещё не подключён. `FORCE_PRO_FOR_ALL=false`. Дополнительно действуют ограничения 4 000 символов на реплику и 20 запросов за минуту на пользователя.

Ритм использует цикл и чек-ины, спринт — пробежки, цель и наблюдения из разговоров. Часть данных включается в запросы Anthropic: RLS не означает, что контекст остаётся только в Supabase.

## Кофе-раны и статические страницы

Основной конфиг — [`lib/coffeerun/run.ts`](lib/coffeerun/run.ts): `COFFEE_RUNS`, `SPOT_NAMES`, даты, адреса, время и ссылки. Группы темпа — `lib/coffeerun/pace.ts`.

- `spot=usachevo` соответствует `/coffeerunsurfsport`.
- `spot=luzhniki` соответствует `/coffeerunluzhniki`.
- Форма отправляет имя, email, Telegram username, источник, спот, дату и необязательный темп в `POST /api/coffeerun-signup`.
- API нормализует username и определяет мероприятие по серверному конфигу. При устаревшей дате страницы ориентируется на спот.
- Заявка сохраняется в `coffee_run_signups`; повтор для того же username, спота и даты обновляет запись.
- Ответ содержит `confirmUrl` вида `https://t.me/<bot>?start=cr_<token>`. Основной бот подтверждает заявку и связывает её с Telegram.
- Напоминания, приглашения, опросы и сообщения об изменениях находятся в `lib/coffeerun/` и `lib/telegram/`.

### Редактирование лендингов

Оба `public/coffeerun*/index.html` — самораспаковывающиеся HTML-бандлы с manifest ресурсов и JSON-строкой `__bundler/template`. Используйте скрипт:

```sh
node scripts/coffeerun-landing.mjs extract surfsport page.html
# Отредактировать page.html
node scripts/coffeerun-landing.mjs pack surfsport page.html
```

Для Лужников замените `surfsport` на `luzhniki`. Аргумент скрипта **`surfsport`**, а спот в БД **`usachevo`**. `pack` проверяет обратную распаковку. Временный `page.html` не является исходником приложения и не должен случайно попасть в коммит.

При переносе забега синхронно обновляются `COFFEE_RUNS`, видимые тексты, метаданные и `RUN_DATE`/`RUN_SPOT` внутри шаблона. Конфиг сам не пересобирает HTML. Поддерживайте хронологический порядок массива и убирайте прошедшие события из активного расписания.

```sh
npm test -- lib/coffeerun/landing.test.ts lib/coffeerun/run.test.ts
```

`public/landing.html` — гостевая главная, `public/landing-v2.html` — отдельная версия. `public/authv1/` содержит прототип со своим manifest и иконками; ему заданы `noindex` и `no-store`. Корневые `index.html` и `НИКА - прототип (1).html` — отдельные макеты, не страницы App Router. Бренд и схемы маршрутов — в `public/brand/`.

## Telegram-боты

| Бот | Код | Production webhook | Локальный запуск |
| --- | --- | --- | --- |
| Участников | `lib/telegram/` | `/api/telegram/webhook` | `npm run bot:dev` |
| Организаторов | `lib/team/` | `/api/telegram/team-webhook` | `npm run team:dev` |
| «Цифры команды» | `lib/databot/` | `/api/telegram/databot-webhook` | `npm run databot:dev` |

Каждому нужен отдельный токен BotFather и webhook secret. Вебхуки регистрируются из `instrumentation.ts`; основной можно установить через защищённый `GET /api/telegram/set-webhook`. Входящие запросы проверяются по секрету, обработанные update ID хранятся в БД.

**Основной бот** подтверждает кофе-раны, отправляет уведомления, обрабатывает привязку аккаунта, `/stop`, восстановление доступа и административные операции мероприятий. Свободного ИИ-диалога в обработчике нет: разговор с НИКОЙ ведётся в веб-приложении. Подключение уведомлений из профиля ограничено allowlist в `lib/telegram/allowlist.ts`.

**Командный бот «Пятница»** — один бот на всю команду: задачи (`/tasks`, `/assign`), расписание (`/schedule`, `/event`), ивенты клубов (`/events`: цифры кофе-ранов, участники, рассылка, явка), соцсети (`/social`: подписчики Telegram и Instagram, переходы по меткам, ввод Instagram), команда (`/team`) и быстрые ответы (`/faq`), плюс сводка дня в 8:00 МСК (`/mute` выключает). Фаундерам «Пятница» присылает сводку команды в 10:00 и 22:30 МСК; в 21:00 снимает Telegram-канал и спрашивает число подписчиков Instagram. Вход — `/join <ключ>` с `TEAM_BOT_SECRET`. Права у всех равные; фаундеры из `TEAM_FOUNDER_IDS` (без неё — `DATABOT_OWNER_IDS`) дополнительно видят и меняют все задачи, убирают людей (`/kick`), правят любое событие и исправляют явку. Участник видит только свои задачи. Миграции v2: `045`–`049`. Подробнее: [`docs/team-bot.md`](docs/team-bot.md).

**Бот данных** — только аналитика: роли и зоны доступа, приглашения, справочник, аудит, формы и отчёты; задачи команды живут в «Пятнице». Включены «Забеги», «Справочник», «Команда», для зоны «Совет» — «Про и оплаты» и «Продукт» с выбором периода. Сводка фаундерам и соцсети живут в «Пятнице», не здесь. Произвольный текст ищется в справочнике через `router/interim.ts`; полноценный LLM-разбор ещё не подключён. Команды и трактовка показателей описаны в [docs/databot.md](docs/databot.md).

Для polling используйте **тестовых ботов**: запуск снимает webhook этого токена и может отключить production-бота. У databot есть дополнительная проверка production-webhook, у остальных скриптов её нет. В `next dev` production-тикер не запускается.

## Оплата и промокоды

`POST /api/robokassa/create-payment` создаёт заказ в `robokassa_payments` и подписанную ссылку. Callback `/api/robokassa/result` проверяет подпись и активирует доступ. Сам переход на `/payment/success` не подтверждает оплату.

В интеграции используются Result URL `/api/robokassa/result`, Success URL `/payment/success`, Fail URL `/payment/fail` на публичном домене. Алгоритм хеша и пароли должны совпадать с настройками магазина.

| План API | Сумма в `lib/robokassa.ts` | Выдаваемый период |
| --- | ---: | --- |
| `monthly` | 299 ₽ | 1 месяц |
| `halfyear` | 1 490 ₽ | 6 месяцев |
| `pro` | 1 ₽ | Временно 1 месяц |

Название предложения `pro` говорит о первой неделе, но код выдаёт месяц. Автопродление за 249 ₽/месяц **не реализовано**.

QR-поток: `/s/[code]` → `/activate` и API `/api/promo/*`. QR-админка использует `ADMIN_SECRET`. Истечение PRO выполняет `POST /api/cron/expire-subscriptions`; его нужно подключить к внешнему ежедневному расписанию.

## Уведомления и фоновые задачи

PWA использует `public/site.webmanifest`, `public/sw.js` и `components/install/`. Service Worker показывает push и открывает страницу по нажатию; полного offline-кэширования приложения нет.

| Задача | Запуск | Расписание / поведение |
| --- | --- | --- |
| Регистрация webhook | `instrumentation.ts` | При старте production Node.js-процесса |
| Напоминания кофе-ранов | Тикер `instrumentation.ts` | Сразу и каждые 15 минут; окно отправки накануне с 10:00 МСК |
| Приглашения кофе-ранов | Тот же тикер | Каждые 15 минут; окно по понедельникам с 10:00 МСК |
| Сводка дня «Пятницы» и вопрос о явке | Тот же тикер | Сводка в 8:00 МСК (догоняет до 12:00), вопрос о явке через 3 часа после ивента клуба; `lib/team/digest.ts` |
| Сводка фаундерам и соцсети | Тот же тикер | «Пятница»: сводка фаундерам в 10:00 и 22:30 МСК, снимок Telegram-канала и вопрос про Instagram в 21:00; `lib/team/founders/` |
| Напоминания по задачам «Пятницы» | Тот же тикер | За 24, 12 и 3 часа до срока и при просрочке; `lib/databot/assigned-reminders.ts` |
| Очистка databot | Тот же тикер | Суточная очистка после 04:00 МСК по правилам `lib/databot/cleanup.ts` |
| Web-push | `GET /api/push/send` | `vercel.json` и GitHub workflow: 05:00 и 14:00 UTC |
| Утреннее сообщение Telegram | `GET /api/telegram/notifications/morning` | `vercel.json`: каждые 15 минут; получателей выбирает обработчик |
| Старые чек-ины | `GET /api/cron/checkins` | GitHub workflow каждый час, но обработчик уже заглушка и ничего не отправляет |
| Истечение подписок | `POST /api/cron/expire-subscriptions` | Расписания в репозитории нет |
| Опрос кофе-рана | `GET /api/cron/coffeerun-poll` | Отдельный защищённый вызов; в тикер не включён |

Для reminders и invites также есть cron API. Большинство cron-обработчиков принимает `Authorization: Bearer <CRON_SECRET>` или `x-cron-secret`; **expire-subscriptions принимает только `x-cron-secret` и POST**.

На Railway `vercel.json` не управляет расписанием. GitHub workflow используют variable `PUSH_CRON_URL` и secret `CRON_SECRET` из настроек репозитория. Отдельного GitHub workflow утренних Telegram-сообщений нет: вне Vercel нужен свой планировщик. Внутренний `setInterval` требует постоянно работающего процесса и не заменяет внешний cron в serverless-среде.

## API

| Группа | Маршруты |
| --- | --- |
| Чат и квота | `/api/chat`, `/api/usage` |
| Auth | `/api/auth/register`, `/api/auth/forgot` |
| Советы | `/api/rhythm/advice`, `/api/sprint/advice` |
| Заявки | `/api/coffeerun-signup` |
| Привязка Telegram | `/api/telegram/link`, `/api/telegram/unlink` |
| Webhook | `/api/telegram/webhook`, `/api/telegram/team-webhook`, `/api/telegram/databot-webhook` |
| Push и настройки | `/api/push/subscribe`, `/api/notifications/prefs`, `/api/notifications/opened`, `/api/prefs/quiet` |
| Платежи | `/api/robokassa/create-payment`, `/api/robokassa/result` |
| Промо | `/api/promo/click`, `/api/promo/issue`, `/api/promo/redeem` |
| Служебные задачи | `/api/cron/*`, `/api/push/send`, `/api/telegram/notifications/morning`, `/api/telegram/set-webhook` |

Методы, тела запросов и доступ определены в соответствующих `route.ts`. Машинные webhook/cron не проходят пользовательские редиректы middleware. Основные AI-маршруты используют Node.js runtime, API заявки кофе-рана — Edge runtime.

## Проверки и развёртывание

```sh
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
```

**`next build` игнорирует ошибки TypeScript и ESLint** через `ignoreBuildErrors` и `ignoreDuringBuilds`. Успешная сборка не заменяет отдельные проверки.

Vitest проверяет чат, лимиты, журнал, спринты, расписания, Telegram-тексты и обработчики, кофе-раны, доступы и отчёты databot. Alias `@/` соответствует корню, `server-only` заменяется пустым модулем. Браузерного E2E-набора нет.

Production требует применённых миграций, окружения, HTTPS URL, Auth redirect URL и платёжных callbacks. Запуск: `npm ci`, `npm run build`, `npm start`. `next/font/google` загружает Fraunces при сборке, поэтому нужен сетевой доступ.

Запуск production с настоящими токенами регистрирует webhook и запускает фоновые задачи. Для локальной проверки используйте отдельное окружение. Статический экспорт не заменяет сервер: нужны API, SSR, webhook и БД.

При подготовке README выполнен `npm.cmd test -- --reporter=dot`: **995 тестов прошли, 6 упали; 52 файла прошли, 3 упали**. Production-сборка, реальные платежи, рассылки и миграции в рамках этой работы не выполнялись.

## Текущее состояние и ограничения

- **Расписание и лендинг расходятся.** В `COFFEE_RUNS` Усачёва назначена на `2026-10-04`, но `RUN_DATE` внутри шаблона `public/coffeerunsurfsport/index.html` равен `2026-09-19`. Массив содержит сначала 4 октября, затем 20 сентября, нарушая порядок. Это даёт три падения в `lib/coffeerun/landing.test.ts` и `lib/coffeerun/run.test.ts`.
- **Прошедшие события остаются в конфиге.** Лужники датированы `2026-09-20`. Выбор имеет fallback на прошедший забег; старая дата сама не закрывает заявки.
- **Восстановление пароля неполное.** Код формирует ссылки на `/reset-password`, но соответствующей страницы в `app/` нет.
- **Незавершённые разделы.** Медитации — заглушка, часть databot отключена, Premium только задан в конфиге.
- **Оплата требует согласования с предложением.** План за 1 ₽ выдаёт месяц, рекуррентное продление отсутствует. Cron истечения подписок нужно настроить отдельно.
- **Аналитика подключена неоднородно.** GA4 и Яндекс Метрика имеют ID прямо в `components/analytics/`; `lib/track.ts` выводит события только в dev, серверный `trackServer` может отправлять в Amplitude. SQL атрибуции существует, но `/s/[code]` обслуживает QR через `qr_codes`, а не универсальные `link_codes`.
- **Исторические документы устарели.** `docs/v1-scope.md` описывает magic link, ЮKassa и отсутствие журнала/push. Текущий код использует email/password, Robokassa и реализует эти разделы. Часть комментариев также относится к прежним версиям.

## Навигация для разработки

| Что изменить | Где начать |
| --- | --- |
| Голос, сценарии, инструменты | `lib/prompts.ts`, `lib/scenarios.ts`, `lib/chat-actions.ts`, `lib/tips/save-tip.ts`, `app/api/chat/route.ts` |
| Квоты и PRO | `lib/plans/limits-config.ts`, `lib/limits.ts`, `lib/subscription.ts` |
| Журнал и спринты | `lib/runs.ts`, `lib/sprint.ts`, `lib/sprint-advice.ts`, `components/journal/`, `components/sprint/` |
| Ритм | `lib/rhythm/`, `lib/rhythm.ts`, `components/rhythm/`, `app/api/rhythm/advice/route.ts` |
| Онбординг | `components/onboarding/script.ts`, `components/onboarding/ChatOnboarding.tsx`, `lib/profile.ts` |
| Дизайн и навигация | `app/globals.css`, `tailwind.config.ts`, `components/AppLayout.tsx`, `lib/nav.ts` |
| Кофе-ран | `lib/coffeerun/run.ts`, `lib/coffeerun/pace.ts`, `public/coffeerun*/index.html` |
| Командные инструменты | `lib/team/`, `lib/databot/`, миграции `035`–`037`, `039`, `040`, `043`–`047` |
| Оплата и промо | `lib/robokassa.ts`, `app/api/robokassa/`, `app/api/promo/`, `app/s/[code]/route.ts` |
| Уведомления | `instrumentation.ts`, `lib/notifications.ts`, `lib/telegram/`, `app/api/cron/`, `.github/workflows/`, `vercel.json` |

Дополнительные материалы: [бот команды](docs/team-bot.md), [план безопасности](docs/security-plan.md), [исторический scope v1](docs/v1-scope.md), [SQL метрик утренних сообщений](docs/metrics-morning-nudge.sql), [спецификации экранов](prompts/).
