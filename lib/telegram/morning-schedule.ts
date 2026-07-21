/**
 * Чистые предикаты крона утреннего нуджа (разделы 4, 6 ТЗ): окно «пора»,
 * защита от ночи/тихих часов, пауза. Без БД и Intl — легко тестируются.
 * Локальная дата/минуты берутся из lib/telegram/schedule (localParts/localDate).
 */

/** Шаг крона: Vercel дёргает эндпоинт раз в 15 мин (см. vercel.json). */
export const MORNING_CRON_STEP_MIN = 15;

/** Жёсткая защита от ночи: не шлём с 22:00 до 06:00 даже при сдвинутом morning_time. */
export const NIGHT_START_HOUR = 22;
export const NIGHT_END_HOUR = 6;

/** "08:00" | "08:00:00" → минуты от полуночи. Мусор → 0 (безопасно). */
export function parseHhmm(t: string | null | undefined): number {
  if (!t) return 0;
  const [h, m] = t.split(":");
  const hh = Number(h);
  const mm = Number(m);
  return ((Number.isFinite(hh) ? hh : 0) % 24) * 60 + (Number.isFinite(mm) ? mm : 0);
}

/**
 * «Пора»: локальное время попало в окно [morning_time, morning_time + шаг_крона).
 * Так каждая пользовательница проходит ровно один тик в день.
 */
export function isPora(
  minuteOfDay: number,
  morningTime: string | null | undefined,
  stepMin: number = MORNING_CRON_STEP_MIN,
): boolean {
  const start = parseHhmm(morningTime);
  return minuteOfDay >= start && minuteOfDay < start + stepMin;
}

/** Ночь по жёсткой защите (22:00–06:00). */
export function isNightHour(hour: number): boolean {
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

export interface QuietHours {
  start?: string | null;
  end?: string | null;
}

/**
 * Тихое ли сейчас время. Ночь (22–06) тихая ВСЕГДА — защита от сдвинутого
 * morning_time. Плюс пользовательские quiet_hours {start,end} (поддержка
 * перехода через полночь: start>end).
 */
export function isQuiet(
  hour: number,
  minuteOfDay: number,
  quietHours?: QuietHours | null,
): boolean {
  if (isNightHour(hour)) return true;
  if (quietHours?.start && quietHours?.end) {
    const s = parseHhmm(quietHours.start);
    const e = parseHhmm(quietHours.end);
    if (s === e) return false;
    return s < e ? minuteOfDay >= s && minuteOfDay < e : minuteOfDay >= s || minuteOfDay < e;
  }
  return false;
}

/**
 * На паузе ли пользователь. pause_until — дата (YYYY-MM-DD): пауза активна, пока
 * until >= сегодня (локально). Пусто или в прошлом → не на паузе. Сравнение строк
 * YYYY-MM-DD лексикографически корректно.
 */
export function isPaused(
  pauseUntil: string | null | undefined,
  localDateYmd: string,
): boolean {
  if (!pauseUntil) return false;
  return pauseUntil.slice(0, 10) >= localDateYmd;
}
