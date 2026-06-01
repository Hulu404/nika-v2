# Промпт для Claude Code: Страница «Сегодня» (возвращающийся пользователь, день 2+)

## Контекст проекта

Next.js 14 + TypeScript + Tailwind CSS. Приложение НИКА — AI-собеседник для бегунов.
Это главная страница (`app/today/page.tsx`) для пользователя, который заходит **второй раз и более**.

Подключи шрифты в `app/layout.tsx`:
```ts
import { Fraunces, Geist, Geist_Mono } from 'next/font/google'

const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-serif', display: 'swap' })
const geist = Geist({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' })
```

В `tailwind.config.ts`:
```ts
fontFamily: {
  serif: ['var(--font-serif)', 'Georgia', 'serif'],
  sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
  mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
}
```

---

## Дизайн-токены (точные цвета из прототипа)

```css
/* Светлая тема */
--bg-canvas:    #EFE7D7   /* фон страницы */
--bg-primary:   #FAF7F1   /* фон шелла, сайдбара */
--bg-elevated:  #FFFCF6   /* карточки */
--surface-nika: #F4EFE6   /* поверхность НИКИ (bubble, sidebar hover) */
--surface-warm: #F4E4D6   /* тёплая карточка (план) */
--surface-deep: #E9DFCB   /* hover-состояния */

--ink-primary:   #1F1B16
--ink-secondary: #5C534A
--ink-muted:     #9A9085
--ink-faint:     #C2B7A6

--border-subtle:  #EFE9DD
--border-default: #E5DDD0
--border-strong:  #D4C9B5

--accent:      #C8553D
--accent-deep: #B0392A
--accent-soft: #E8B7A8

/* Тёмная тема */
--bg-canvas-dark:    #14110E
--bg-primary-dark:   #1B1814
--bg-elevated-dark:  #221E19
--surface-nika-dark: #2A241D
--surface-warm-dark: #3A2920
--surface-deep-dark: #2F2820

--ink-primary-dark:   #F5EFE3
--ink-secondary-dark: #B5A998
--ink-muted-dark:     #7A6F62
--ink-faint-dark:     #4F4639

--border-subtle-dark:  #2A241D
--border-default-dark: #34291F
--border-strong-dark:  #4A3D2E

--accent-dark: #E07A5F
```

В Tailwind используй inline Tailwind классы с этими hex-значениями напрямую.

---

## Компоненты для создания

- `components/today/TodayDashboard.tsx` — вся страница «Сегодня»
- `components/today/PlanCard.tsx` — карточка «План на сегодня»
- `components/today/WeekRibbon.tsx` — лента дней недели с индикаторами
- `components/today/RecentRun.tsx` — карточка последней пробежки
- `components/today/SuggestionChips.tsx` — кнопки-подсказки
- `components/layout/Sidebar.tsx` — десктопный сайдбар (если ещё не создан)
- `components/layout/MobileHeader.tsx` — мобильная шапка
- `components/layout/MobileTabBar.tsx` — нижняя таб-панель на мобиле

---

## ГЛАВНАЯ СТРАНИЦА — Desktop Layout

Структура (`app/today/page.tsx`):
```
┌────────────────────────────────────────────────────┐
│  SIDEBAR (268px)  │  MAIN (flex-1)                 │
│                   │  ┌─ Chat Header               │
│                   │  ├─ Dashboard (tdB)            │
│                   │  │   hero → grid → footer      │
│                   │  └─ Input bar                  │
└────────────────────────────────────────────────────┘
```

Корневой лейаут страницы:
```tsx
<div className="flex h-screen overflow-hidden bg-[#FAF7F1] dark:bg-[#1B1814]">
  <Sidebar activePage="today" />
  <div className="flex flex-col flex-1 min-w-0">
    <ChatHeader />
    <TodayDashboard />
  </div>
</div>
```

---

## Sidebar (десктоп)

Ширина 268px, фон `#FAF7F1 / dark:#1B1814`, правая граница `#E5DDD0 / dark:#34291F`.

