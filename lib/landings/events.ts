import { COFFEE_RUNS, type CoffeeRun } from "../coffeerun/run";
import { SESSIONS, moscowToday, sessionForSignup, type ClubSession } from "../clubs/sessions";

/**
 * Событие лендинга в одном виде для забега и для занятия клуба.
 *
 * Из этих полей собираются и страница (lib/landings/render.ts), и экран
 * «Расписание» в боте (lib/telegram/menu.ts): формулировки даты, времени и
 * места совпадают, потому что берутся из одного объекта.
 */
export interface LandingEvent {
  kind: "coffeerun" | "club";
  /** Имя лендинга: путь без слэша, «stretch», «coffeerunsurfcave». */
  landing: string;
  /** Путь лендинга на сайте: «/stretch». */
  path: string;
  /** Короткое имя для кнопки «Записаться: …». */
  title: string;
  /** Формат для значка в расписании: 'coffeerun', 'pilates', 'bookclub'… */
  format: string;
  date: string;
  dateLabel: string;
  weekday: string;
  gatherTime: string;
  startTime: string;
  /** Полный адрес: «Москва, ул. Усачёва, 62». */
  address: string;
  /** Где именно: спот или студия. */
  place: string;
  metro?: string;
  mapUrl: string;
  edition?: number;
  /** Только у клуба; у кофе-рана участие бесплатное и цены нет. */
  priceRub?: number;
  run?: CoffeeRun;
  session?: ClubSession;
}

type LandingSource = { kind: "coffeerun" } | { kind: "club"; club: string };

/** Лендинги, которые сервер отдаёт с подстановкой данных события. */
export const LANDINGS: Record<string, LandingSource> = {
  coffeerunsurfsport: { kind: "coffeerun" },
  coffeerunsurfcave: { kind: "coffeerun" },
  coffeerunluzhniki: { kind: "coffeerun" },
  stretch: { kind: "club", club: "stretch" },
  read: { kind: "club", club: "read" },
};

export function isLandingName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(LANDINGS, name);
}

export function fromRun(run: CoffeeRun): LandingEvent {
  return {
    kind: "coffeerun",
    landing: run.landing.replace(/^\//, ""),
    path: run.landing,
    title: run.spotName,
    format: "coffeerun",
    date: run.date,
    dateLabel: run.dateLabel,
    weekday: run.weekday,
    gatherTime: run.gatherTime,
    startTime: run.startTime,
    address: run.address,
    place: run.place,
    mapUrl: run.mapUrl,
    edition: run.edition,
    run,
  };
}

export function fromSession(session: ClubSession): LandingEvent {
  return {
    kind: "club",
    landing: session.landing.replace(/^\//, ""),
    path: session.landing,
    title: session.title,
    format: session.format,
    date: session.date,
    dateLabel: session.dateLabel,
    weekday: session.weekday,
    gatherTime: session.gatherAt,
    startTime: session.time,
    address: session.address ?? session.place,
    place: session.place,
    metro: session.metro,
    mapUrl: session.mapUrl,
    edition: session.edition,
    priceRub: session.priceRub,
    session,
  };
}

/** Забег считается будущим весь свой день по МСК — так же, как в run.ts. */
function runIsUpcoming(run: CoffeeRun, now: Date): boolean {
  return run.date >= moscowToday(now);
}

/**
 * Событие лендинга: ближайшее будущее, а если будущих нет — последнее
 * прошедшее, чтобы страница открылась (форма сама скажет, что записи нет).
 * null — у лендинга нет ни одного события в run.ts / sessions.ts.
 */
export function eventForLanding(name: string, now: Date = new Date()): LandingEvent | null {
  const source = LANDINGS[name];
  if (!source) return null;
  const path = `/${name}`;

  if (source.kind === "coffeerun") {
    const runs = COFFEE_RUNS.filter((r) => r.landing === path).sort((a, b) => a.date.localeCompare(b.date));
    const run = runs.find((r) => runIsUpcoming(r, now)) ?? runs[runs.length - 1];
    return run ? fromRun(run) : null;
  }

  const upcoming = sessionForSignup({ club: source.club, date: null }, now);
  if (upcoming) return fromSession(upcoming);
  const past = SESSIONS.filter((s) => s.club === source.club).sort((a, b) =>
    `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
  );
  const last = past[past.length - 1];
  return last ? fromSession(last) : null;
}

/** Время «H:MM» → минуты от полуночи. */
function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Все будущие события (забеги и занятия клубов) по дате и времени старта.
 * Сегодняшнее событие считается будущим весь день, как и в формах записи.
 */
export function upcomingEvents(now: Date = new Date()): LandingEvent[] {
  const today = moscowToday(now);
  const events = [
    ...COFFEE_RUNS.filter((r) => r.date >= today).map(fromRun),
    ...SESSIONS.filter((s) => s.date >= today).map(fromSession),
  ];
  return events.sort(
    (a, b) => a.date.localeCompare(b.date) || minutesOf(a.startTime) - minutesOf(b.startTime),
  );
}
