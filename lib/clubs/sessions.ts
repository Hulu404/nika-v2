/**
 * Занятия клубов NIKA с платной записью (лендинг /stretch и следующие).
 *
 * Источник истины для API и бота: цену, дату и адрес сервер берёт ОТСЮДА, а не
 * из того, что прислал браузер. Иначе закешированная страница или подделанный
 * запрос выставили бы счёт не на ту сумму.
 *
 * Новое занятие — новая запись в SESSIONS; дату в public/stretch/index.html
 * (EVENT.date) надо держать равной `date` здесь.
 */
export interface ClubSession {
  /** Клуб: 'stretch' — NIKA | YOU'LL NEVER STRETCH ALONE. */
  club: string;
  format: string;
  /** Слаг места, уходит в заявку. */
  spot: string;
  /** Дата занятия, YYYY-MM-DD (МСК). */
  date: string;
  /** Время старта, HH:MM (МСК). */
  time: string;
  /** Цена в рублях. */
  priceRub: number;
  /** Номер выпуска на билете: «№ 001». */
  edition: number;
  /** Подписи для счёта и сообщений бота. */
  title: string;
  formatLabel: string;
  dateLabel: string;
  weekday: string;
  place: string;
  metro: string;
  gatherAt: string;
  /** Путь лендинга на сайте, без хвостового слэша. */
  landing: string;
  mapUrl: string;
}

export const SESSIONS: readonly ClubSession[] = [
  {
    club: "stretch",
    format: "pilates",
    spot: "klimashkina",
    date: "2026-11-01",
    time: "10:30",
    priceRub: 10, // ТЕСТ оплаты; боевая цена 1000
    edition: 1,
    title: "Пилатес на коврике",
    formatLabel: "пилатес на коврике, 60 минут",
    dateLabel: "1 ноября",
    weekday: "воскресенье",
    place: "ул. Климашкина, 20, студия йоги «Поток», вход с торца",
    metro: "м. Улица 1905 года",
    gatherAt: "10:10",
    landing: "/stretch",
    mapUrl: "https://yandex.ru/maps/?rtext=~55.768024%2C37.568205&rtt=auto",
  },
];

/** Сегодняшняя дата по Москве, YYYY-MM-DD. */
export function moscowToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Занятие для заявки: клуб обязателен, дата уточняет его. Только будущие
 * (сегодняшнее ещё можно). Нет совпадения по дате — ближайшее занятие клуба:
 * закешированная страница могла прислать старую дату.
 */
export function sessionForSignup(
  input: { club: string | null; date: string | null },
  now: Date = new Date(),
): ClubSession | null {
  if (!input.club) return null;
  const today = moscowToday(now);
  const upcoming = SESSIONS.filter((s) => s.club === input.club && s.date >= today).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  return upcoming.find((s) => s.date === input.date) ?? upcoming[0] ?? null;
}

/** Занятие, на которое уже записана строка club_signups (для бота). */
export function sessionOfSignup(row: {
  club: string;
  event_date: string;
  event_time: string;
}): ClubSession | null {
  return (
    SESSIONS.find(
      (s) => s.club === row.club && s.date === row.event_date && s.time === row.event_time,
    ) ?? null
  );
}
