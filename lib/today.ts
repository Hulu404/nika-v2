// Хелперы для главной страницы возвращающегося юзера.

const WEEKDAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WEEKDAYS_LONG_RU = [
  "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье",
];
const MONTHS_RU = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function ymd(d: Date): string {
  return d.toLocaleDateString("en-CA");
}

function weekdayMon0(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** Стрик: подряд идущие дни с разговорами, отсчитываются от сегодня (или вчера, если сегодня пусто). */
export function computeStreak(
  conversations: { updated_at: string }[],
  now = new Date(),
): number {
  const days = new Set(conversations.map((c) => ymd(new Date(c.updated_at))));
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);

  // Начинаем с сегодня, иначе — с вчерашнего дня (стрик «вчерашний» тоже валиден).
  if (!days.has(ymd(cursor))) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (days.has(ymd(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export type WeekDayState = "done" | "today" | "empty";

/** Лента дней текущей недели (Пн–Вс) с состояниями по пробежкам. */
export function weekRibbon(
  runs: { date: string }[],
  now = new Date(),
): { label: string; state: WeekDayState }[] {
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - weekdayMon0(now));

  const todayIdx = weekdayMon0(now);
  const runDates = new Set(runs.map((r) => r.date));

  return WEEKDAYS_RU.map((label, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    if (runDates.has(ymd(d))) return { label, state: "done" };
    if (i === todayIdx) return { label, state: "today" };
    return { label, state: "empty" };
  });
}

/** «Среда, 15 мая» — для подзаголовков. */
export function humanDate(now = new Date()): string {
  return `${WEEKDAYS_RU[weekdayMon0(now)]}, ${now.getDate()} ${MONTHS_RU[now.getMonth()]}`;
}

/** «среда» — полное название дня недели (для eyebrow). */
export function weekdayLong(now = new Date()): string {
  return WEEKDAYS_LONG_RU[weekdayMon0(now)];
}

/** Поддерживающая строка под именем — по дню недели. */
export function weekMessage(now = new Date()): string {
  const dow = weekdayMon0(now);
  if (dow === 0) return "Новая неделя — начнём ровно.";
  if (dow <= 3) return "Ты на середине недели — и всё идёт ровно.";
  if (dow === 4) return "Почти выходные — держи темп.";
  return "Выходные — позволь себе отдых.";
}

/** «Доброе утро/день/вечер/ночи». */
export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 17) return "Добрый день";
  return "Добрый вечер";
}
