import { localParts } from "../telegram/schedule";

/**
 * Время бота данных — всегда Europe/Moscow: даты забегов, окна доступа,
 * уборка. Даты — строки YYYY-MM-DD, как run_date в базе и date в COFFEE_RUNS.
 */
export const DATABOT_TZ = "Europe/Moscow";

/** Сегодняшняя московская дата. */
export function mskToday(now: Date = new Date()): string {
  return localParts(DATABOT_TZ, now).ymd;
}

/** Московский час (0–23). */
export function mskHour(now: Date = new Date()): number {
  return localParts(DATABOT_TZ, now).hour;
}

/** Сдвиг календарной даты на n дней. Считаем в UTC: у даты нет часового пояса. */
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Время для подписей «Данные на 14:32 МСК» и «последний визит». */
export function mskTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const { hour, minute } = localParts(DATABOT_TZ, d);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Дата в виде 03.10 по Москве. */
export function mskDayMonth(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const ymd = localParts(DATABOT_TZ, d).ymd;
  return `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
}
