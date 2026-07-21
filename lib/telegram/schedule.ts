/**
 * Правила частоты и «локального утра» для рассылки чек-инов (раздел 9 ТЗ).
 * Вся формула частоты — здесь, не размазана по крону.
 */

export const DEFAULT_TZ = "Europe/Moscow";
/** Локальные часы, которые считаем «утром» для чек-ина. */
export const MORNING_HOURS = [8, 9];

/** Базовое расписание: 3 раза в неделю (Пн/Ср/Пт). JS getDay: Вс=0…Сб=6. */
export const BASE_CHECKIN_WEEKDAYS = [1, 3, 5];
/** Сниженное расписание при апатии: только Пн. */
export const REDUCED_CHECKIN_WEEKDAYS = [1];
/** Сколько пропусков подряд включают сниженную частоту. */
export const MISS_STREAK_FOR_REDUCE = 3;

export interface ScheduleInput {
  /** Локальный день недели пользователя (0–6). */
  weekday: number;
  /** Уже спрашивали сегодня (любой чек-ин за локальный день). */
  askedToday: boolean;
  /** answer последних чек-инов, самый свежий первым (null = без ответа). */
  recentAnswers: (string | null)[];
}

/** Сколько последних чек-инов подряд без ответа (с самого свежего). */
export function countLeadingMisses(recentAnswers: (string | null)[]): number {
  let n = 0;
  for (const a of recentAnswers) {
    if (a == null) n++;
    else break;
  }
  return n;
}

/**
 * ЕДИНСТВЕННОЕ место правил: слать ли чек-ин сегодня.
 * Базово 3×/неделю; при 3 пропусках подряд — реже; первый ответ возвращает к
 * норме (свежий не-null сбрасывает счётчик). Дедуп «за сегодня».
 *
 * TODO(частота): учитывать дни запланированных забегов и тонкую настройку
 * пользователя (профиль/notification_prefs) — см. открытые вопросы спеки.
 */
export function shouldSendCheckin(input: ScheduleInput): boolean {
  if (input.askedToday) return false; // дедуп Промта 5
  const reduced = countLeadingMisses(input.recentAnswers) >= MISS_STREAK_FOR_REDUCE;
  const days = reduced ? REDUCED_CHECKIN_WEEKDAYS : BASE_CHECKIN_WEEKDAYS;
  return days.includes(input.weekday);
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** Валидна ли IANA-таймзона (иначе вернём дефолт). */
export function validTimezone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

/**
 * Локальные час / минута / день недели / дата (YYYY-MM-DD) в заданной таймзоне.
 * `minuteOfDay` = hour*60+minute — удобно для окна утреннего нуджа.
 */
export function localParts(
  tz: string,
  now: Date = new Date(),
): { hour: number; minute: number; minuteOfDay: number; weekday: number; ymd: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = parseInt(get("hour"), 10) % 24; // "24" в полночь → 0
  const minute = parseInt(get("minute"), 10) || 0;
  const weekday = WEEKDAY_INDEX[get("weekday")] ?? 0;
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  return { hour, minute, minuteOfDay: hour * 60 + minute, weekday, ymd };
}

/**
 * Локальная дата (YYYY-MM-DD) пользователя в его таймзоне. ЕДИНЫЙ хелпер для
 * дедупа/идемпотентности нуджа: local_date считаем в tz пользователя, не в UTC
 * сервера, иначе на границе суток дедуп и слот-инсерт поедут.
 */
export function localDate(tz: string, now: Date = new Date()): string {
  return localParts(tz, now).ymd;
}
