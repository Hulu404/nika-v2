import { ZONES, type Zone } from "./types";

/**
 * Валидаторы параметров бота данных. Одни и те же для callback_data и для
 * разбора текста/модели (ТЗ 4.2, 4.3): кнопка из старого сообщения, фраза
 * человека и ответ pick_report — всё это недоверенный ввод, и если правила
 * разойдутся, через один из входов пролезет то, что другой отсекает.
 *
 * Все регэкспы якорены с обеих сторон и без флага i: регистр — часть формата
 * (метка всегда верхним, слаги нижним). Нормализацию регистра делает
 * вызывающий (разбор текста), а не валидатор — иначе «igst-0310» из кнопки
 * молча стал бы валидным, хотя кнопки мы собираем сами и такого не шлём.
 */

export function isZone(s: unknown): s is Zone {
  return typeof s === "string" && (ZONES as readonly string[]).includes(s);
}

/**
 * chat_id личного чата: положительное целое. Ведущие нули запрещены, чтобы
 * у одного человека не было двух строковых написаний (ключ в журнале, в
 * tg_sessions). У Telegram id занимает до 52 значащих бит — это до 16 цифр;
 * Number держит такое число точно (< 2^53), что и проверяем.
 */
const CHAT_ID_RE = /^[1-9][0-9]{0,15}$/;
export function isChatId(s: string): boolean {
  return CHAT_ID_RE.test(s) && Number.isSafeInteger(Number(s));
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Реальная календарная дата. Считаем вручную, а не через Date: new Date
 * молча переносит 2026-02-30 на 2 марта, а Date.UTC ещё и превращает годы
 * 0–99 в 1900-е.
 */
function isRealDate(y: number, m: number, d: number): boolean {
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  const max = m === 2 && isLeap(y) ? 29 : MONTH_DAYS[m - 1];
  return d <= max;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isIsoDate(s: string): boolean {
  const m = ISO_DATE_RE.exec(s);
  return !!m && isRealDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

/**
 * Слаг спота (coffee_run_signups.spot: luzhniki, usachevo). Начинается с
 * буквы — так он не спутается с датой или числом в разборе текста. Потолок 24
 * держит самую длинную кнопку раздела (d:run:people:<спот>:<дата>:<стр>) в
 * 64 байтах с запасом — см. callback.test.ts.
 */
export const SPOT_SLUG_MAX = 24;
const SPOT_SLUG_RE = new RegExp(`^[a-z][a-z0-9-]{1,${SPOT_SLUG_MAX - 1}}$`);
export function isSpotSlug(s: string): boolean {
  return SPOT_SLUG_RE.test(s);
}

/** Код метки link_codes (ТЗ 4.3, правило имени 4.5): IGST-0310, TGPIN. */
const LINK_CODE_RE = /^[A-Z0-9-]{2,12}$/;
export function isLinkCode(s: string): boolean {
  return LINK_CODE_RE.test(s);
}

/** databot_kb.slug — тот же check, что в миграции (ТЗ 5). */
const KB_SLUG_RE = /^[a-z0-9-]{2,40}$/;
export function isKbSlug(s: string): boolean {
  return KB_SLUG_RE.test(s);
}

/**
 * Токен приглашения — как в invite.ts, но строго нижний регистр: здесь
 * проверяем уже нормализованное значение (кнопки, база), а терпимость к
 * регистру живёт только в inviteTokenFromStart.
 */
const INVITE_TOKEN_RE = /^[0-9a-f]{32}$/;
export function isInviteToken(s: string): boolean {
  return INVITE_TOKEN_RE.test(s);
}

/** Номер страницы списка: 1..999. Три цифры — это и потолок длины кнопки. */
const PAGE_RE = /^[1-9][0-9]{0,2}$/;
export function isPage(s: string): boolean {
  return PAGE_RE.test(s);
}

/** Пресеты периода (ТЗ 4.6): 7 дней, прошлая неделя, этот месяц, 30 дней. */
export type PeriodPreset = "7d" | "pw" | "tm" | "30d";
const PERIOD_PRESETS: readonly PeriodPreset[] = ["7d", "pw", "tm", "30d"];

/**
 * Потолок своего периода в днях включительно: 366, чтобы влез целый
 * високосный год. Длиннее — это уже не «свой период», а тяжёлый запрос по
 * всей базе из одной кнопки.
 */
export const PERIOD_MAX_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_RE = /^(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})$/;

export type ParsedPeriod =
  | { kind: "preset"; preset: PeriodPreset }
  | { kind: "range"; from: string; to: string };

function pad(n: number, w: number): string {
  return String(n).padStart(w, "0");
}

/**
 * Период в callback_data. Свой период пишется без дефисов внутри дат
 * (YYYYMMDD-YYYYMMDD, 17 байт), а не как две ISO-даты (21 байт): дефис
 * остаётся одним разделителем, а кнопки с меткой и страницей не упираются в
 * 64 байта.
 */
export function parsePeriodCode(s: string): ParsedPeriod | null {
  if ((PERIOD_PRESETS as readonly string[]).includes(s)) {
    return { kind: "preset", preset: s as PeriodPreset };
  }
  const m = RANGE_RE.exec(s);
  if (!m) return null;
  const [fy, fm, fd, ty, tm, td] = m.slice(1).map(Number);
  if (!isRealDate(fy, fm, fd) || !isRealDate(ty, tm, td)) return null;
  // Date.UTC переносит годы 0–99 в 1900-е, и период 0099→0100 вышел бы
  // длиной в 1900 лет; год ставим отдельно через setUTCFullYear.
  const utc = (y: number, mo: number, d: number) => {
    const t = new Date(Date.UTC(2000, mo - 1, d));
    t.setUTCFullYear(y);
    return t.getTime();
  };
  const days = Math.round((utc(ty, tm, td) - utc(fy, fm, fd)) / DAY_MS) + 1;
  if (days < 1 || days > PERIOD_MAX_DAYS) return null;
  return {
    kind: "range",
    from: `${pad(fy, 4)}-${pad(fm, 2)}-${pad(fd, 2)}`,
    to: `${pad(ty, 4)}-${pad(tm, 2)}-${pad(td, 2)}`,
  };
}

export function isPeriodCode(s: string): boolean {
  return parsePeriodCode(s) !== null;
}

/**
 * Обратное к parsePeriodCode для своего периода. Бросает на кривом входе:
 * такой период собрал наш код, и кнопку с ним отправлять нельзя (как cb).
 */
export function periodCode(p: { from: string; to: string }): string {
  const code = `${p.from.replace(/-/g, "")}-${p.to.replace(/-/g, "")}`;
  if (!isIsoDate(p.from) || !isIsoDate(p.to) || parsePeriodCode(code)?.kind !== "range") {
    throw new Error(`period: неверный период ${p.from}..${p.to}`);
  }
  return code;
}