### Шапка:
```tsx
<div className="flex items-center gap-2.5 px-5 py-5 border-b border-[#E5DDD0] dark:border-[#34291F]">
  <NikaAvatar size={30} />
  <span className="font-serif text-[21px] font-medium tracking-wide">НИКА</span>
</div>
```

**NikaAvatar** — круглый div с градиентом:
```tsx
<div
  style={{ background: 'linear-gradient(135deg, #F4E4D6 0%, #E8B7A8 60%, #C8553D 130%)' }}
  className="rounded-full relative flex-shrink-0"
/>
```
С зелёной точкой-статусом (position absolute, bottom-0 right-0, 10px, `bg-[#7BA968]`, border 2px white).

### Кнопка «+ Новый разговор»:
```tsx
<button className="mx-3.5 mt-4 mb-2 flex items-center gap-2 w-[calc(100%-28px)] bg-[#1F1B16] dark:bg-[#F5EFE3] text-[#FAF7F1] dark:text-[#1B1814] text-[13px] font-medium px-3.5 py-2.5 rounded-[10px]">
  <Plus size={14} />
  Новый разговор
</button>
```

### Навигация (d-nav):
Массив пунктов:

```ts
const navItems = [
  { id: 'today',     label: 'Сегодня',    icon: MessageSquare },
  { id: 'tracking',  label: 'Трекинг',    icon: TrendingUp },
  { id: 'journal',   label: 'Журнал',     icon: BarChart2 },
  { id: 'analytics', label: 'Аналитика',  icon: Clock },
  { id: 'push',      label: 'Пуши',       icon: Bell },
]
```

Каждый пункт:
```tsx
<button className={cn(
  "flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-left transition-colors",
  isActive
    ? "bg-[#E9DFCB] dark:bg-[#2F2820] text-[#1F1B16] dark:text-[#F5EFE3] font-medium"
    : "text-[#5C534A] dark:text-[#B5A998] hover:bg-[#E9DFCB] dark:hover:bg-[#2F2820] hover:text-[#1F1B16] dark:hover:text-[#F5EFE3]"
)}>
  <Icon size={15} className={isActive ? "text-[#C8553D]" : "text-[#9A9085]"} />
  {label}
</button>
```

PRO-пункт (отдельный стиль):
```tsx
<button className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#B0392A] dark:text-[#E07A5F] font-medium">
  <Triangle size={15} className="text-[#C8553D]" />
  PRO
  <span className="ml-auto font-mono text-[9.5px] text-[#9A9085] bg-[#F4E4D6] dark:bg-[#3A2920] px-1.5 py-0.5 rounded">
    Free → 7 дней
  </span>
</button>
```

### Секции диалогов:

Заголовок секции:
```tsx
<div className="px-5 pt-4 pb-1.5 text-[10.5px] font-medium text-[#9A9085] uppercase tracking-[0.1em]">
  Сегодня — диалоги
</div>
```

Элемент треда:
```tsx
<div className={cn(
  "flex items-center gap-2.5 mx-2 px-3.5 py-2.5 rounded-lg text-[13px] cursor-pointer transition-colors",
  isActive ? "bg-[#E9DFCB] dark:bg-[#2F2820] text-[#1F1B16] dark:text-[#F5EFE3] font-medium" : "text-[#5C534A] dark:text-[#B5A998]"
)}>
  <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", isActive ? "bg-[#C8553D]" : "bg-[#C2B7A6]")} />
  <div className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{preview}</div>
  <div className="text-[10.5px] text-[#9A9085] font-mono">{time}</div>
</div>
```

Данные:
```ts
const threads = {
  today: [
    { preview: 'Утром перед тренировкой', time: '8:14', active: true },
    { preview: 'После 4 дней перерыва', time: 'сейчас' },
  ],
  thisWeek: [
    { preview: 'После пробежки 14 мая', time: 'вт' },
    { preview: 'Что значит «тяжело»', time: 'пн' },
  ]
}
```

