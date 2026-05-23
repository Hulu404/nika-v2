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

## Заметки

- **Шрифты.** Cormorant Garamond — через `next/font/google`. Geist/Geist Mono —
  через официальный пакет `geist` (в `next/font/google` для Next.js 14 шрифта
  Geist нет). Все три — латиница; кириллица рендерится через фолбэк-цепочку
  (`Georgia` / `Inter` / системный). Если нужна кириллица в самих заголовках —
  заменить Cormorant на серифный шрифт с кириллическим набором.
- **Дизайн-токены** продублированы в `tailwind.config.ts` и
  `app/globals.css` — держать значения синхронными.
```
