import { COFFEE_RUNS, type CoffeeRun } from "../coffeerun/run";
import { DueError, parseDue } from "../databot/assigned-due";
import { addDays, mskToday } from "../databot/time";
import { tgAdmin } from "../telegram/supabase";
import { COFFEE_RUN_CLUB } from "./clubs";
import { isFounder } from "./config";

/**
 * Расписание команды: события из team_events (миграция 046) плюс кофе-раны из
 * COFFEE_RUNS. Кофе-раны только читаются: их формат и смысл принадлежат
 * лендингу и рассылкам участникам, командный бот в них не пишет.
 */

export type TeamEventKind = "club_event" | "meeting" | "other";

export interface TeamEvent {
  id: number;
  kind: TeamEventKind;
  club: string | null;
  title: string;
  starts_at: string;
  place: string | null;
  notes: string | null;
  responsible_chat_id: number | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
}

export type NewTeamEvent = Pick<TeamEvent, "kind" | "club" | "title" | "starts_at" | "place" | "responsible_chat_id" | "created_by">;

export interface TeamEventStore {
  create(row: NewTeamEvent, now: Date): Promise<TeamEvent>;
  get(id: number): Promise<TeamEvent | null>;
  /** Все неотменённые события с началом в [from, to). */
  listBetween(from: Date, to: Date): Promise<TeamEvent[]>;
  /** Прошедшие неотменённые ивенты клубов, от новых к старым. */
  listPastClubEvents(before: Date, limit: number): Promise<TeamEvent[]>;
  setTime(id: number, startsAt: string, now: Date): Promise<TeamEvent | null>;
  setResponsible(id: number, chatId: number, now: Date): Promise<TeamEvent | null>;
  cancel(id: number, now: Date): Promise<TeamEvent | null>;
}

const COLUMNS = "id, kind, club, title, starts_at, place, notes, responsible_chat_id, created_by, created_at, updated_at, cancelled_at";

export function supabaseEventStore(): TeamEventStore {
  const t = () => tgAdmin().from("team_events");
  const one = (data: unknown) => (data as TeamEvent | null) ?? null;
  return {
    async create(row, now) {
      const { data, error } = await t()
        .insert({ ...row, created_at: now.toISOString(), updated_at: now.toISOString() })
        .select(COLUMNS).single();
      if (error) throw new Error(`team_events: ${error.message}`);
      return data as TeamEvent;
    },
    async get(id) {
      const { data, error } = await t().select(COLUMNS).eq("id", id).maybeSingle();
      if (error) throw new Error(`team_events: ${error.message}`);
      return one(data);
    },
    async listBetween(from, to) {
      const { data, error } = await t().select(COLUMNS).is("cancelled_at", null)
        .gte("starts_at", from.toISOString()).lt("starts_at", to.toISOString()).order("starts_at");
      if (error) throw new Error(`team_events: ${error.message}`);
      return (data ?? []) as TeamEvent[];
    },
    async listPastClubEvents(before, limit) {
      const { data, error } = await t().select(COLUMNS).is("cancelled_at", null).eq("kind", "club_event")
        .lt("starts_at", before.toISOString()).order("starts_at", { ascending: false }).limit(limit);
      if (error) throw new Error(`team_events: ${error.message}`);
      return (data ?? []) as TeamEvent[];
    },
    async setTime(id, startsAt, now) {
      const { data, error } = await t().update({ starts_at: startsAt, updated_at: now.toISOString() })
        .eq("id", id).is("cancelled_at", null).select(COLUMNS).maybeSingle();
      if (error) throw new Error(`team_events: ${error.message}`);
      return one(data);
    },
    async setResponsible(id, chatId, now) {
      // Только если ответственного ещё нет: двое нажали «Я ответственный» одновременно — выиграет первый.
      const { data, error } = await t().update({ responsible_chat_id: chatId, updated_at: now.toISOString() })
        .eq("id", id).is("responsible_chat_id", null).select(COLUMNS).maybeSingle();
      if (error) throw new Error(`team_events: ${error.message}`);
      return one(data);
    },
    async cancel(id, now) {
      const { data, error } = await t().update({ cancelled_at: now.toISOString(), updated_at: now.toISOString() })
        .eq("id", id).is("cancelled_at", null).select(COLUMNS).maybeSingle();
      if (error) throw new Error(`team_events: ${error.message}`);
      return one(data);
    },
  };
}

