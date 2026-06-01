# Промпт для Claude Code: Страница «Журнал пробежек»

## Контекст проекта

Next.js 14 + TypeScript + Tailwind CSS. Это приложение НИКА — AI-собеседник для бегунов-любителей.

Стек:
- `app/` роутер (Next.js App Router)
- Tailwind CSS для стилей
- Шрифт: system-ui / -apple-system (межсистемный, без импорта)
- Типы Scenario уже есть в `@/types/conversation`

---

## Задача

Создай страницу **Журнал пробежек** (`app/journal/page.tsx`) с полным десктопным и мобильным лейаутом, поддержкой светлой и тёмной темы.

Также создай компоненты:
- `components/layout/Sidebar.tsx` — боковая панель (десктоп)
- `components/layout/MobileHeader.tsx` — шапка для мобильного
- `components/journal/RunCard.tsx` — карточка одной пробежки
- `components/journal/WeekStats.tsx` — статистика недели
- `components/journal/WeekDayBar.tsx` — строка дней недели с индикаторами

---

## Цветовая палитра

```css
/* Светлая тема */
--bg-base: #EFE7D7;          /* тёплый бежевый, фон всего приложения */
--bg-card: #FFFFFF;          /* карточки пробежек */
--bg-sidebar: #EFE7D7;       /* сайдбар — тот же бежевый */
--text-primary: #1F1B16;     /* основной тёмно-коричневый текст */
--text-secondary: #8B7355;   /* вторичный: подписи, даты */
--text-muted: #B5A08A;       /* совсем приглушённый: темп в карточках */
--accent: #C8553D;           /* терракотовый — активные элементы, акцент */
--sidebar-active-bg: #1F1B16;/* фон активного пункта сайдбара */
--sidebar-active-text: #EFE7D7;
--border: #D9CEBC;           /* разделители, рамки карточек */
--separator-bg: #E5DDD0;     /* фон строки «4 дня перерыв» */

/* Тёмная тема */
--bg-base-dark: #1A1714;
--bg-card-dark: #2A2520;
--bg-sidebar-dark: #1A1714;
--text-primary-dark: #F0E8DA;
--text-secondary-dark: #9A8B78;
--text-muted-dark: #6B5E4E;
--accent-dark: #C8553D;      /* акцент одинаковый в обеих темах */
--sidebar-active-bg-dark: #F0E8DA;
--sidebar-active-text-dark: #1A1714;
--border-dark: #3A342C;
--separator-bg-dark: #252019;
```

---

## Лейаут (Desktop, ≥768px)

```
┌─────────────────┬──────────────────────────────────┐
│   SIDEBAR       │   MAIN CONTENT                   │
│   ~280px fixed  │   flex-1, scrollable             │
└─────────────────┴──────────────────────────────────┘
```

### Sidebar (десктоп)

**Шапка:**
- Строка с аватаром (круг 36px, тёплый лосось/розовый `#E8977A`) и текстом **«НИКА»** жирным, ~20px
- Отступ: px-4 pt-5 pb-3

**Кнопка «+ Новый разговор»:**
- Полная ширина, высота ~44px
- Светлая тема: фон белый, рамка `--border`, текст `--text-primary`
- Тёмная тема: фон `--bg-card-dark`, рамка `--border-dark`
- Скругление: 10px
- Иконка «+» слева

**Навигация** (mt-3, gap-0.5):
Иконка + текст, высота строки ~40px, скруглённый px-3 py-2.
Пункты: Сегодня, День 1, Трекинг, Журнал *(активный)*, Аналитика, Манифест, Пуши

Активный пункт:
- Светлая: `bg-[#1F1B16] text-[#EFE7D7]`
- Тёмная: `bg-[#F0E8DA] text-[#1A1714]`
- Скруглён: rounded-xl

Иконки (используй из lucide-react):
- Сегодня → `MessageCircle`
- День 1 → `Clock`
- Трекинг → `TrendingUp`
- Журнал → `BarChart2` (или `BookOpen`)
- Аналитика → `BarChart`
- Манифест → `BookMarked`
- Пуши → `Bell`

