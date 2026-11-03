import { COFFEE_RUNS, type CoffeeRun } from "../coffeerun/run";
import { mskMidnight, mskWeekday } from "../databot/dates";
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
  /** coffee_run — кофе-ран недели (миграция 051); null — обычное событие. */
  format?: "coffee_run" | null;
  /** Слаг спота кофе-рана (lib/team/spots.ts); null — другое место. */
  spot?: string | null;
  confirm_asked_at?: string | null;
  confirmed_at?: string | null;
  confirm_nag_at?: string | null;
  /** Проект «Пятницы» (миграция 058); нет — nika. */
  project_id?: string | null;
}

export type NewTeamEvent = Pick<TeamEvent, "kind" | "club" | "title" | "starts_at" | "place" | "responsible_chat_id" | "created_by">
  & Partial<Pick<TeamEvent, "format" | "spot" | "project_id">>;

export interface TeamEventStore {
  create(row: NewTeamEvent, now: Date): Promise<TeamEvent>;
  get(id: number): Promise<TeamEvent | null>;
  /** Все неотменённые события с началом в [from, to). */
  listBetween(from: Date, to: Date): Promise<TeamEvent[]>;
  /** Прошедшие неотменённые ивенты клубов, от новых к старым. */
  listPastClubEvents(before: Date, limit: number): Promise<TeamEvent[]>;
  setTime(id: number, startsAt: string, now: Date): Promise<TeamEvent | null>;
  setResponsible(id: number, chatId: number, now: Date): Promise<TeamEvent | null>;
  /** Назначить ответственного, даже если он уже есть (фаундер выбирает после решения «Да»). */
  assignResponsible(id: number, chatId: number, now: Date): Promise<TeamEvent | null>;
  cancel(id: number, now: Date): Promise<TeamEvent | null>;
  /** Новое название или место (ассистент «Пятницы»). null — события нет или оно отменено. */
  update(id: number, patch: { title?: string; place?: string | null }, now: Date): Promise<TeamEvent | null>;
  /** Поставить отметку подтверждения кофе-рана (confirm_asked_at, confirmed_at, confirm_nag_at). Только если её ещё нет. */
  mark(id: number, field: "confirm_asked_at" | "confirmed_at" | "confirm_nag_at", now: Date): Promise<boolean>;
  /** Последний неотменённый кофе-ран недели, начавшийся до before. */
  lastCoffeeRun(before: Date): Promise<TeamEvent | null>;
}

// Читаем все колонки, без перечисления: колонки из 051 появятся в базе только
// после миграции, и явный список уронил бы расписание до её применения.
const COLUMNS = "*";

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
    async assignResponsible(id, chatId, now) {
      const { data, error } = await t().update({ responsible_chat_id: chatId, updated_at: now.toISOString() })
        .eq("id", id).is("cancelled_at", null).select(COLUMNS).maybeSingle();
      if (error) throw new Error(`team_events: ${error.message}`);
      return one(data);
    },
    async cancel(id, now) {
      const { data, error } = await t().update({ cancelled_at: now.toISOString(), updated_at: now.toISOString() })
        .eq("id", id).is("cancelled_at", null).select(COLUMNS).maybeSingle();
      if (error) throw new Error(`team_events: ${error.message}`);
      return one(data);
    },
    async update(id, patch, now) {
      const { data, error } = await t().update({ ...patch, updated_at: now.toISOString() })
        .eq("id", id).is("cancelled_at", null).select(COLUMNS).maybeSingle();
      if (error) throw new Error(`team_events: ${error.message}`);
      return one(data);
    },
    async mark(id, field, now) {
      const { data, error } = await t().update({ [field]: now.toISOString() }).eq("id", id).is(field, null).select("id");
      if (error) throw new Error(`team_events: ${error.message}`);
      return (data ?? []).length === 1;
    },
    async lastCoffeeRun(before) {
      const { data, error } = await t().select(COLUMNS).eq("format", "coffee_run").is("cancelled_at", null)
        .lt("starts_at", before.toISOString()).order("starts_at", { ascending: false }).limit(1).maybeSingle();
      // До миграции 051 колонки format нет: считаем, что кофе-ранов в team_events ещё не было.
      if (error) return null;
      return one(data);
    },
  };
}