/** Для тестов. */
export class MemoryEventStore implements TeamEventStore {
  events = new Map<number, TeamEvent>();
  private next = 1;
  async create(row: NewTeamEvent, now: Date) {
    const ev: TeamEvent = { ...row, id: this.next++, notes: null, created_at: now.toISOString(), updated_at: now.toISOString(), cancelled_at: null };
    this.events.set(ev.id, ev);
    return { ...ev };
  }
  async get(id: number) {
    const ev = this.events.get(id);
    return ev ? { ...ev } : null;
  }
  async listBetween(from: Date, to: Date) {
    return [...this.events.values()]
      .filter((e) => !e.cancelled_at && Date.parse(e.starts_at) >= from.getTime() && Date.parse(e.starts_at) < to.getTime())
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)).map((e) => ({ ...e }));
  }
  async listPastClubEvents(before: Date, limit: number) {
    return [...this.events.values()]
      .filter((e) => !e.cancelled_at && e.kind === "club_event" && Date.parse(e.starts_at) < before.getTime())
      .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at)).slice(0, limit).map((e) => ({ ...e }));
  }
  async setTime(id: number, startsAt: string, now: Date) {
    const ev = this.events.get(id);
    if (!ev || ev.cancelled_at) return null;
    Object.assign(ev, { starts_at: startsAt, updated_at: now.toISOString() });
    return { ...ev };
  }
  async setResponsible(id: number, chatId: number, now: Date) {
    const ev = this.events.get(id);
    if (!ev || ev.responsible_chat_id !== null) return null;
    Object.assign(ev, { responsible_chat_id: chatId, updated_at: now.toISOString() });
    return { ...ev };
  }
  async cancel(id: number, now: Date) {
    const ev = this.events.get(id);
    if (!ev || ev.cancelled_at) return null;
    Object.assign(ev, { cancelled_at: now.toISOString(), updated_at: now.toISOString() });
    return { ...ev };
  }
}

// ── Разбор /event ────────────────────────────────────────────────────────────

export class EventParseError extends Error {}

export interface EventDraft {
  title: string;
  startsAt: string;
  place: string | null;
  /** Ник ответственного без @, как его написали; проверяется по составу отдельно. */
  responsible: string | null;
}

/**
 * «/event Название / дата время / место / @ответственный». Место и
 * ответственный необязательны, время обязательно. Дату и время понимает тот же
 * разборщик, что сроки задач: «пт 19:00», «завтра 12:00», «03.10 18:00».
 */
export function parseEventLine(text: string, now: Date): EventDraft {
  const body = text.replace(/^\/event(?:@\w+)?\s*/i, "").trim();
  if (!body) throw new EventParseError("Формат: /event Название / дата время / место / @ответственный. Место и ответственный необязательны.");
  const fields = body.split(/\s+\/\s+|\s*\/\s*(?=@)/).map((f) => f.trim());
  if (fields.length < 2 || fields.length > 4) {
    throw new EventParseError("Нужно от двух до четырёх полей через « / »: название / дата время / место / @ответственный.");
  }
  const [title, when, ...rest] = fields;
  if (!title || title.length > 200) throw new EventParseError("Название события — от 1 до 200 символов.");
  if (!/\d{1,2}:\d{2}/.test(when)) throw new EventParseError(`Не вижу времени в «${when}». Укажи его: «пт 19:00», «завтра 12:00», «03.10 18:00».`);
  let startsAt: Date;
  try {
    startsAt = parseDue(when, now);
  } catch (err) {
    if (err instanceof DueError) {
      throw new EventParseError(err.message === "Срок уже прошёл." ? "Это время уже прошло." : err.message.replace("Не понял срок", "Не поняла дату"));
    }
    throw err;
  }
  let place: string | null = null;
  let responsible: string | null = null;
  for (const f of rest) {
    if (/^@[a-z0-9_]{1,32}$/i.test(f)) {
      if (responsible) throw new EventParseError("Ответственный один: @ник.");
      responsible = f.slice(1).toLowerCase();
    } else if (f) {
      if (place) throw new EventParseError("Похоже, полей больше, чем нужно: название / дата время / место / @ответственный.");
      place = f.slice(0, 200);
    }
  }
  return { title, startsAt: startsAt.toISOString(), place, responsible };
}