### Подвал сайдбара:

Кнопка темы:
```tsx
<button className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] text-[#5C534A] border border-[#E5DDD0] dark:border-[#34291F] rounded-[10px] hover:border-[#1F1B16] transition-all">
  <Moon size={14} className="text-[#9A9085]" />
  <span className="flex-1 text-left">Тёмная тема</span>
  <span className="font-mono text-[10px] bg-[#E9DFCB] dark:bg-[#2F2820] px-1.5 py-0.5 rounded">Off</span>
</button>
```

Футер с аватаром пользователя:
```tsx
<div className="flex items-center gap-2.5 px-4 py-3.5 border-t border-[#E5DDD0] dark:border-[#34291F]">
  <div className="w-8 h-8 rounded-full bg-[#C8553D] flex items-center justify-center text-[#FFFCF6] text-xs font-semibold">А</div>
  <div className="flex-1 text-[13px] font-medium">Аня</div>
  <div className="text-[10.5px] text-[#9A9085] font-mono tracking-wider">FREE</div>
</div>
```

---

## Chat Header

```tsx
<div className="flex items-center gap-3.5 px-8 py-4 border-b border-[#E5DDD0] dark:border-[#34291F] flex-shrink-0">
  <NikaAvatar size={32} />
  <div className="flex-1">
    <div className="font-serif text-[17px] font-medium tracking-[-0.01em]">Сегодня</div>
    <span className="block text-[11.5px] text-[#9A9085] mt-0.5">Среда, 15 мая</span>
  </div>
</div>
```

---

## Today Dashboard (основной контент, вариация B)

Обёртка с прокруткой:
```tsx
<div className="flex-1 overflow-y-auto">
  <div className="max-w-[760px] mx-auto px-8 py-10">
    <Hero />
    <Grid />
    <Footer />
  </div>
</div>
```

### Hero

```tsx
<div className="flex gap-4 items-start mb-6">
  <NikaAvatar size={46} />
  <div className="flex-1">
    {/* Eyebrow */}
    <div className="font-mono text-[11px] tracking-[0.16em] uppercase text-[#C8553D] dark:text-[#E07A5F] font-semibold mb-2.5">
      Сегодня · среда, 15 мая
    </div>
    {/* Heading */}
    <h1 className="font-serif font-normal text-[29px] leading-[1.25] tracking-[-0.02em] text-[#1F1B16] dark:text-[#F5EFE3] m-0">
      Доброе утро, <em className="italic text-[#C8553D] dark:text-[#E07A5F] not-italic" style={{fontStyle:'italic'}}>Аня</em>.
      <br />
      Ты на середине недели — и всё идёт ровно.
    </h1>
  </div>
</div>
```

---

### Grid (2 колонки)

```tsx
<div className="grid grid-cols-2 gap-3.5">
  <PlanCard />       {/* span-2 */}
  <StreakCard />
  <WeekCard />
  <LastRunCard />    {/* span-2 */}
</div>
```

Базовая карточка:
```tsx
<div className="bg-[#FFFCF6] dark:bg-[#221E19] border border-[#EFE9DD] dark:border-[#2A241D] rounded-2xl p-[18px] relative overflow-hidden text-left">
```

**Тёплая карточка** (план) — другой фон:
```tsx
<div className="bg-[#F4E4D6] dark:bg-[#3A2920] border border-[rgba(200,85,61,0.18)] rounded-2xl ...">
```

Заголовок карточки (.cap):
```tsx
<div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#9A9085] dark:text-[#7A6F62] mb-3">
  <Icon size={13} className="text-[#C8553D]" />
  {label}
</div>
```

Большое число (.big):
```tsx
<div className="font-serif text-[34px] font-medium tracking-[-0.02em] leading-none">
  {value}<small className="text-[14px] text-[#9A9085] font-normal"> {unit}</small>
</div>
```

