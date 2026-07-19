# НИКА

Ментальный ИИ-ассистент для бегунов-любителей. НИКА — эмпатичный собеседник,
который помогает не бросить бег. Она **не** даёт тренировочные планы, не
анализирует темп и не рекомендует питание.

## Стек

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS (дизайн-система НИКИ в `tailwind.config.ts`)
- Supabase (БД, авторизация)
- Anthropic API (диалог)

## Запуск

```bash
npm install
cp .env.local.example .env.local   # заполнить ключи
npm run dev
```

Открыть http://localhost:3000.

## Структура

```
app/                страницы и роуты (App Router)
  api/chat/         POST-эндпоинт диалога с НИКОЙ
components/         переиспользуемые компоненты
  ui/               атомарные (Button, Card, Input)
hooks/              кастомные хуки
lib/                supabase, anthropic, prompts, scenarios, utils
types/              user, conversation, subscription
```

## Сценарии НИКИ

`morning` · `after_run` · `after_skip` (самый важный) · `pre_race` · `after_failure`

Системные промпты — в `lib/prompts.ts`, метаданные для UI — в `lib/scenarios.ts`.

## Telegram-бот

Бот работает **через webhook внутри Next-приложения** (роут
`app/api/telegram/webhook`), отдельного always-on polling-процесса больше нет.
Композер бота (создание `Bot` + хендлеры) — в `lib/telegram/`, сессии grammY
хранятся в БД (`tg_sessions`), а не в памяти.

- **Установка вебхука** (один раз после деплоя):
  `curl -H "x-cron-secret: $CRON_SECRET" https://<app>/api/telegram/set-webhook`
- **Локальная разработка** (webhook недоступен без туннеля): `npm run bot:dev` —
  поднимает тот же бот через long-polling.
- **Env:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`,
  `CRON_SECRET`, плюс Supabase service-role и `ANTHROPIC_API_KEY`.
- Каталог `bot/` (старый polling) **ретайрнут** — его npm-скрипты выводят
  предупреждение и не поднимают бота.

## Приватность Telegram-бота (152-ФЗ, чек-лист)

Сверка перед релизом проактивных сообщений (спека §5.5, §10, §13):

- ✅ **Явный opt-in зафиксирован.** Согласие берётся кнопкой после привязки,
  момент фиксируется в `tg_bindings.tg_opt_in_at`. Без `tg_opt_in=true` бот не
  инициирует сообщения (единый гейт `canReceiveBotMessages`).
- ✅ **Отключение доступно в любой момент.** Команда `/stop` (opt-in выкл, связку
  не рвёт) и отвязка `/api/telegram/unlink` (связку рвёт). В профиле — кнопки
  «Отключить/Переподключить Telegram» и «Тихий режим».
- ✅ **Данные цикла не покидают приложение и не попадают в текст.** Фаза читается
  только как внутренний дефолт (`getPhaseEnergyHint`, read-only `rhythm_cycles`),
  субъективный ответ приоритетнее; ни фаза, ни слово «цикл» в сообщениях не
  появляются (проверяется тестами `checkin-copy.test.ts`, `recommend.test.ts`).
- ✅ **Тихий режим.** `notification_prefs.quiet_mode` — короткие безэмодзи-тексты,
  безлико на локскрине.
- ✅ **Метрики без PII.** События (`tg_linked`, `tg_opt_in`, `checkin_sent`,
  `checkin_answered`, `tg_unlinked`, `password_reset_sent`) шлют только
  структурные свойства (enum ответа, причина, канал). Email/имя/тексты/токены/
  chat_id в события и логи не попадают (`lib/track-server.ts`).
- ⚠️ **Формулировка согласия — требует ревью юристом.** Текст в
  `CONSENT_PROMPT`/`CONSENT_VERSION` (`lib/telegram/linking.ts`) нужно сверить с
  privacy-политикой сайта (`components/legal/PrivacyContent.tsx`). Политику в коде
  этой задачей не меняем.

## Заметки

- **Шрифты.** Cormorant Garamond — через `next/font/google`. Geist/Geist Mono —
  через официальный пакет `geist` (в `next/font/google` для Next.js 14 шрифта
  Geist нет). Все три — латиница; кириллица рендерится через фолбэк-цепочку
  (`Georgia` / `Inter` / системный). Если нужна кириллица в самих заголовках —
  заменить Cormorant на серифный шрифт с кириллическим набором.
- **Дизайн-токены** продублированы в `tailwind.config.ts` и
  `app/globals.css` — держать значения синхронными.
```