/** Время события из одного поля: «пт 19:00». Для «Изменить время». */
export function parseEventTime(text: string, now: Date): string {
  return parseEventLine(`/event x / ${text.trim()}`, now).startsAt;
}

// ── Права ────────────────────────────────────────────────────────────────────

/** Менять время и отменять: автор, ответственный и фаундеры. */
export function canManageEvent(ev: Pick<TeamEvent, "created_by" | "responsible_chat_id">, actorId: number): boolean {
  return ev.created_by === actorId || ev.responsible_chat_id === actorId || isFounder(actorId);
}

// ── Расписание ───────────────────────────────────────────────────────────────

export type ScheduleItem =
  | { source: "event"; startsAt: string; event: TeamEvent }
  | { source: "coffeerun"; startsAt: string; run: CoffeeRun };

/** Кофе-ран коротко: «Кофе-ран Усачёва», «Кофе-ран Лужники». */
export function coffeeRunTitle(run: Pick<CoffeeRun, "spotName">): string {
  const name = run.spotName.includes(",") ? run.spotName.split(",").at(-1)!.trim() : run.spotName.replace(/^Surf Coffee®?\s*/i, "").trim();
  return `Кофе-ран ${name || run.spotName}`;
}

/** Момент старта кофе-рана по Москве. */
export function coffeeRunStart(run: Pick<CoffeeRun, "date" | "startTime">): string {
  const [h, m] = run.startTime.split(":");
  return new Date(`${run.date}T${h.padStart(2, "0")}:${m}:00+03:00`).toISOString();
}

export const coffeeRunKey = (run: Pick<CoffeeRun, "spot" | "date">) => `coffeerun:${run.spot}:${run.date}`;
export const eventKey = (ev: Pick<TeamEvent, "id">) => `event:${ev.id}`;

/** Неделя расписания: семь московских дней начиная с сегодня (offset — недели вперёд). */
export function weekRange(now: Date, offset = 0): { fromYmd: string; days: string[] } {
  const fromYmd = addDays(mskToday(now), offset * 7);
  return { fromYmd, days: Array.from({ length: 7 }, (_, i) => addDays(fromYmd, i)) };
}

/** События и кофе-раны недели, по времени. Кофе-раны — как ивент «Бегового клуба». */
export function scheduleItems(
  events: readonly TeamEvent[],
  days: readonly string[],
  runs: readonly CoffeeRun[] = COFFEE_RUNS,
): ScheduleItem[] {
  const set = new Set(days);
  const items: ScheduleItem[] = [
    ...events.filter((e) => !e.cancelled_at && set.has(mskToday(new Date(e.starts_at))))
      .map((event) => ({ source: "event" as const, startsAt: event.starts_at, event })),
    ...runs.filter((r) => set.has(r.date)).map((run) => ({ source: "coffeerun" as const, startsAt: coffeeRunStart(run), run })),
  ];
  return items.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/** Группировка по московским дням; пустые дни выпадают. */
export function groupByDay(items: readonly ScheduleItem[]): Array<{ ymd: string; items: ScheduleItem[] }> {
  const map = new Map<string, ScheduleItem[]>();
  for (const it of items) {
    const ymd = mskToday(new Date(it.startsAt));
    map.set(ymd, [...(map.get(ymd) ?? []), it]);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ymd, list]) => ({ ymd, items: list }));
}

/** Клуб пункта расписания: у кофе-рана — всегда беговой. */
export function itemClub(item: ScheduleItem): string | null {
  return item.source === "coffeerun" ? COFFEE_RUN_CLUB : item.event.club;
}
