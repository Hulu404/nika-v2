import { COFFEE_RUNS, type CoffeeRun } from "../coffeerun/run";
import { tgAdmin } from "../telegram/supabase";
import { founderIds, isFounder } from "./config";
import type { InlineKeyboardMarkup } from "grammy/types";
import { coffeeRunKey, coffeeRunStart, coffeeRunTitle, eventKey, type TeamEvent, type TeamEventStore } from "./events";
import { openTeamForm, type TeamFormStore } from "./form";

/**
 * Фактическая явка (миграция 047): сколько человек пришло на ивент клуба.
 *
 * Вносит любой участник, если явки ещё нет; исправить уже внесённую могут
 * только фаундеры. Через 3 часа после начала ивента бот один раз спрашивает
 * ответственного, а если его нет — фаундеров.
 */

export interface Fact {
  attended: number;
  entered_by: number;
  entered_at: string;
}

export interface FactStore {
  getMany(keys: readonly string[]): Promise<Map<string, number>>;
  get(key: string): Promise<Fact | null>;
  /** overwrite = false: «exists», если явку уже внесли. */
  save(key: string, attended: number, by: number, now: Date, overwrite: boolean): Promise<"saved" | "exists">;
  /** Поставить отметку «спросили». true — поставил этот вызов, и только он спрашивает. */
  markAsked(key: string, now: Date): Promise<boolean>;
}

export function supabaseFactStore(): FactStore {
  const facts = () => tgAdmin().from("team_event_facts");
  return {
    async getMany(keys) {
      const map = new Map<string, number>();
      if (!keys.length) return map;
      const { data, error } = await facts().select("event_key, attended").in("event_key", [...keys]);
      if (error) throw new Error(`team_event_facts: ${error.message}`);
      for (const r of (data ?? []) as Array<{ event_key: string; attended: number }>) map.set(r.event_key, r.attended);
      return map;
    },
    async get(key) {
      const { data, error } = await facts().select("attended, entered_by, entered_at").eq("event_key", key).maybeSingle();
      if (error) throw new Error(`team_event_facts: ${error.message}`);
      return (data as Fact | null) ?? null;
    },
    async save(key, attended, by, now, overwrite) {
      const row = { event_key: key, attended, entered_by: by, entered_at: now.toISOString() };
      if (overwrite) {
        const { error } = await facts().upsert(row, { onConflict: "event_key" });
        if (error) throw new Error(`team_event_facts: ${error.message}`);
        return "saved";
      }
      const { error } = await facts().insert(row);
      if (!error) return "saved";
      if (error.code === "23505") return "exists";
      throw new Error(`team_event_facts: ${error.message}`);
    },
    async markAsked(key, now) {
      const { error } = await tgAdmin().from("team_event_asks").insert({ event_key: key, asked_at: now.toISOString() });
      if (!error) return true;
      if (error.code === "23505") return false;
      throw new Error(`team_event_asks: ${error.message}`);
    },
  };
}

/** Для тестов. */
export class MemoryFactStore implements FactStore {
  facts = new Map<string, Fact>();
  asked = new Set<string>();
  async getMany(keys: readonly string[]) {
    const map = new Map<string, number>();
    for (const k of keys) if (this.facts.has(k)) map.set(k, this.facts.get(k)!.attended);
    return map;
  }
  async get(key: string) {
    return this.facts.get(key) ?? null;
  }
  async save(key: string, attended: number, by: number, now: Date, overwrite: boolean) {
    if (this.facts.has(key) && !overwrite) return "exists" as const;
    this.facts.set(key, { attended, entered_by: by, entered_at: now.toISOString() });
    return "saved" as const;
  }
  async markAsked(key: string) {
    if (this.asked.has(key)) return false;
    this.asked.add(key);
    return true;
  }
}

/** Сколько ждать после начала ивента, прежде чем спросить про явку. */
export const ASK_AFTER_MS = 3 * 3_600_000;
/** Старше этого не спрашиваем: на первом деплое бот не должен опрашивать про прошлый месяц. */
export const ASK_WINDOW_MS = 3 * 24 * 3_600_000;

export interface AskTarget {
  key: string;
  title: string;
  /** Кому задать вопрос: ответственному или, если его нет, фаундерам. */
  to: number[];
}

/**
 * Каким ивентам клубов пора задать вопрос о явке: прошло 3 часа с начала
 * (и не больше трёх суток), явки ещё нет. Отметку «спросили» ставит
 * dispatchAttendanceAsks.
 */
