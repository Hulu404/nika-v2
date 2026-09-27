import { escapeHtml } from "./html";
import { mskTime } from "./time";

/**
 * Формат ответов бота (ТЗ 4.10) — по функции на правило. Чистые функции без
 * базы и без часов; текст ответа собирается только из них, чтобы «13 410 ₽»
 * и «сб 03.10» выглядели одинаково во всех разделах.
 */

export { escapeHtml };

/** Целое с пробелом между разрядами: 13410 → «13 410». Отрицательные — с минусом. */
export function formatInt(n: number): string {
  const sign = n < 0 ? "−" : "";
  const digits = String(Math.round(Math.abs(n)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Сумма в рублях: «13 410 ₽», копейки — только если они есть: «299,50 ₽».
 * В базе amount — рубли (numeric(10,2)), переводить не нужно.
 */
export function formatRub(amount: number): string {
  const cents = Math.round(Math.abs(amount) * 100) % 100;
  const whole = formatInt(amount < 0 ? Math.ceil(amount) : Math.floor(amount));
  return cents === 0 ? `${whole} ₽` : `${whole},${String(cents).padStart(2, "0")} ₽`;
}

/** Процент без дробной части: «92 %» — неразрывность не нужна, так в примерах ТЗ. */
export function formatPercent(part: number, whole: number): string | null {
  if (whole <= 0) return null;
  return `${Math.round((part / whole) * 100)} %`;
}

const WEEKDAY_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

/** «03.10» из YYYY-MM-DD. */
export function formatDdMm(ymd: string): string {
  return `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
}

/** «сб 03.10» из YYYY-MM-DD. День недели у календарной даты от пояса не зависит. */
export function formatDayDate(ymd: string): string {
  const weekday = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return `${WEEKDAY_SHORT[weekday]} ${formatDdMm(ymd)}`;
}

/**
 * Период «21.09–27.09», даты включительно. Один день — «03.10». Если годы
 * разные — с годом: «28.12.2025–03.01.2026», иначе через Новый год
 * непонятно, какой декабрь.
 */
export function formatPeriodRange(fromYmd: string, toYmd: string): string {
  if (fromYmd === toYmd) return formatDdMm(fromYmd);
  if (fromYmd.slice(0, 4) !== toYmd.slice(0, 4)) {
    const full = (ymd: string) => `${formatDdMm(ymd)}.${ymd.slice(0, 4)}`;
    return `${full(fromYmd)}–${full(toYmd)}`;
  }
  return `${formatDdMm(fromYmd)}–${formatDdMm(toYmd)}`;
}

/** «14:32 МСК». */
export function formatMskTime(at: Date): string {
  return `${mskTime(at)} МСК`;
}

/** Формы слова: [одна, две, пять] — «заявка», «заявки», «заявок». */
export type WordForms = readonly [one: string, few: string, many: string];

/** Нужная форма для числа: 1, 21, 101 — one; 2–4, 22–24 — few; остальное, включая 11–14, — many. */
export function pluralForm(n: number, forms: WordForms): string {
  const abs = Math.abs(Math.trunc(n));
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

/** «5 заявок», «13 410 переходов». */
export function countWord(n: number, forms: WordForms): string {
  return `${formatInt(n)} ${pluralForm(n, forms)}`;
}

/** Частые слова ответов — чтобы формы не писали каждый раз заново. */
export const WORDS = {
  signup: ["заявка", "заявки", "заявок"],
  click: ["переход", "перехода", "переходов"],
  person: ["человек", "человека", "человек"],
  payment: ["оплата", "оплаты", "оплат"],
  code: ["код", "кода", "кодов"],
  day: ["день", "дня", "дней"],
  run: ["забег", "забега", "забегов"],
  registration: ["регистрация", "регистрации", "регистраций"],
} as const satisfies Record<string, WordForms>;
