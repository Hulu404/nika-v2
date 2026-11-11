import { COFFEE_RUNS, RUN_DURATION_MIN, type CoffeeRun } from "../coffeerun/run";
import { SESSIONS, moscowToday, type ClubSession } from "../clubs/sessions";
import { runEventTitle, sessionEventTitle } from "../telegram/donation-copy";

/**
 * Правила сообщения после события («спасибо, что сегодня был(а)…»). Только
 * чистые функции: что за событие, когда окно, кому нельзя писать.
 * Отправка — lib/donations/after-event-dispatch.ts.
 */

/** Через сколько минут после окончания пишем. */
export const FOLLOWUP_AFTER_END_MIN = 40;
/** Окно: позже 60 минут после окончания уже не пишем (тикер мог проспать). */
export const FOLLOWUP_WINDOW_END_MIN = 60;
/** Не чаще раза в 28 дней — ни просьбы, ни после поддержки. */
export const FOLLOWUP_REPEAT_DAYS = 28;
/** Ночь по МСК: с 22:00 до 9:00 не пишем вовсе и на утро не переносим. */
export const NIGHT_FROM_HOUR = 22;
export const NIGHT_TO_HOUR = 9;

const MSK_MS = 3 * 60 * 60 * 1000;

export interface FollowupEvent {
  /** <spot>:<run_date> или <club>:<event_date> — ключ в event_followups и donations.event_ref. */
  ref: string;
  kind: "coffee_run" | "club";
  /** Формат для {event_prep}: coffeerun, pilates, bookclub. */
  format: string;
  /** Подпись для организатора: «Кофе-ран · Surf Coffee® × Cave, 15 ноября». */
  title: string;
  date: string;
  /** Фактический старт, с учётом переноса. */
  startTime: string;
  durationMin: number;
  run?: CoffeeRun;
  session?: ClubSession;
}

export function runRef(run: Pick<CoffeeRun, "spot" | "date">): string {
  return `${run.spot}:${run.date}`;
}

export function sessionRef(session: Pick<ClubSession, "club" | "date">): string {
  return `${session.club}:${session.date}`;
}

export function fromRunEvent(run: CoffeeRun, movedStart: string | null = null): FollowupEvent {
  return {
    ref: runRef(run),
    kind: "coffee_run",
    format: "coffeerun",
    title: runEventTitle(run.spotName, run.dateLabel),
    date: run.date,
    startTime: movedStart ?? run.startTime,
    durationMin: run.durationMin ?? RUN_DURATION_MIN,
    run,
  };
}

export function fromSessionEvent(session: ClubSession): FollowupEvent {
  return {
    ref: sessionRef(session),
    kind: "club",
    format: session.format,
    title: sessionEventTitle(session.title, session.dateLabel),
    date: session.date,
    startTime: session.time,
    durationMin: session.durationMin,
    session,
  };
}

/** Событие по ключу из кнопки: c:<spot>:<date> или k:<club>:<date>. */
export function eventByRef(kind: "coffee_run" | "club", ref: string): { run?: CoffeeRun; session?: ClubSession } | null {
  const [a, date] = ref.split(":");
  if (kind === "coffee_run") {
    const run = COFFEE_RUNS.find((r) => r.spot === a && r.date === date);
    return run ? { run } : null;
  }
  const session = SESSIONS.find((s) => s.club === a && s.date === date);
  return session ? { session } : null;
}

/** Момент «дата + ЧЧ:ММ по МСК». */
export function mskMoment(date: string, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  return new Date(Date.parse(`${date}T00:00:00Z`) + (h * 60 + m) * 60_000 - MSK_MS);
}

export function eventStart(event: Pick<FollowupEvent, "date" | "startTime">): Date {
  return mskMoment(event.date, event.startTime);
}

export function eventEnd(event: Pick<FollowupEvent, "date" | "startTime" | "durationMin">): Date {
  return new Date(eventStart(event).getTime() + event.durationMin * 60_000);
}

export function mskHour(now: Date): number {
  return new Date(now.getTime() + MSK_MS).getUTCHours();
}

export function isNightMsk(now: Date): boolean {
  const h = mskHour(now);
  return h >= NIGHT_FROM_HOUR || h < NIGHT_TO_HOUR;
}

/** Пора ли писать автоматически: от 40 до 60 минут после окончания и не ночью. */
export function inAutoWindow(event: Pick<FollowupEvent, "date" | "startTime" | "durationMin">, now: Date): boolean {
  if (isNightMsk(now)) return false;
  const sinceEnd = (now.getTime() - eventEnd(event).getTime()) / 60_000;
  return sinceEnd >= FOLLOWUP_AFTER_END_MIN && sinceEnd <= FOLLOWUP_WINDOW_END_MIN;
}

/** Событие сегодня и уже стартовало — его можно закрыть командой /done. */
export function startedToday(event: Pick<FollowupEvent, "date" | "startTime">, now: Date): boolean {
  return event.date === moscowToday(now) && eventStart(event).getTime() <= now.getTime();
}

/** Начало сегодняшнего дня по МСК (для «в этот же день купил билет»). */
export function mskDayStart(now: Date): Date {
  return new Date(Date.parse(`${moscowToday(now)}T00:00:00Z`) - MSK_MS);
}

export function repeatSince(now: Date): Date {
  return new Date(now.getTime() - FOLLOWUP_REPEAT_DAYS * 86_400_000);
}

export interface Attendee {
  chatId: number;
  /** Строка заявки, в которой ставится donation_asked_at. */
  rowId: string;
  table: "coffee_run_signups" | "club_signups";
}

export interface Exclusions {
  /** Получали такое сообщение меньше 28 дней назад. */
  askedRecently: ReadonlySet<number>;
  /** Поддерживали клуб (paid) меньше 28 дней назад. */
  donatedRecently: ReadonlySet<number>;
  /** Купили билет в этот же день. */
  boughtToday: ReadonlySet<number>;
  /** Сделали /stop. */
  optedOut: ReadonlySet<number>;
}

/** Кому писать: по одному разу на человека, минус все исключения. */
export function pickRecipients(attendees: readonly Attendee[], ex: Exclusions): Attendee[] {
  const seen = new Set<number>();
  const out: Attendee[] = [];
  for (const a of attendees) {
    if (seen.has(a.chatId)) continue;
    seen.add(a.chatId);
    if (ex.askedRecently.has(a.chatId) || ex.donatedRecently.has(a.chatId)) continue;
    if (ex.boughtToday.has(a.chatId) || ex.optedOut.has(a.chatId)) continue;
    out.push(a);
  }
  return out;
}

/** Флаг рассылки после события: только DONATIONS_AFTER_EVENT=1. */
export function afterEventEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DONATIONS_AFTER_EVENT?.trim() === "1";
}

/** Ники, которым доступна /done (EVENT_DONE_USERNAMES), без @ и регистра. */
export function doneUsernames(env: Record<string, string | undefined> = process.env): Set<string> {
  const raw = env.EVENT_DONE_USERNAMES ?? "meine_nika,hulu404";
  return new Set(raw.split(",").map((u) => u.trim().replace(/^@/, "").toLowerCase()).filter(Boolean));
}
