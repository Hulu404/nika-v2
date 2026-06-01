# Промпт для Claude Code: Страница «Аналитика»

## Контекст

Next.js 14 + TypeScript + Tailwind CSS. Тот же проект НИКА.
Сайдбар (`components/layout/Sidebar.tsx`) уже создан — переиспользуй его, передай `activePage="analytics"`.

---

## Задача

Создай страницу **Аналитика** (`app/analytics/page.tsx`) и компоненты:
- `components/analytics/MoodBarChart.tsx` — столбчатая диаграмма состояния
- `components/analytics/WordCloud.tsx` — облако слов
- `components/analytics/PatternCard.tsx` — карточка паттерна
- `components/analytics/InfoNote.tsx` — информационный блок (мобиль)

---

## Desktop — Main Content

### Шапка страницы

```
14 ДНЕЙ · НАБЛЮДЕНИЯ         ← text-xs uppercase tracking-widest text-[#C8553D], mb-3
Что ты говорила.             ← font-bold text-5xl (~48px) text-primary, leading-tight
Без оценки.                  ← то же, строка ниже
```

После заголовка — параграф:
```
Я не диагностирую и не сужу состояние. Просто показываю что чаще
встречалось — на случай если хочешь это увидеть со стороны.
```
`text-base text-secondary mt-4 max-w-xl`

---

### Блок «Состояние перед пробежкой»

Секция с заголовком `СОСТОЯНИЕ ПЕРЕД ПРОБЕЖКОЙ` (text-xs uppercase tracking-widest text-secondary).

Карточка с паддингом (rounded-2xl, bg-card, border):

**Столбчатая диаграмма** — две недели (ПН–ВС × 2), всего 14 дней.

Структура одного дня:
- Вертикальный столбик (высота = интенсивность 0–100%)
- Цвет по состоянию:
  - `спокойно` → `#EDADA0` (светло-лососевый)
  - `нервно` → `#C8553D` (средний терракотовый)
  - `тяжело` → `#7A2E1F` (тёмно-бордовый)
  - `не было` → маленький кружок внизу, `border border-[#B5A08A] rounded-full`, без столбика
- Ширина столбика: ~20px, rounded-t-sm
- Метка дня под столбиком: text-[10px] text-secondary uppercase

Между двумя неделями — тонкий разделитель или gap побольше.

**Легенда** (mt-3, flex gap-4 flex-wrap):
```
■ спокойно   ■ нервно   ■ тяжело   □ не было
```
- Маленький квадратик (8×8px, rounded-sm) + текст text-xs text-secondary

**Mock данные для графика:**

```ts
const moodData = [
  // Неделя 1 (ПН–ВС)
  { day: 'ПН', mood: null },           // не было
  { day: 'ВТ', mood: 'нервно', h: 55 },
  { day: 'СР', mood: 'тяжело', h: 80 },
  { day: 'ЧТ', mood: 'тяжело', h: 90 },
  { day: 'ПТ', mood: null },
  { day: 'СБ', mood: null },
  { day: 'ВС', mood: null },
  // Неделя 2 (ПН–ВС)
  { day: 'ПН', mood: 'нервно', h: 50 },
  { day: 'ВТ', mood: 'тяжело', h: 85 },
  { day: 'СР', mood: 'нервно', h: 60 },
  { day: 'ЧТ', mood: 'нервно', h: 55 },
  { day: 'ПТ', mood: 'нервно', h: 45 },
  { day: 'СБ', mood: null },
  { day: 'ВС', mood: 'спокойно', h: 35 },
];
```

---

### Два блока в ряд (mt-6, grid grid-cols-2 gap-4)

#### Левый: «Слова которые звучали чаще всего»

Карточка (rounded-2xl, bg-card, border, p-5):
- Заголовок: `СЛОВА КОТОРЫЕ ЗВУЧАЛИ ЧАЩЕ ВСЕГО` — text-xs uppercase tracking-widest text-secondary mb-4

**WordCloud** — имитация облака слов через flex-wrap gap-x-2 gap-y-1.5.
Каждое слово — span с font-size и color пропорциональными частоте.

```ts
const words = [
  { text: 'устал',          freq: 9,  style: 'bold',   color: 'accent' },
  { text: 'страшно',        freq: 6,  style: 'normal', color: 'secondary' },
  { text: 'не хочу',        freq: 7,  style: 'italic', color: 'accent' },
  { text: 'получилось',     freq: 4,  style: 'normal', color: 'primary' },
  { text: 'тяжело',         freq: 5,  style: 'normal', color: 'primary' },
  { text: 'СМОГУ',          freq: 10, style: 'bold',   color: 'accent' },
  { text: 'пропустил',      freq: 3,  style: 'normal', color: 'secondary' },
  { text: 'легче',          freq: 5,  style: 'italic', color: 'accent' },
  { text: 'первые 10 минут',freq: 4,  style: 'bold',   color: 'primary' },
  { text: 'вина',           freq: 2,  style: 'normal', color: 'secondary' },
  { text: 'снова',          freq: 2,  style: 'normal', color: 'secondary' },
  { text: 'сдался',         freq: 2,  style: 'normal', color: 'secondary' },
  { text: 'всё-таки',       freq: 3,  style: 'bold',   color: 'primary' },
  { text: 'тихо',           freq: 2,  style: 'normal', color: 'secondary' },
];
```