/** Для тестов. */
export class MemoryEventStore implements TeamEventStore {
  events = new Map<number, TeamEvent>();
  private next = 1;
  async create(row: NewTeamEvent, now: Date) {
    const ev: TeamEvent = { format: null, spot: null, ...row, id: this.next++, notes: null, created_at: now.toISOString(), updated_at: now.toISOString(), cancelled_at: null };
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
  async assignResponsible(id: number, chatId: number, now: Date) {
    const ev = this.events.get(id);
    if (!ev || ev.cancelled_at) return null;
    Object.assign(ev, { responsible_chat_id: chatId, updated_at: now.toISOString() });
    return { ...ev };
  }
  async mark(id: number, field: "confirm_asked_at" | "confirmed_at" | "confirm_nag_at", now: Date) {
    const ev = this.events.get(id);
    if (!ev || ev[field]) return false;
    ev[field] = now.toISOString();
    return true;
  }
  async lastCoffeeRun(before: Date) {
    const list = [...this.events.values()]
      .filter((e) => e.format === "coffee_run" && !e.cancelled_at && Date.parse(e.starts_at) < before.getTime())
      .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
    return list[0] ? { ...list[0] } : null;
  }
  async cancel(id: number, now: Date) {
    const ev = this.events.get(id);
    if (!ev || ev.cancelled_at) return null;
    Object.assign(ev, { cancelled_at: now.toISOString(), updated_at: now.toISOString() });
    return { ...ev };
  }
  async update(id: number, patch: { title?: string; place?: string | null }, now: Date) {
    const ev = this.events.get(id);
    if (!ev || ev.cancelled_at) return null;
    Object.assign(ev, patch, { updated_at: now.toISOString() });
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

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const WEEKDAY_WORDS: ReadonlyArray<[RegExp, number]> = [
  [/^(пн|понедельник[а-я]*)$/, 1], [/^(вт|вторник[а-я]*)$/, 2], [/^(ср|сред[ауы])$/, 3], [/^(чт|четверг[а-я]*)$/, 4],
  [/^(пт|пятниц[аеуы])$/, 5], [/^(сб|суббот[аеуы])$/, 6], [/^(вс|воскресень[ея])$/, 7],
];
const RELATIVE_DAYS: Record<string, number> = { сегодня: 0, завтра: 1, послезавтра: 2 };
/** «8 ноября» в декабре — это ноябрь следующего года, а не прошлое. */
const YEAR_ROLL_DAYS = 60;
const WORD = "[а-яё]+";
/** Вводные слова команды в начале фразы: «поставь занятие…» → «занятие…». */
const LEAD = /^(?:пожалуйста\s+)?(?:поставь|поставить|добавь|добавить|создай|создать|запланируй|запланировать|заведи|внеси|сделай|нужно|надо|будет)(?:\s+(?:пожалуйста|в\s+расписание|событие|ивент))*\s+/i;
/** Висящие предлоги после того, как из фразы вырезали дату и время. */
const DANGLING = /(?:^|\s)(?:на|в|во|к|с|со|от|и)(?=\s*(?:,|$))/gi;

interface When { at: Date; rest: string }

const pad = (n: number) => String(n).padStart(2, "0");
const validYmd = (v: string) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

function ymdOf(day: number, month: number, year: number | null, now: Date, token: string): string {
  const today = mskToday(now);
  let y = year === null ? Number(today.slice(0, 4)) : year < 100 ? 2000 + year : year;
  let ymd = `${y}-${pad(month)}-${pad(day)}`;
  if (!validYmd(ymd)) throw new EventParseError(`Нет такой даты: ${token}.`);
  if (year === null && Date.parse(`${ymd}T00:00:00Z`) < Date.parse(`${today}T00:00:00Z`) - YEAR_ROLL_DAYS * 86_400_000) {
    y += 1;
    ymd = `${y}-${pad(month)}-${pad(day)}`;
  }
  return ymd;
}

/**
 * Дата и время события в свободной фразе: «в вс 8 ноября в 12:00»,
 * «8.11 12:00», «завтра в 19.30», «пт 18:00», «в 12». Вырезает их из текста и
 * возвращает остаток (из него получится название). null — времени нет.
 */
export function findEventWhen(text: string, now: Date): When | null {
  let rest = ` ${text} `;
  const cut = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(rest);
    if (m) rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`;
    return m;
  };
  // Дата словами: «8 ноября», «8 ноября 2026».
  const named = cut(new RegExp(`(?<=[\\s,(])(?:(?:на|в|во|к)\\s+)?(\\d{1,2})\\s+(${MONTHS.join("|")})(?:\\s+(\\d{4}))?(?=[\\s,.)])`, "i"));
  // Время с двоеточием: «12:00», «в 12:00».
  let time = cut(/(?<=[\s,(])(?:(?:в|к|на)\s+)?(\d{1,2}):(\d{2})(?=[\s,.)])/i);
  // Дата цифрами: «8.11», «08.11.2026». Если времени ещё нет, «12.00» с минутами — это время.
  let dotted: RegExpExecArray | null = null;
  if (!named) dotted = cut(/(?<=[\s,(])(?:(?:на|в|во|к)\s+)?(\d{1,2})\.(\d{1,2})(?:\.(\d{2}|\d{4}))?(?=[\s,)]|\.\s)/i);
  if (dotted && !time && !dotted[3] && Number(dotted[2]) > 12) {
    // «19.30» без даты — это время.
    time = dotted;
    dotted = null;
  }
  if (!time) time = cut(/(?<=[\s,(])(?:(?:в|к|на)\s+)?(\d{1,2})\.(\d{2})(?=[\s,)])/i);
  // «в 12», «в 12 часов».
  if (!time) {
    const m = cut(/(?<=[\s,(])(?:в|к)\s+(\d{1,2})(?:\s*(?:час(?:а|ов)?|ч))?(?=[\s,.)])/i);
    if (m) time = Object.assign([m[0], m[1], "00"], { index: m.index, input: m.input }) as unknown as RegExpExecArray;
  }
  // День недели и «завтра»: «в воскресенье», «вс».
  let weekday: number | null = null;
  let relative: number | null = null;
  rest = rest.replace(new RegExp(`(?<=[\\s,(])(?:(?:в|во|на)\\s+)?(${WORD})(?=[\\s,.)])`, "gi"), (all, word: string) => {
    const w = word.toLowerCase();
    if (w in RELATIVE_DAYS && relative === null) {
      relative = RELATIVE_DAYS[w];
      return " ";
    }
    const wd = WEEKDAY_WORDS.find(([re]) => re.test(w));
    if (wd && weekday === null) {
      weekday = wd[1];
      return " ";
    }
    return all;
  });
  if (!time) return null;
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  if (hour > 23 || minute > 59) throw new EventParseError("Время — от 00:00 до 23:59.");

  const today = mskToday(now);
  let ymd: string;
  if (named) ymd = ymdOf(Number(named[1]), MONTHS.indexOf(named[2].toLowerCase()) + 1, named[3] ? Number(named[3]) : null, now, named[0].trim());
  else if (dotted) ymd = ymdOf(Number(dotted[1]), Number(dotted[2]), dotted[3] ? Number(dotted[3]) : null, now, dotted[0].trim());
  else if (relative !== null) ymd = addDays(today, relative);
  else if (weekday !== null) {
    ymd = addDays(today, (weekday - mskWeekday(today) + 7) % 7);
    // «в пятницу 18:00», сказанное в пятницу вечером, — следующая пятница.
    if (new Date(mskMidnight(ymd).getTime() + (hour * 60 + minute) * 60_000) <= now) ymd = addDays(ymd, 7);
  } else ymd = today;
  const at = new Date(mskMidnight(ymd).getTime() + (hour * 60 + minute) * 60_000);
  if (at <= now) throw new EventParseError("Это время уже прошло.");
  return { at, rest: rest.replace(/\s+/g, " ").trim() };
}

/** Остаток фразы → название: без «поставь», висящих предлогов и лишних знаков. */
function cleanTitle(text: string): string {
  let t = text.replace(/\s+([,.!?)])/g, "$1").replace(/\s+/g, " ").trim();
  t = t.replace(LEAD, "");
  for (let i = 0; i < 3; i++) t = t.replace(DANGLING, "").replace(/\s+/g, " ").trim();
  t = t.replace(/^[\s,.;:—–-]+|[\s,.;:—–-]+$/g, "");
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

const NO_TIME = "Не вижу времени. Напиши, например: «Пилатес в вс 8 ноября 12:00, Студия Поток» или «Планёрка / пт 19:00 / Zoom».";

/**
 * Событие из одной строки — как удобно человеку:
 * - фразой: «поставь занятие по пилатесу на воскресенье 8 ноября в 12:00, Студия Поток @masha»;
 * - полями: «Название / дата время / место / @ответственный» (лишние поля
 *   уходят в место через запятую, порядок полей после названия любой).
 * Время обязательно, место и ответственный — нет.
 */
export function parseEventLine(text: string, now: Date): EventDraft {
  const body = text.replace(/^\/event(?:@\w+)?\s*/i, "").trim();
  if (!body) throw new EventParseError(`Пришли событие одной строкой. ${NO_TIME}`);
  const nicks = [...body.matchAll(/(?:^|[\s/,])@([a-z0-9_]{1,32})\b/gi)].map((m) => m[1].toLowerCase());
  if (new Set(nicks).size > 1) throw new EventParseError("Ответственный один: @ник.");
  const responsible = nicks[0] ?? null;
  const plain = body.replace(/@[a-z0-9_]{1,32}\b/gi, " ");

  const fields = plain.split(/\s*\/\s*/).map((f) => f.trim()).filter(Boolean);
  let title: string;
  let when: When | null = null;
  let place: string | null = null;
  if (fields.length > 1) {
    // Поля: название — первое; время — в первом поле, где оно есть; остальное — место.
    title = fields[0];
    const others: string[] = [];
    for (const f of fields.slice(1)) {
      const found: When | null = when ? null : findEventWhen(f, now);
      if (found) {
        when = found;
        if (found.rest) others.push(found.rest);
      } else others.push(f);
    }
    if (!when) {
      when = findEventWhen(title, now);
      if (when) title = when.rest;
    }
    place = others.join(", ") || null;
  } else {
    when = findEventWhen(plain, now);
    if (!when) throw new EventParseError(NO_TIME);
    // «Пилатес 8 ноября 12:00, Студия Поток»: после запятой — место.
    const [head, ...tail] = when.rest.split(/\s*,\s*/);
    title = head;
    place = tail.filter((t) => cleanTitle(t)).map(cleanTitle).join(", ") || null;
  }
  if (!when) throw new EventParseError(NO_TIME);
  title = cleanTitle(title);
  if (!title) throw new EventParseError("Не вижу названия. Например: «Пилатес в вс 8 ноября 12:00».");
  if (title.length > 200) throw new EventParseError("Название события — до 200 символов.");
  return { title, startsAt: when.at.toISOString(), place: place ? place.slice(0, 200) : null, responsible };
}

/** Время события из одного поля: «пт 19:00». Для «Изменить время». */
export function parseEventTime(text: string, now: Date): string {
  const found = findEventWhen(text.trim(), now);
  if (!found) throw new EventParseError("Не вижу времени. Например: «пт 19:00», «завтра в 12:00», «8 ноября 12:00».");
  return found.at.toISOString();
}

// ── Права ────────────────────────────────────────────────────────────────────

/** Менять время и отменять: автор, ответственный и фаундеры. */
/** Менять и отменять событие: автор, ответственный или админ проекта (по умолчанию — фаундер). */
export function canManageEvent(ev: Pick<TeamEvent, "created_by" | "responsible_chat_id">, actorId: number, isAdmin: (id: number) => boolean = isFounder): boolean {
  return ev.created_by === actorId || ev.responsible_chat_id === actorId || isAdmin(actorId);
}

const eventProject = (e: Pick<TeamEvent, "project_id">) => e.project_id ?? "nika";

/**
 * События одного проекта: списки фильтруются по project_id, новые события
 * получают проект. nika не пишет project_id явно — это значение по умолчанию
 * (и до миграции 058 колонки нет).
 */
export function scopedEvents(store: TeamEventStore, projectId: string): TeamEventStore {
  const mine = (list: TeamEvent[]) => list.filter((e) => eventProject(e) === projectId);
  return {
    ...store,
    create: (row, now) => store.create(projectId === "nika" ? row : { ...row, project_id: projectId }, now),
    listBetween: async (from, to) => mine(await store.listBetween(from, to)),
    listPastClubEvents: async (before, limit) => mine(await store.listPastClubEvents(before, limit)),
    lastCoffeeRun: async (before) => {
      const ev = await store.lastCoffeeRun(before);
      return ev && eventProject(ev) === projectId ? ev : null;
    },
  };
}

// ── Расписание ───────────────────────────────────────────────────────────────

export type ScheduleItem =
  | { source: "event"; startsAt: string; event: TeamEvent }
  | { source: "coffeerun"; startsAt: string; run: CoffeeRun };

/** Кофе-ран коротко, как везде в «Пятнице»: «Кофе-ран · Усачёва». */
export function coffeeRunTitle(run: Pick<CoffeeRun, "spotName">): string {
  const name = run.spotName.includes(",") ? run.spotName.split(",").at(-1)!.trim() : run.spotName.replace(/^Surf Coffee®?\s*/i, "").trim();
  return `Кофе-ран · ${name || run.spotName}`;
}

/** Кофе-ран недели — событие team_events с format = coffee_run. */
export const isCoffeeRunEvent = (ev: Pick<TeamEvent, "format">) => ev.format === "coffee_run";

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

/**
 * События недели по времени. Кофе-раны из COFFEE_RUNS сюда больше не
 * подмешиваются: в «Пятнице» кофе-ран — это событие team_events
 * (format = coffee_run), иначе рядом с ним вставал второй такой же.
 */
export function scheduleItems(events: readonly TeamEvent[], days: readonly string[]): ScheduleItem[] {
  const set = new Set(days);
  return events
    .filter((e) => !e.cancelled_at && set.has(mskToday(new Date(e.starts_at))))
    .map((event) => ({ source: "event" as const, startsAt: event.starts_at, event }))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
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
