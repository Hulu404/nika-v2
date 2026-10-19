import { publicOriginFromEnv } from "../public-origin";

/**
 * Опросы перед запуском клубов NIKA — единый источник правды о датах, подписях
 * и окнах. Сценарий и тексты: docs/club-survey.md.
 *
 * Устроено как COFFEE_RUNS в lib/coffeerun/run.ts: новый опрос = одна новая
 * запись в CLUB_SURVEYS. В текстах участнику даты и подписи подставляются
 * отсюда, руками в копирайте их не пишем.
 *
 * Здесь только то, что задаётся заранее. Всё, что появляется во время опроса
 * (ответы, итог, отметки рассылок), лежит в БД (migrations/063_club_surveys.sql).
 */

/** День-кандидат первой встречи. */
export interface SurveyDay {
  /** ISO YYYY-MM-DD — ровно то, что ложится в club_survey_responses.days. */
  date: string;
  /** Подпись кнопки и текстов: «Ср 28.10». */
  label: string;
}

/** Окно по московскому времени: с fromHour:00 включительно до toHour:00. */
export interface HourWindow {
  fromHour: number;
  toHour: number;
}

export interface ClubSurvey {
  /**
   * Ключ опроса: уходит в callback_data и в club_survey_responses.survey_key.
   * Только [a-z0-9], до 12 символов — иначе callback_data может не влезть в 64 байта.
   */
  key: string;
  /** Payload ссылки t.me/<бот>?start=<payload>. */
  startPayload: string;
  /** Дни-кандидаты первой встречи, хронологически. */
  days: SurveyDay[];
  /** Подпись недели в тексте 3: «с 28 октября по 1 ноября». */
  weekLabel: string;
  /** Когда пришлём итог, тексты 2а и 6: «в пятницу, 23 октября». */
  resultLabel: string;
  /** Срок голосования в напоминании, текст 7: «до четверга». */
  voteDeadlineLabel: string;
  /** Последний момент, когда ещё напоминаем незавершившим (ISO с поясом). */
  reminderDeadline: string;
  /** Сколько часов после первого сообщения ждём, прежде чем напомнить. */
  reminderDelayHours: number;
  /** Окно напоминания незавершившим, МСК. */
  reminderWindow: HourWindow;
  /** Окно напоминания накануне встречи, МСК. */
  eveWindow: HourWindow;
  /** Длительность занятия, минуты: промежуток короче — ошибка short. */
  sessionMinutes: number;
  /** Границы дня для разбора времени, HH:MM. */
  dayFrom: string;
  dayTo: string;
}

/**
 * Опросы по возрастанию дат. Прошедший опрос не удаляем, пока по нему могут
 * нажимать кнопки итога: ключ из callback_data ищется здесь.
 */
export const CLUB_SURVEYS: readonly ClubSurvey[] = [
  {
    key: "yoga",
    startPayload: "yoga",
    days: [
      { date: "2026-10-28", label: "Ср 28.10" },
      { date: "2026-10-29", label: "Чт 29.10" },
      { date: "2026-10-30", label: "Пт 30.10" },
      { date: "2026-10-31", label: "Сб 31.10" },
      { date: "2026-11-01", label: "Вс 01.11" },
    ],
    weekLabel: "с 28 октября по 1 ноября",
    resultLabel: "в пятницу, 23 октября",
    voteDeadlineLabel: "до четверга",
    reminderDeadline: "2026-10-22T12:00:00+03:00",
    reminderDelayHours: 24,
    reminderWindow: { fromHour: 10, toHour: 21 },
    eveWindow: { fromHour: 18, toHour: 21 },
    // Допущение: длительность занятия ещё не подтверждена инструктором.
    sessionMinutes: 60,
    dayFrom: "07:00",
    dayTo: "23:00",
  },
];

export function surveyByKey(key: string): ClubSurvey | null {
  return CLUB_SURVEYS.find((s) => s.key === key) ?? null;
}

/** Опрос по payload из /start; null — это не наш payload (например, токен привязки). */
export function surveyByStartPayload(payload: string): ClubSurvey | null {
  return CLUB_SURVEYS.find((s) => s.startPayload === payload) ?? null;
}

/**
 * Опрос, к которому относятся команды организатора без аргумента. Сейчас это
 * последний в списке: опросы не пересекаются по времени.
 */
export function activeSurvey(): ClubSurvey {
  return CLUB_SURVEYS[CLUB_SURVEYS.length - 1];
}

/**
 * Запасной origin, если NEXT_PUBLIC_APP_URL пуст или битый. Тот же, что у
 * getPublicOrigin в lib/public-origin.ts: ссылка на согласие должна быть
 * в тексте 2 всегда.
 */
export const ORIGIN_FALLBACK = "https://www.mynika.online";

/** Ссылка на документ согласия для текста 2. */
export function consentUrl(): string {
  return `${publicOriginFromEnv() ?? ORIGIN_FALLBACK}/legal/consent`;
}

/**
 * Ссылка для поста в чате кофе-ранов. null — не задано имя бота
 * (NEXT_PUBLIC_TELEGRAM_BOT_USERNAME): ссылку без него не собрать.
 */
export function surveyStartLink(survey: ClubSurvey): string | null {
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  if (!bot) return null;
  return `https://t.me/${bot}?start=${survey.startPayload}`;
}
