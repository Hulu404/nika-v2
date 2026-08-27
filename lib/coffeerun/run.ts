/**
 * Единый источник правды о кофе-ранах: дата, время сбора, адрес.
 *
 * Читают трое: API заявки (какой run_date писать), бот (текст подтверждения) и
 * — вручную, при вёрстке — лендинг. Новый забег = одна новая запись в COFFEE_RUNS;
 * nextRun() сам выберет ближайший будущий.
 */
export interface CoffeeRun {
  /** ISO YYYY-MM-DD — ровно то, что ложится в coffee_run_signups.run_date */
  date: string;
  /** «29 августа» — для текста сообщений */
  dateLabel: string;
  weekday: string;
  /** Время сбора и старта, МСК */
  gatherTime: string;
  startTime: string;
  address: string;
  /** Спот, где старт и финиш */
  place: string;
  distance: string;
  mapUrl: string;
}

/** Хронологически по возрастанию. */
export const COFFEE_RUNS: CoffeeRun[] = [
  {
    date: "2026-08-29",
    dateLabel: "29 августа",
    weekday: "суббота",
    gatherTime: "9:15",
    startTime: "9:30",
    address: "Москва, ул. Усачёва, 62",
    place: "спот Surf Coffee × Sport",
    distance: "5 км",
    mapUrl:
      "https://yandex.ru/maps/?text=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0%2C%20%D1%83%D0%BB%D0%B8%D1%86%D0%B0%20%D0%A3%D1%81%D0%B0%D1%87%D1%91%D0%B2%D0%B0%2C%2062",
  },
];

/**
 * Ближайший будущий забег. Забег считается будущим весь свой день по МСК —
 * человек, который подтверждается утром в день старта, должен увидеть сегодня,
 * а не следующий месяц. Если будущих не осталось, возвращаем последний
 * прошедший: лучше показать устаревшую дату, чем упасть.
 */
export function nextRun(now: Date = new Date()): CoffeeRun {
  const upcoming = COFFEE_RUNS.find((r) => Date.parse(`${r.date}T23:59:59+03:00`) >= now.getTime());
  return upcoming ?? COFFEE_RUNS[COFFEE_RUNS.length - 1];
}

/**
 * Час по МСК, в который накануне уходит напоминание. Старт в 9:30, значит 10:00
 * днём раньше — это ровно «за сутки», и человек ещё успевает переиграть вечер.
 */
export const REMINDER_HOUR_MSK = 10;

/** Календарный день перед датой (YYYY-MM-DD). Считаем в UTC — сдвигов нет. */
export function dayBefore(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Забег, по которому пора рассылать напоминание, или null.
 *
 * Чистая функция от УЖЕ посчитанных московских даты и часа — так вся логика
 * «когда» проверяется тестами без подмены времени. `hour >= REMINDER_HOUR_MSK`,
 * а не «==»: если планировщик проспал свой тик, напоминание уйдёт следующим,
 * а не пропадёт совсем (повторов не будет — их держит reminder_sent_at).
 */
export function runDueForReminder(nowYmd: string, nowHourMsk: number): CoffeeRun | null {
  if (nowHourMsk < REMINDER_HOUR_MSK) return null;
  return COFFEE_RUNS.find((r) => dayBefore(r.date) === nowYmd) ?? null;
}

/** Забег по точной дате (YYYY-MM-DD). Для ручного запуска рассылки. */
export function runByDate(ymd: string): CoffeeRun | null {
  return COFFEE_RUNS.find((r) => r.date === ymd) ?? null;
}

/** Одна строка «когда и где» — для бота и любых уведомлений. */
export function runWhenWhere(run: CoffeeRun): string {
  return (
    `${run.dateLabel} (${run.weekday}), сбор в ${run.gatherTime}, старт в ${run.startTime} — ` +
    `${run.address}, ${run.place}`
  );
}