Подпись карточки:
```tsx
<div className="text-[12.5px] text-[#5C534A] dark:text-[#B5A998] mt-2 leading-[1.45]">
  {subtitle}
</div>
```

---

#### PlanCard (span-2, warm)

```tsx
<div className="col-span-2 bg-[#F4E4D6] dark:bg-[#3A2920] border border-[rgba(200,85,61,0.18)] rounded-2xl p-[18px] flex items-center gap-4">
  {/* Иконка */}
  <div className="w-12 h-12 rounded-[14px] bg-[#FFFCF6] dark:bg-[#221E19] border border-[rgba(200,85,61,0.16)] flex items-center justify-center text-[#C8553D] flex-shrink-0">
    <TrendingUp size={22} />
  </div>
  {/* Текст */}
  <div className="flex-1">
    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#B0392A] dark:text-[#E07A5F] mb-1">
      План на сегодня
    </div>
    <div className="font-serif text-[17px] font-medium tracking-[-0.01em] text-[#1F1B16] dark:text-[#F5EFE3]">
      Лёгкая пробежка · 4 км
    </div>
    <div className="text-[12.5px] text-[#5C534A] dark:text-[#B5A998] mt-0.5">
      Без темпа. Только если захочется.
    </div>
  </div>
</div>
```

---

#### StreakCard

```tsx
<div className="bg-[#FFFCF6] dark:bg-[#221E19] border border-[#EFE9DD] dark:border-[#2A241D] rounded-2xl p-[18px]">
  <div className="cap">⭐ Стрик</div>
  <div className="font-serif text-[34px] font-medium tracking-[-0.02em] leading-none">
    12<small className="text-[14px] text-[#9A9085] font-normal"> дней</small>
  </div>
  <div className="text-[12.5px] text-[#5C534A] dark:text-[#B5A998] mt-2 leading-[1.45]">
    Ты пишешь НИКЕ почти каждый день. Это и есть привычка.
  </div>
</div>
```

Используй `Star` из lucide-react для иконки.

---

#### WeekCard

```tsx
<div className="bg-[#FFFCF6] dark:bg-[#221E19] border border-[#EFE9DD] dark:border-[#2A241D] rounded-2xl p-[18px]">
  <div className="cap">📊 Эта неделя</div>
  <div className="font-serif text-[34px] font-medium tracking-[-0.02em] leading-none">
    8.4<small className="text-[14px] text-[#9A9085] font-normal"> км</small>
  </div>
  <WeekRibbon className="mt-3.5" />
</div>
```

---

#### WeekRibbon

```tsx
const days = [
  { label: 'Пн', state: 'done' },   // ✓
  { label: 'Вт', state: 'done' },   // ✓
  { label: 'Ср', state: 'today' },  // текущий
  { label: 'Чт', state: 'rest' },   // пунктир
  { label: 'Пт', state: 'empty' },
  { label: 'Сб', state: 'empty' },
  { label: 'Вс', state: 'empty' },
]
```

Рендер дня:
```tsx
<div className="flex flex-col items-center gap-1.5 flex-1">
  <div className={cn(
    "w-[26px] h-[26px] rounded-full border-[1.5px] flex items-center justify-center font-mono text-[10px]",
    {
      done:  "bg-[#C8553D] border-[#C8553D] text-white",
      today: "border-[#C8553D] text-[#C8553D] shadow-[0_0_0_3px_rgba(200,85,61,0.10)]",
      rest:  "border-dashed border-[#D4C9B5] dark:border-[#4A3D2E] text-[#9A9085]",
      empty: "border-[#D4C9B5] dark:border-[#4A3D2E] text-[#9A9085]",
    }[state]
  )}>
    {state === 'done' ? '✓' : '·'}
  </div>
  <span className="text-[9.5px] uppercase tracking-[0.06em] text-[#9A9085] font-medium">{label}</span>
</div>
```

---

#### LastRunCard (span-2)

