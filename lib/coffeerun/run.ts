/**
 * Единый источник правды о кофе-ранах: спот, дата, время сбора, адрес.
 *
 * Читают трое: API заявки (какой spot и run_date писать), бот (текст
 * подтверждения и напоминания) и — вручную, при вёрстке — лендинги.
 * Новый забег = одна новая запись в COFFEE_RUNS.
 *
 * Забегов теперь несколько и они от разных спотов, поэтому «ближайший» больше
 * не единственный ответ: заявка приходит с конкретного лендинга и знает свой
 * spot. Отсюда пара функций — nextRun() для общих случаев и runBySpot()/
 * runForSignup() там, где важно не перепутать Усачёву с Лужниками.
 */
export interface CoffeeRun {
  /**
   * Слаг спота — он же ключ связи «лендинг ↔ строка в БД ↔ текст бота».
   * Ложится в coffee_run_signups.spot, приходит из формы лендинга.
   */
  spot: string;
  /** Путь лендинга этого забега (без хоста): бот зовёт сюда «потерявшихся». */
  landing: string;
  /** Человеческое имя спота — для кнопок и подписей: «Surf Coffee® Лужники». */
  spotName: string;
  /** ISO YYYY-MM-DD — ровно то, что ложится в coffee_run_signups.run_date */
  date: string;
  /** «6 сентября» — для текста сообщений */
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

/**
 * Хронологически по возрастанию. Прошедшие забеги убираем в тот же день, как только
 * старт состоялся: nextRun() считает забег будущим весь его день, и оставленная
 * запись вечером увела бы новые заявки в уже прошедший забег. История живёт в базе
 * (coffee_run_signups.run_date + spot), а не здесь.
 */
export const COFFEE_RUNS: CoffeeRun[] = [
  {
    spot: "usachevo",
    landing: "/coffeerunsurfsport",
    spotName: "Surf Coffee® × Sport, Усачёва",
    date: "2026-09-05",
    dateLabel: "5 сентября",
    weekday: "суббота",
    gatherTime: "9:15",
    startTime: "9:30",
    address: "Москва, ул. Усачёва, 62",
    place: "спот Surf Coffee × Sport",
    distance: "5 км",
    mapUrl:
      "https://yandex.ru/maps/?text=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0%2C%20%D1%83%D0%BB%D0%B8%D1%86%D0%B0%20%D0%A3%D1%81%D0%B0%D1%87%D1%91%D0%B2%D0%B0%2C%2062",
  },
  {
    spot: "luzhniki",
    landing: "/coffeerunluzhniki",
    spotName: "Surf Coffee® Лужники",
    date: "2026-09-06",
    dateLabel: "6 сентября",
    weekday: "воскресенье",
    gatherTime: "9:15",
    startTime: "9:30",
    address: "Москва, ул. Лужники, 24, стр. 41",
    place: "спот Surf Coffee Лужники",
    distance: "5 км",
    mapUrl:
      "https://yandex.ru/maps/?text=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0%2C%20%D0%9B%D1%83%D0%B6%D0%BD%D0%B8%D0%BA%D0%B8%2C%2024%2C%20%D1%81%D1%82%D1%80%D0%BE%D0%B5%D0%BD%D0%B8%D0%B5%2041",
  },
];

/** Забег считается будущим весь свой день по МСК. */
function isUpcoming(run: CoffeeRun, now: Date): boolean {
  return Date.parse(`${run.date}T23:59:59+03:00`) >= now.getTime();
}

/**
 * Все будущие забеги, по возрастанию даты. Пустой массив — сезон закончился,
 * новых записей в COFFEE_RUNS пока нет.
 */
export function upcomingRuns(now: Date = new Date()): CoffeeRun[] {
  return COFFEE_RUNS.filter((r) => isUpcoming(r, now));
}

/**
 * Ближайший будущий забег среди всех спотов. Забег считается будущим весь свой
 * день по МСК — человек, который подтверждается утром в день старта, должен
 * увидеть сегодня, а не следующий месяц. Если будущих не осталось, возвращаем
 * последний прошедший: лучше показать устаревшую дату, чем упасть.
 */
export function nextRun(now: Date = new Date()): CoffeeRun {
  return upcomingRuns(now)[0] ?? COFFEE_RUNS[COFFEE_RUNS.length - 1];
}

/**
 * Ближайший будущий забег конкретного спота — этим живёт форма лендинга:
 * страница Лужников не должна записывать людей на Усачёву.
 * Нет будущего — отдаём последний прошедший этого спота, нет вообще — null.
 */
export function runBySpot(spot: string, now: Date = new Date()): CoffeeRun | null {
  const ofSpot = COFFEE_RUNS.filter((r) => r.spot === spot);
  return ofSpot.find((r) => isUpcoming(r, now)) ?? ofSpot[ofSpot.length - 1] ?? null;
}

/** Забег по точной дате (YYYY-MM-DD). Для ручного запуска рассылки. */
export function runByDate(ymd: string): CoffeeRun | null {
  return COFFEE_RUNS.find((r) => r.date === ymd) ?? null;
}

/**
 * Забег, на который записан конкретный человек. Именно это читает бот: он
 * подтверждает ту заявку, что нашёл, и рассказывать должен про её забег, а не
 * про ближайший вообще.
 *
 * Порядок поиска — от точного к терпимому: spot + дата, потом только spot
 * (дата в старой строке могла отстать от переноса забега), потом только дата
 * (строки, записанные до появления столбца spot). Совсем ничего не совпало —
 * ближайший забег: показать что-то полезнее, чем упасть.
 */
export function runForSignup(
  signup: { spot?: string | null; run_date?: string | null },
  now: Date = new Date(),
): CoffeeRun {
  const { spot, run_date } = signup;

  if (spot && run_date) {
    const exact = COFFEE_RUNS.find((r) => r.spot === spot && r.date === run_date);
    if (exact) return exact;
  }
  if (spot) {
    const bySpot = runBySpot(spot, now);
    if (bySpot) return bySpot;
  }
  if (run_date) {
    const byDate = runByDate(run_date);
    if (byDate) return byDate;
  }
  return nextRun(now);
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
 * Забеги, по которым пора рассылать напоминание. Список, а не один: забеги на
 * соседних спотах могут стоять в один день, и вернув только первый мы бы молча
 * оставили вторую половину участников без напоминания.
 *
 * Чистая функция от УЖЕ посчитанных московских даты и часа — так вся логика
 * «когда» проверяется тестами без подмены времени. `hour >= REMINDER_HOUR_MSK`,
 * а не «==»: если планировщик проспал свой тик, напоминание уйдёт следующим,
 * а не пропадёт совсем (повторов не будет — их держит reminder_sent_at).
 */
export function runsDueForReminder(nowYmd: string, nowHourMsk: number): CoffeeRun[] {
  if (nowHourMsk < REMINDER_HOUR_MSK) return [];
  return COFFEE_RUNS.filter((r) => dayBefore(r.date) === nowYmd);
}

/** Одна строка «когда и где» — для бота и любых уведомлений. */
export function runWhenWhere(run: CoffeeRun): string {
  return (
    `${run.dateLabel} (${run.weekday}), сбор в ${run.gatherTime}, старт в ${run.startTime} — ` +
    `${run.address}, ${run.place}`
  );
}