export function attendanceAsksDue(
  events: readonly TeamEvent[],
  facts: ReadonlyMap<string, number>,
  now: Date,
  runs: readonly CoffeeRun[] = COFFEE_RUNS,
  founders: readonly number[] = [...founderIds()],
): AskTarget[] {
  const due = (startsAt: string) => {
    const age = now.getTime() - Date.parse(startsAt);
    return age >= ASK_AFTER_MS && age < ASK_WINDOW_MS;
  };
  const out: AskTarget[] = [];
  for (const ev of events) {
    if (ev.kind !== "club_event" || ev.cancelled_at || !due(ev.starts_at) || facts.has(eventKey(ev))) continue;
    out.push({ key: eventKey(ev), title: ev.title, to: ev.responsible_chat_id ? [ev.responsible_chat_id] : [...founders] });
  }
  for (const run of runs) {
    if (!due(coffeeRunStart(run)) || facts.has(coffeeRunKey(run))) continue;
    // У кофе-ранов ответственного в базе нет — спрашиваем фаундеров.
    out.push({ key: coffeeRunKey(run), title: `${coffeeRunTitle(run)}, ${run.date.slice(8, 10)}.${run.date.slice(5, 7)}`, to: [...founders] });
  }
  return out.filter((t) => t.to.length > 0);
}

/** Число пришедших из сообщения: «17», «пришло 17». */
export function parseAttended(text: string): number | null {
  const m = /^\D*?(\d{1,5})\D*$/.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 10_000 ? n : null;
}

export type SaveOutcome = { status: "saved"; attended: number } | { status: "exists"; attended: number } | { status: "bad" };

/** Внести явку: любой участник, если её ещё нет; исправить — только фаундер. */
export async function saveAttendance(store: FactStore, key: string, text: string, by: number, now: Date): Promise<SaveOutcome> {
  const attended = parseAttended(text);
  if (attended === null) return { status: "bad" };
  const founder = isFounder(by);
  const res = await store.save(key, attended, by, now, founder);
  if (res === "exists") {
    const current = await store.get(key);
    return { status: "exists", attended: current?.attended ?? attended };
  }
  return { status: "saved", attended };
}

export interface AskDeps {
  events: Pick<TeamEventStore, "listBetween">;
  facts: FactStore;
  forms: TeamFormStore;
  send: (chatId: number, text: string, keyboard?: InlineKeyboardMarkup) => Promise<{ ok: boolean }>;
}

/** Сколько ждём ответ на вопрос о явке «следующим сообщением». */
export const ASK_FORM_TTL_MS = 24 * 3_600_000;

/** Кнопка «Внести явку» по ключу ивента. */
export function attendCallback(key: string): string {
  const [kind, a, b] = key.split(":");
  return kind === "coffeerun" ? `ie:ar:${a}:${b}` : `ie:ae:${a}`;
}

/**
 * Через 3 часа после начала ивента клуба спросить ответственного (или
 * фаундеров), сколько пришло. Один раз: отметка в team_event_asks ставится до
 * отправки. Ответ ждём следующим сообщением (форма на сутки) или кнопкой.
 * Возвращает ключи ивентов, по которым спросили в этот проход.
 */
export async function dispatchAttendanceAsks(deps: AskDeps, now: Date): Promise<string[]> {
  const events = await deps.events.listBetween(new Date(now.getTime() - ASK_WINDOW_MS), new Date(now.getTime() - ASK_AFTER_MS + 1));
  const keys = [...events.map(eventKey), ...COFFEE_RUNS.map(coffeeRunKey)];
  const facts = await deps.facts.getMany(keys);
  const asked: string[] = [];
  for (const target of attendanceAsksDue(events, facts, now)) {
    if (!(await deps.facts.markAsked(target.key, now))) continue;
    const keyboard = { inline_keyboard: [[{ text: "Внести явку", callback_data: attendCallback(target.key) }]] };
    for (const chatId of target.to) {
      await deps.forms.set(chatId, openTeamForm("attend", { key: target.key, title: target.title }, now, ASK_FORM_TTL_MS), now)
        .catch(() => {});
      await deps.send(chatId, `Сколько человек пришло на «${escape(target.title)}»? Пришли число следующим сообщением.`, keyboard);
    }
    asked.push(target.key);
  }
  return asked;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