```tsx
<div className="col-span-2 bg-[#FFFCF6] dark:bg-[#221E19] border border-[#EFE9DD] dark:border-[#2A241D] rounded-2xl p-[18px]">
  <div className="cap mb-0">🏃 Последняя пробежка</div>
  <button className="flex items-start gap-3.5 w-full text-left mt-3 hover:opacity-80 transition-opacity cursor-pointer">
    {/* Дата */}
    <div className="w-[42px] flex-shrink-0 text-center">
      <div className="font-serif text-[24px] font-medium leading-none tracking-[-0.02em] text-[#1F1B16] dark:text-[#F5EFE3]">14</div>
      <div className="text-[9.5px] text-[#9A9085] mt-1.5 uppercase tracking-[0.1em] font-medium">мая</div>
    </div>
    {/* Инфо */}
    <div className="flex-1 min-w-0">
      <div className="text-[14px] font-medium mb-1 text-[#1F1B16] dark:text-[#F5EFE3]">4.2 км · 28 мин · легко</div>
      <div className="font-serif italic text-[13px] text-[#9A9085] leading-[1.4]">
        «сегодня было тяжело первые 10 минут»
      </div>
    </div>
    {/* Темп */}
    <div className="font-mono text-[11px] text-[#5C534A] dark:text-[#B5A998] text-right flex-shrink-0 self-center">
      6:40<br /><small className="text-[#9A9085]">/км</small>
    </div>
  </button>
</div>
```

---

### Footer (Ответить НИКЕ)

```tsx
<div className="flex flex-col gap-3.5 mt-6">
  <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#9A9085]">
    Ответить НИКЕ
  </div>
  <div className="flex flex-wrap gap-2 items-center">
    <SuggestionChip>Не хочется бежать сегодня</SuggestionChip>
    <SuggestionChip>Расскажу как прошло</SuggestionChip>
    <SuggestionChip>Перенести на вечер</SuggestionChip>
    <button className="flex items-center gap-2 bg-[#1F1B16] dark:bg-[#F5EFE3] text-[#FAF7F1] dark:text-[#1B1814] text-[13.5px] font-medium px-5 py-3 rounded-full hover:bg-[#C8553D] transition-colors">
      Открыть разговор
      <ChevronRight size={14} />
    </button>
  </div>
</div>
```

**SuggestionChip:**
```tsx
<button className="flex-shrink-0 px-4 py-2.5 bg-[#FFFCF6] dark:bg-[#221E19] border border-[#E5DDD0] dark:border-[#34291F] rounded-full text-[13px] text-[#5C534A] dark:text-[#B5A998] whitespace-nowrap hover:border-[#1F1B16] dark:hover:border-[#F5EFE3] hover:text-[#1F1B16] dark:hover:text-[#F5EFE3] transition-all">
  {children}
</button>
```

---

## Mobile Layout (< 768px)

Структура:
```
┌──────────────────────────────┐
│  MobileHeader (sticky top)   │
│  Content (scrollable)        │
│  MobileTabBar (sticky bottom)│
└──────────────────────────────┘
```

### MobileHeader
```tsx
<div className="sticky top-0 z-20 flex items-center gap-3 px-4 pt-14 pb-3.5
  bg-[rgba(250,247,241,0.85)] dark:bg-[rgba(20,17,14,0.85)]
  backdrop-blur-md border-b border-[#EFE9DD] dark:border-[#2A241D]">
  <NikaAvatar size={36} />
  <div className="flex-1">
    <div className="font-serif text-[17px] font-medium tracking-[-0.01em]">Сегодня</div>
    <div className="text-[11px] text-[#9A9085] mt-0.5">Среда, 15 мая</div>
  </div>
  <button className="w-9 h-9 rounded-full flex items-center justify-center text-[#5C534A]">
    <MoreVertical size={18} />
  </button>
</div>
```

### Мобильный контент