**PRO-блок** (mt-auto):
```
△ PRO          [Free + 7 дней]
```
- Треугольник/логотип слева, текст PRO, справа бейдж `Free + 7 дней` — небольшой rounded-full, фон акцент/10%, текст акцент

**Настройки** — строка с иконкой User + текст

**«Тёмная тема»** — строка с иконкой Moon + текст + тогл (pill toggle, ON = фон #1F1B16 / OFF = фон transparent)

**Нижний блок — сегодняшние диалоги:**
```
СЕГОДНЯ — ДИАЛОГИ            ← uppercase, text-xs, muted, mt-4 mb-1
● Утром перед тренировкой    8:14
● После 4 дней перерыва      сейчас
```
- Оранжевая точка = активный диалог (`bg-orange-400`)
- Серая точка = завершённый

```
ЭТА НЕДЕЛЯ                  ← такой же заголовок раздела
```
(список диалогов этой недели — ниже, в той же стилистике)

---

## Main Content — Журнал

### Заголовок блока
```
Бег                    ← font-bold, ~22px, text-primary
журнал пробежек        ← text-sm, text-secondary, mt-0.5
```
Разделитель (border-bottom) под заголовком.

### Блок «Эта неделя»
```
Эта неделя            ← font-bold ~18px, mt-6
Три пробежки. Хороший ритм.   ← text-sm text-secondary mt-1
```

**Три статы** (mt-4, flex gap-8):
```
3          12.4        1ч 18
РАЗА       КМ         ВРЕМЯ
```
- Число: font-bold text-3xl (~36px), text-primary
- Подпись: text-xs uppercase tracking-widest text-secondary, mt-0.5

### Список пробежек (mt-5)

Каждая карточка — белый (светлая) / тёмная карточка с рамкой.
Скруглённая: rounded-xl, тень лёгкая в светлой теме.

Структура карточки:
```
┌─────────────────────────────────────────────────────┐
│  12        4.2 км · 28 мин · легко       6:40   ›  │
│  МАЙ  «сегодня было тяжело первые 10 минут»  /КМ   │
└─────────────────────────────────────────────────────┘
```

Детали:
- **Дата**: число жирное ~28px, под ним месяц uppercase text-xs text-secondary. Ширина ~48px, flex-shrink-0
- **Контент** (flex-1):
  - Верхняя строка: `4.2 км · 28 мин · легко` — font-medium text-sm text-primary
  - Нижняя строка: `«сегодня было тяжело первые 10 минут»` — text-xs italic text-secondary, mt-0.5
- **Темп** (text-right, flex-shrink-0):
  - `6:40` — font-medium text-sm text-muted (светло-коричневый)
  - `/КМ` — text-[10px] text-muted, display block
- **Стрелка** `›` — text-muted ml-2

Интенсивность в тексте карточки:
- «легко» / «средне» → обычный цвет
- «тяжело» → можно чуть темнее, без особого выделения

**Разделитель «4 дня перерыв»:**
```jsx
<div className="...">— 4 дня перерыв —</div>
```
- `text-xs text-secondary text-center py-2 my-1`
- Светлая: `bg-[#E5DDD0]` между карточками (не карточка, просто строка)

### Данные для журнала (mock)

```ts
const runs = [
  {
    id: '1',
    date: 12,
    month: 'МАЙ',
    distance: '4.2',
    duration: '28 мин',
    intensity: 'легко',
    quote: 'сегодня было тяжело первые 10 минут',
    pace: '6:40',
  },
  {
    id: '2',
    date: 10,
    month: 'МАЙ',
    distance: '3.5',
    duration: '24 мин',
    intensity: 'средне',
    quote: 'первый раз без остановок!',
    pace: '6:51',
  },
  {
    id: '3',
    date: 8,
    month: 'МАЙ',
    distance: '4.7',
    duration: '31 мин',
    intensity: 'легко',
    quote: 'дождь, но было даже хорошо',
    pace: '6:36',
  },
  // --- разрыв 4 дня ---
  {
    id: '4',
    date: 3,
    month: 'МАЙ',
    distance: '2.8',
    duration: '22 мин',
    intensity: 'тяжело',
    quote: 'колено побаливало, остановился пораньше',
    pace: '7:51',
    gapBefore: '4 дня перерыв',
  },
];
```

---

## Мобильный лейаут (< 768px)

Сайдбар скрыт. Вверху MobileHeader.

### MobileHeader
```
‹   Журнал              14 дней
```
- `‹` — кнопка назад (ChevronLeft из lucide)
- «Журнал» — по центру, font-semibold
- «14 дней» — справа, text-sm text-secondary

### Блок «Эта неделя» (мобиль)

```
ЭТА НЕДЕЛЯ            ← text-xs uppercase tracking-wider text-secondary
Три пробежки.         ← font-bold text-3xl text-primary
Хороший ритм.         ← font-bold text-3xl italic text-[#C8553D]
```

**Три статы** (карточки, mt-4):
```
┌──────────┬──────────┬──────────┐
│    3     │  12.4 КМ │  1.18    │
│ПРОБЕЖКИ  │  ВСЕГО   │В ДВИЖЕНИИ│
└──────────┴──────────┴──────────┘
```
- Единый скруглённый блок (rounded-2xl) с тремя колонками
- Светлая: `bg-[#E5DDD0]`, тёмная: `bg-[#2A2520]`
- Число жирное ~28px, подпись text-[10px] uppercase tracking-wider text-secondary

**WeekDayBar** (mt-4):
```
ПН  ВТ  СР  ЧТ  ПТ  СБ  ВС
━━  ━━  ━━  ━━  ━   ━   ╌╌
```
- Активные дни (ПН, СР, ПТ): яркая терракотовая линия `bg-[#C8553D]` h-1.5 rounded-full
- Частично активные: светло-розовая линия `bg-[#C8553D]/40`
- Текущий (ВС): пунктирная рамка `border border-dashed border-[#C8553D]` bg-transparent h-1.5
- Подпись дня: text-[10px] text-secondary под линией

**Секция «МАЙ · 2026»:**
```
МАЙ · 2026        ← text-xs text-secondary uppercase tracking-wider, mt-4 mb-2
```

Карточки — такие же как на десктопе, но без тени, с border.

---

## Tailwind конфиг

Добавь в `tailwind.config.ts` кастомные цвета:

```ts
colors: {
  nika: {
    bg: '#EFE7D7',
    'bg-dark': '#1A1714',
    card: '#FFFFFF',
    'card-dark': '#2A2520',
    text: '#1F1B16',
    'text-dark': '#F0E8DA',
    secondary: '#8B7355',
    muted: '#B5A08A',
    accent: '#C8553D',
    border: '#D9CEBC',
    'border-dark': '#3A342C',
  }
}
```

---

## Тёмная тема

Используй `dark:` Tailwind-префикс. В `app/layout.tsx` добавь `darkMode: 'class'` в tailwind.config и переключай класс `dark` на `<html>`.

Основные правила:
- `bg-[#EFE7D7] dark:bg-[#1A1714]` — фон
- `bg-white dark:bg-[#2A2520]` — карточки
- `text-[#1F1B16] dark:text-[#F0E8DA]` — основной текст
- `border-[#D9CEBC] dark:border-[#3A342C]` — рамки

---

## Важные детали

1. Карточки пробежек кликабельны (cursor-pointer, hover: легкое затемнение)
2. Сайдбар фиксирован по высоте (`h-screen sticky top-0`), скроллится только main
3. На мобильном нет сайдбара, только MobileHeader
4. Лейаут: `flex flex-row h-screen overflow-hidden` на десктопе
5. Main area: `overflow-y-auto flex-1`
6. Аватар НИКИ: просто круглый div с инициалами или gradient `from-[#E8977A] to-[#C8553D]`