Размер шрифта по `freq`:
```ts
const getFontSize = (freq: number) => {
  if (freq >= 9) return 'text-3xl';   // ~30px
  if (freq >= 7) return 'text-2xl';   // ~24px
  if (freq >= 5) return 'text-xl';    // ~20px
  if (freq >= 3) return 'text-base';  // ~16px
  return 'text-sm';                   // ~14px
};
```

Цвет:
- `accent` → `text-[#C8553D]`
- `primary` → `text-[#1F1B16] dark:text-[#F0E8DA]`
- `secondary` → `text-[#8B7355] dark:text-[#9A8B78]`

Начертание:
- `bold` → `font-bold`
- `italic` → `italic font-medium`
- `normal` → `font-normal`

Слова расположены в `div` с `flex flex-wrap items-baseline gap-x-3 gap-y-2`.

---

#### Правый: «Паттерны»

Карточка (rounded-2xl, bg-card, border, p-5):
- Заголовок: `ПАТТЕРНЫ` — text-xs uppercase tracking-widest text-secondary mb-3

**PatternCard** — одно наблюдение:

```
«Тяжело» в среду и в пятницу — *почти никогда в субботу.*
```
- Текст ~16px, text-primary, обычный
- Курсив через `<em>` или `<span className="italic">`

```
Просто факт. Я не делаю выводов — это твоё.
```
- text-sm text-secondary mt-2

```
14 разговоров · окно 14 дней
```
- text-xs text-muted mt-3 (`text-[#B5A08A] dark:text-[#6B5E4E]`)

---

## Mobile (< 768px)

MobileHeader: `‹ Аналитика [14 дней]` (такой же формат как у Журнала).

### Заголовок (мобиль — немного другой текст):
```
Что ты говорила в эти 14 дней   ← font-bold text-3xl, text-primary, leading-snug
Не оценка. Просто наблюдения за словами.   ← text-sm text-secondary mt-1
```

### InfoNote — информационный блок (только мобиль):

Скруглённый блок с иконкой `ⓘ` (оранжевая, `text-[#E8977A]`) слева:
```
┌─────────────────────────────────────────┐
│ ⓘ  Я не диагностирую и не сужу         │
│    состояние. Просто показываю что      │
│    чаще встречалось — на случай если    │
│    хочешь это увидеть со стороны.       │
└─────────────────────────────────────────┘
```

CSS:
- `bg-[#F5EFE6] dark:bg-[#2A2520]`
- `border border-[#E8977A]/30`
- `rounded-xl p-4`
- `flex gap-3 items-start`
- Иконка: `Info` из lucide-react, `text-[#E8977A]` size 18, flex-shrink-0, mt-0.5
- Текст "не диагностирую" — `<em>не диагностирую</em>` (italic)

### График на мобиле
Тот же MoodBarChart, но `overflow-x-auto` (или уменьшенные столбики).
Столбики чуть уже (14px), но визуально те же.

### Облако слов — полная ширина, flex-wrap.

### Секция «ЧТО Я ЗАМЕТИЛА» (после облака слов):
```
ЧТО Я ЗАМЕТИЛА   ← text-xs uppercase tracking-widest text-secondary mt-6 mb-3
```
(Содержимое можно оставить заглушкой — `<p className="text-sm text-secondary">Здесь появятся мои наблюдения о твоих паттернах.</p>`)

---

## Важные детали

1. Заголовок страницы на десктопе крупный (~48px) — используй `text-5xl font-bold`
2. Нет serif-шрифта — всё system-ui, но очень жирный заголовок создаёт нужный вес
3. Активный пункт в сайдбаре — «Аналитика», иконка с терракотовым кругом: `BarChart` с обводкой цвета акцент или просто выделение цветом
4. Диаграмма — НЕ библиотека типа recharts. Делай на чистых div с `height` через inline style:
   ```jsx
   <div
     style={{ height: `${bar.h}%` }}
     className="w-4 rounded-t-sm bg-[#C8553D]"
   />
   ```
   Оберни в `div className="flex items-end h-24"` — это вся высота графика
5. Правый и левый блок на десктопе — `grid grid-cols-2 gap-4`, на мобиле — `flex flex-col`
6. Все карточки: `rounded-2xl border border-[#D9CEBC] dark:border-[#3A342C] bg-white dark:bg-[#2A2520] p-5`