```tsx
<div className="px-4 py-4 flex flex-col gap-3">
  {/* Eyebrow */}
  <div className="font-mono text-[11px] tracking-[0.16em] uppercase text-[#C8553D] font-semibold">
    Сегодня · среда
  </div>

  {/* H1 */}
  <h1 className="font-serif font-normal text-[23px] leading-[1.25] tracking-[-0.02em] m-0 mb-1.5">
    Доброе утро, <em className="text-[#C8553D] dark:text-[#E07A5F]">Аня</em>. Всё идёт ровно.
  </h1>

  {/* Plan card */}
  <PlanCard />  {/* warm, без иконки-кнопки, компактный */}

  {/* 2-колонки: стрик + неделя */}
  <div className="grid grid-cols-2 gap-3">
    <StreakCard compact />
    <div className="bg-[#FFFCF6] dark:bg-[#221E19] border border-[#EFE9DD] rounded-2xl p-4">
      <div className="cap text-[10px]">Неделя</div>
      <div className="font-serif text-[28px] font-medium tracking-[-0.02em] leading-none">
        8.4<small className="text-[13px] text-[#9A9085] font-normal"> км</small>
      </div>
    </div>
  </div>

  {/* Лента недели */}
  <div className="bg-[#FFFCF6] dark:bg-[#221E19] border border-[#EFE9DD] rounded-2xl p-4">
    <div className="cap mb-3">Эта неделя</div>
    <WeekRibbon />
  </div>

  {/* Последняя пробежка */}
  <div className="bg-[#FFFCF6] dark:bg-[#221E19] border border-[#EFE9DD] rounded-2xl p-4">
    <div className="cap mb-2">Последняя пробежка</div>
    <RecentRun compact />
  </div>

  {/* Подсказки */}
  <div className="font-semibold text-[10.5px] uppercase tracking-[0.12em] text-[#9A9085] mt-1">
    Ответить НИКЕ
  </div>
</div>

{/* Горизонтальный скролл подсказок */}
<div className="flex gap-2 overflow-x-auto px-4 pb-4 scrollbar-none">
  <SuggestionChip>Не хочется бежать</SuggestionChip>
  <SuggestionChip>Расскажу как прошло</SuggestionChip>
</div>
```

### MobileTabBar

```tsx
<div className="sticky bottom-0 flex bg-[rgba(250,247,241,0.95)] dark:bg-[rgba(20,17,14,0.95)]
  backdrop-blur-xl border-t border-[#EFE9DD] dark:border-[#2A241D] pt-2 pb-6">
  {[
    { id: 'today',   label: 'Сегодня', Icon: MessageSquare },
    { id: 'journal', label: 'Журнал',  Icon: BarChart2 },
    { id: 'tracking',label: 'Трекинг', Icon: Clock },
    { id: 'profile', label: 'Профиль', Icon: User },
  ].map(tab => (
    <button key={tab.id} className={cn(
      "flex-1 flex flex-col items-center gap-1 text-[10px] py-1",
      tab.id === 'today' ? "text-[#C8553D]" : "text-[#9A9085]"
    )}>
      <tab.Icon size={20} />
      {tab.label}
    </button>
  ))}
</div>
```

---

## Точки переключения

```tsx
// Показывать Sidebar только на md+
<div className="hidden md:flex">
  <Sidebar />
</div>

// MobileHeader + MobileTabBar только на < md
<div className="flex md:hidden">
  <MobileHeader />
</div>
```

---

## Важные детали

1. **Шрифт Fraunces** — для всех `font-serif` классов. Это display serif с красивыми кривыми. Особенно важен для h1, чисел и курсива.
2. **Geist Mono** — для eyebrow-подписей, временны́х меток, темпа (`font-mono`).
3. **Тёмная тема** — через `dark:` prefix Tailwind, переключай класс `dark` на `<html>` через кнопку в сайдбаре.
4. **Имя пользователя** (Аня) — курсивное и терракотовое: `<em className="not-italic italic text-[#C8553D]">Аня</em>`
5. **Кнопки** — micro-animation: `active:scale-[0.97] transition-transform`
6. Карточки (`col-span-2`) на мобиле занимают полную ширину автоматически (1-col grid).
