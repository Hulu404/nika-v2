import { Api, type Context } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import { COFFEE_RUNS } from "../coffeerun/run";
import { mskMidnight, mskWeekday } from "../databot/dates";
import type { DatabotStore } from "../databot/data/store";
import { createSupabaseStore } from "../databot/data/supabase-store";
import { normalizeTaskUsername } from "../databot/tasks";
import type { AssignedTask, AssignedTaskDraft } from "../databot/task-list";
import { addDays, mskHour, mskToday } from "../databot/time";
import { tgAdmin } from "../telegram/supabase";
import { listProjectTeam, type TeamMember } from "./access";
import { NIKA } from "./projects/projects";
import { COFFEE_OWNER_TASKS, coffeeOwner, coffeeOwnerTaskText } from "./coffee-run-template";
import { supabaseSettingsStore } from "./settings";
import { founderIds, isFounder, teamBotConfigured, teamToken } from "./config";
import { dayHeader, escapeHtmlTeam, eventWhen, shortDay, taskCb } from "./copy";
import { departmentName } from "./departments";
import { isCoffeeRunEvent, supabaseEventStore, type TeamEvent, type TeamEventStore } from "./events";
import { openTeamForm, supabaseTeamForms, teamFormExpired, type TeamFormStore } from "./form";
import { SPOTS, coffeeRunName, spotBySlug } from "./spots";
import { deliverAssigned, syncTeamTaskMembers } from "./tasks";
import { quietApi } from "./outbox";

/**
 * Кофе-ран недели.
 *
 * Каждый понедельник в 12:00 МСК, пока кофе-раны проводятся (team_settings
 * coffee_run_weekly ≠ off), «Пятница» спрашивает фаундеров: «Проводим
 * кофе-ран на этой неделе?». Кто первый ответил, того решение и действует:
 * фиксация одним UPDATE … WHERE decision IS NULL. «Да» создаёт событие, шлёт
 * команде анонс, просит ответственного, ставит задачи отделам и запускает
 * опрос «кто будет». За 24 часа ответственный подтверждает или отменяет.
 */

export const WEEKLY_ASK_HOUR = 12;
export const WEEKLY_REMINDER_HOUR = 16;
export const LATE_DUE_SHIFT_MS = 3 * 3_600_000;
export const CONFIRM_BEFORE_MS = 24 * 3_600_000;
export const CONFIRM_NAG_BEFORE_MS = 12 * 3_600_000;
/** source_message_id задач кофе-рана: число, которого не бывает у сообщений в личке. */
const TASK_SOURCE_BASE = 2_000_000_000;
export const WEEKLY_SETTING = "coffee_run_weekly";
const TIMES = ["08:00", "09:00", "10:00", "11:00"];

// ── Хранилища ────────────────────────────────────────────────────────────────

export interface WeekRow {
  week_start: string;
  decision: "yes" | "no" | null;
  decided_by: number | null;
  decided_at: string | null;
  event_id: number | null;
  responsible_asked_at: string | null;
  reminder_sent_at: string | null;
  messages: Array<{ chat: number; message_id: number }>;
  task_ids: number[];
}

export interface WeekStore {
  /** Завести неделю. true — завёл этот вызов (и только он шлёт вопрос). */
  open(weekStart: string, now: Date): Promise<boolean>;
  get(weekStart: string): Promise<WeekRow | null>;
  byEvent(eventId: number): Promise<WeekRow | null>;
  addMessage(weekStart: string, chat: number, messageId: number): Promise<void>;
  /** Атомарно: решение ставится, только если его ещё нет. */
  decide(weekStart: string, decision: "yes" | "no", by: number, now: Date): Promise<boolean>;
  setEvent(weekStart: string, eventId: number): Promise<void>;
  setTasks(weekStart: string, taskIds: number[]): Promise<void>;
  markReminder(weekStart: string, now: Date): Promise<boolean>;
}

export interface RsvpStore {
  set(eventId: number, chatId: number, answer: "yes" | "no", now: Date): Promise<void>;
  list(eventId: number): Promise<Array<{ chat_id: number; answer: "yes" | "no" }>>;
}

export function supabaseWeekStore(): WeekStore {
  const t = () => tgAdmin().from("coffee_run_weeks");
  const one = (data: unknown) => (data as WeekRow | null) ?? null;
  return {
    async open(weekStart, now) {
      const { error } = await t().insert({ week_start: weekStart, asked_at: now.toISOString() });
      if (!error) return true;
      if (error.code === "23505") return false;
      throw new Error(`coffee_run_weeks: ${error.message}`);
    },
    async get(weekStart) {
      const { data, error } = await t().select("*").eq("week_start", weekStart).maybeSingle();
      if (error) throw new Error(`coffee_run_weeks: ${error.message}`);
      return one(data);
    },
    async byEvent(eventId) {
      const { data, error } = await t().select("*").eq("event_id", eventId).maybeSingle();
      if (error) throw new Error(`coffee_run_weeks: ${error.message}`);
      return one(data);
    },
    async addMessage(weekStart, chat, messageId) {
      const row = await this.get(weekStart);
      if (!row) return;
      const { error } = await t().update({ messages: [...(row.messages ?? []), { chat, message_id: messageId }] }).eq("week_start", weekStart);
      if (error) throw new Error(`coffee_run_weeks: ${error.message}`);
    },
    async decide(weekStart, decision, by, now) {
      const { data, error } = await t().update({ decision, decided_by: by, decided_at: now.toISOString() })
        .eq("week_start", weekStart).is("decision", null).select("week_start");
      if (error) throw new Error(`coffee_run_weeks: ${error.message}`);
      return (data ?? []).length === 1;
    },
    async setEvent(weekStart, eventId) {
      const { error } = await t().update({ event_id: eventId }).eq("week_start", weekStart);
      if (error) throw new Error(`coffee_run_weeks: ${error.message}`);
    },
    async setTasks(weekStart, taskIds) {
      const { error } = await t().update({ task_ids: taskIds }).eq("week_start", weekStart);
      if (error) throw new Error(`coffee_run_weeks: ${error.message}`);
    },
    async markReminder(weekStart, now) {
      const { data, error } = await t().update({ reminder_sent_at: now.toISOString() })
        .eq("week_start", weekStart).is("reminder_sent_at", null).is("decision", null).select("week_start");
      if (error) throw new Error(`coffee_run_weeks: ${error.message}`);
      return (data ?? []).length === 1;
    },
  };
}

export function supabaseRsvpStore(): RsvpStore {
  const t = () => tgAdmin().from("team_event_rsvp");
  return {
    async set(eventId, chatId, answer, now) {
      const { error } = await t().upsert({ event_id: eventId, chat_id: chatId, answer, answered_at: now.toISOString() }, { onConflict: "event_id,chat_id" });
      if (error) throw new Error(`team_event_rsvp: ${error.message}`);
    },
    async list(eventId) {
      const { data, error } = await t().select("chat_id, answer").eq("event_id", eventId);
      if (error) throw new Error(`team_event_rsvp: ${error.message}`);
      return (data ?? []) as Array<{ chat_id: number; answer: "yes" | "no" }>;
    },
  };
}

/** Для тестов. */
export class MemoryWeekStore implements WeekStore {
  rows = new Map<string, WeekRow>();
  async open(weekStart: string) {
    if (this.rows.has(weekStart)) return false;
    this.rows.set(weekStart, { week_start: weekStart, decision: null, decided_by: null, decided_at: null, event_id: null,
      responsible_asked_at: null, reminder_sent_at: null, messages: [], task_ids: [] });
    return true;
  }
  async get(weekStart: string) {
    const r = this.rows.get(weekStart);
    return r ? structuredClone(r) : null;
  }
  async byEvent(eventId: number) {
    const r = [...this.rows.values()].find((x) => x.event_id === eventId);
    return r ? structuredClone(r) : null;
  }
  async addMessage(weekStart: string, chat: number, messageId: number) {
    this.rows.get(weekStart)?.messages.push({ chat, message_id: messageId });
  }
  async decide(weekStart: string, decision: "yes" | "no", by: number, now: Date) {
    const r = this.rows.get(weekStart);
    if (!r || r.decision) return false;
    Object.assign(r, { decision, decided_by: by, decided_at: now.toISOString() });
    return true;
  }
  async setEvent(weekStart: string, eventId: number) {
    const r = this.rows.get(weekStart);
    if (r) r.event_id = eventId;
  }
  async setTasks(weekStart: string, taskIds: number[]) {
    const r = this.rows.get(weekStart);
    if (r) r.task_ids = taskIds;
  }
  async markReminder(weekStart: string, now: Date) {
    const r = this.rows.get(weekStart);
    if (!r || r.reminder_sent_at || r.decision) return false;
    r.reminder_sent_at = now.toISOString();
    return true;
  }
}

export class MemoryRsvpStore implements RsvpStore {
  answers = new Map<string, "yes" | "no">();
  async set(eventId: number, chatId: number, answer: "yes" | "no") {
    this.answers.set(`${eventId}:${chatId}`, answer);
  }
  async list(eventId: number) {
    return [...this.answers.entries()]
      .filter(([k]) => k.startsWith(`${eventId}:`))
      .map(([k, answer]) => ({ chat_id: Number(k.split(":")[1]), answer }));
  }
}

// ── Даты ─────────────────────────────────────────────────────────────────────

/** Понедельник московской недели. */
export function weekStartOf(now: Date): string {
  const today = mskToday(now);
  return addDays(today, -(mskWeekday(today) - 1));
}

/** Момент «день + время» по Москве. */
export function mskMoment(ymd: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(mskMidnight(ymd).getTime() + (h * 60 + m) * 60_000);
}

const hhmmOf = (iso: string) => {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
};

/**
 * Срок задачи кофе-рана по шаблону. Если он уже прошёл в момент создания
 * (решили во вторник вечером), срок — через 3 часа, и задача помечается late.
 */
export function coffeeTaskDue(
  template: { due: (w: { weekStart: string; runDate: string }) => { ymd: string; time: string } },
  weekStart: string,
  runDate: string,
  now: Date,
): { due: Date; late: boolean } {
  const { ymd, time } = template.due({ weekStart, runDate });
  const due = mskMoment(ymd, time);
  return due.getTime() > now.getTime() ? { due, late: false } : { due: new Date(now.getTime() + LATE_DUE_SHIFT_MS), late: true };
}

// ── Зависимости ──────────────────────────────────────────────────────────────

export interface WeekApi {
  sendMessage: (chatId: number, text: string, other?: { parse_mode?: "HTML"; reply_markup?: InlineKeyboardMarkup }) => Promise<{ message_id: number }>;
  editMessageText: (chatId: number, messageId: number, text: string, other?: { reply_markup?: InlineKeyboardMarkup }) => Promise<unknown>;
}

export interface CoffeeWeekDeps {
  weeks: WeekStore;
  events: TeamEventStore;
  rsvp: RsvpStore;
  tasks: DatabotStore;
  forms: TeamFormStore;
  listTeam: () => Promise<TeamMember[]>;
  /** Проводим ли кофе-раны вообще (team_settings coffee_run_weekly ≠ off). */
  enabled: () => Promise<boolean>;
  founders?: () => number[];
  /** Настройка team_settings: chat_id ответственного отдела за кофе-ран (coffee_run_smm_owner, coffee_run_events_owner). */
  ownerSetting?: (key: string) => Promise<string | null>;
}

const foundersOf = (deps: CoffeeWeekDeps) => (deps.founders ? deps.founders() : [...founderIds()]);
const nameOf = (m: TeamMember | undefined, fallback = "участник команды") =>
  m?.username ? `@${m.username}` : (m?.display_name ?? fallback);

async function sendAll(api: WeekApi, chats: readonly number[], text: string, keyboard?: InlineKeyboardMarkup): Promise<void> {
  for (const chat of chats) await api.sendMessage(chat, text, keyboard ? { reply_markup: keyboard } : undefined).catch(() => {});
}

// ── Понедельник: вопрос и напоминание ────────────────────────────────────────

interface LastRun {
  weekday: number;
  hhmm: string;
  spot: string;
  name: string;
}

/** «Как в прошлый раз»: день недели, время и спот последнего кофе-рана. */
export async function lastRun(deps: Pick<CoffeeWeekDeps, "events">, now: Date): Promise<LastRun | null> {
  const ev = await deps.events.lastCoffeeRun(now);
  const spot = spotBySlug(ev?.spot);
  if (ev && spot) {
    return { weekday: mskWeekday(mskToday(new Date(ev.starts_at))), hhmm: hhmmOf(ev.starts_at), spot: spot.slug, name: spot.name };
  }
  // До первого кофе-рана в «Пятнице» — последний из расписания сайта (COFFEE_RUNS).
  const past = [...COFFEE_RUNS].sort((a, b) => b.date.localeCompare(a.date)).find((r) => spotBySlug(r.spot));
  if (!past) return null;
  const [h, m] = past.startTime.split(":");
  return { weekday: mskWeekday(past.date), hhmm: `${h.padStart(2, "0")}:${m}`, spot: past.spot, name: spotBySlug(past.spot)!.name };
}

const WD = ["", "пн", "вт", "ср", "чт", "пт", "сб", "вс"];

function questionKeyboard(week: string, last: LastRun | null): InlineKeyboardMarkup {
  const rows: InlineKeyboardMarkup["inline_keyboard"] = [];
  if (last) rows.push([{ text: `Как в прошлый раз: ${WD[last.weekday]} ${last.hhmm}, ${last.name}`, callback_data: `cw:same:${week}` }]);
  rows.push([{ text: "Да, выбрать день и место", callback_data: `cw:pick:${week}` }]);
  rows.push([{ text: "Нет, пропускаем", callback_data: `cw:no:${week}` }]);
  return { inline_keyboard: rows };
}

export const WEEK_QUESTION = "Проводим кофе-ран на этой неделе?";

/**
 * 15-минутный тикер: в понедельник с 12:00 — вопрос фаундерам (один раз за
 * неделю, дедуп — первичный ключ coffee_run_weeks), с 16:00 — одно
 * напоминание, если никто не ответил; за сутки и за 12 часов до кофе-рана —
 * подтверждение. Возвращает, что сделано в этот проход.
 */
export async function dispatchCoffeeRunWeek(deps: CoffeeWeekDeps, api: WeekApi, now: Date): Promise<string[]> {
  const done: string[] = [];
  const week = weekStartOf(now);
  const monday = mskToday(now) === week;
  const founders = foundersOf(deps);

  if (monday && mskHour(now) >= WEEKLY_ASK_HOUR && (await deps.enabled()) && (await deps.weeks.open(week, now))) {
    const keyboard = questionKeyboard(week, await lastRun(deps, now));
    for (const chat of founders) {
      try {
        const msg = await api.sendMessage(chat, WEEK_QUESTION, { reply_markup: keyboard });
        await deps.weeks.addMessage(week, chat, msg.message_id);
      } catch {
        /* фаундер закрыл бота — остальные всё равно получат вопрос */
      }
    }
    done.push(`ask ${week}`);
  }

  if (monday && mskHour(now) >= WEEKLY_REMINDER_HOUR && (await deps.weeks.markReminder(week, now))) {
    await sendAll(api, founders, "Кофе-ран на этой неделе ещё не решён, СММ ждёт анонс до вторника 12:00.");
    done.push(`remind ${week}`);
  }

  done.push(...(await dispatchConfirmations(deps, api, now)));
  return done;
}

// ── Решение ──────────────────────────────────────────────────────────────────

export interface YesChoice {
  ymd: string;
  hhmm: string;
  spot: string | null;
  place: string | null;
}

/** «✅ Решено @ali: кофе-ран вс 18.10, 10:00, Усачёва». */
function decidedText(by: string, ev: TeamEvent | null, decision: "yes" | "no"): string {
  if (decision === "no") return `Решено ${by}: на этой неделе кофе-рана нет.`;
  if (!ev) return `✅ Решено ${by}: кофе-ран проводим.`;
  const where = spotBySlug(ev.spot)?.name ?? ev.place ?? "";
  return `✅ Решено ${by}: кофе-ран ${shortDay(ev.starts_at)}, ${hhmmOf(ev.starts_at)}${where ? `, ${where}` : ""}`;
}

async function alreadyDecided(deps: CoffeeWeekDeps, week: string): Promise<string> {
  const row = await deps.weeks.get(week);
  const team = await deps.listTeam();
  const by = nameOf(team.find((m) => m.chat_id === row?.decided_by));
  if (row?.decision === "no") return `Уже решено: ${by}, на этой неделе пропускаем.`;
  const ev = row?.event_id ? await deps.events.get(row.event_id) : null;
  return ev ? `Уже решено: ${by}, проводим ${shortDay(ev.starts_at)} ${hhmmOf(ev.starts_at)}.` : `Уже решено: ${by}.`;
}

async function editAll(api: WeekApi, row: WeekRow | null, text: string): Promise<void> {
  for (const m of row?.messages ?? []) await api.editMessageText(m.chat, m.message_id, text).catch(() => {});
}

/** «Нет»: одно сообщение команде, ни события, ни задач. */
export async function decideNo(deps: CoffeeWeekDeps, api: WeekApi, week: string, by: number, now: Date): Promise<string | null> {
  if (!(await deps.weeks.decide(week, "no", by, now))) return alreadyDecided(deps, week);
  const team = await deps.listTeam();
  await editAll(api, await deps.weeks.get(week), decidedText(nameOf(team.find((m) => m.chat_id === by)), null, "no"));
  await sendAll(api, team.map((m) => m.chat_id), "На этой неделе кофе-рана не будет.");
  return null;
}

export function coffeeCardText(ev: TeamEvent, rsvp: string | null): string {
  return [
    `🏃 <b>${escapeHtmlTeam(ev.title)}</b>, ${eventWhen(ev.starts_at)}`,
    ev.place ? `Место: ${escapeHtmlTeam(ev.place)}` : null,
    rsvp ? escapeHtmlTeam(rsvp) : null,
    "Подробности в 🏃 Ивенты.",
  ].filter((l): l is string => l !== null).join("\n");
}

/** «Из команды будут: @vika, @salma · не смогут: @danya · не ответили: 2». */
export async function rsvpLine(deps: Pick<CoffeeWeekDeps, "rsvp" | "listTeam">, ev: TeamEvent): Promise<string> {
  const [answers, team] = await Promise.all([deps.rsvp.list(ev.id), deps.listTeam()]);
  const by = new Map(answers.map((a) => [a.chat_id, a.answer] as const));
  const yes = team.filter((m) => by.get(m.chat_id) === "yes").map((m) => nameOf(m));
  const no = team.filter((m) => by.get(m.chat_id) === "no").map((m) => nameOf(m));
  const silent = team.filter((m) => !by.has(m.chat_id)).length;
  return `Из команды будут: ${yes.join(", ") || "—"} · не смогут: ${no.join(", ") || "—"} · не ответили: ${silent}`;
}

/**
 * «Да». По порядку: событие → анонс команде → «Кто ответственный?» →
 * задачи отделам → опрос «кто будет». null — решение принято этим вызовом;
 * строка — уже решено раньше (её и показать нажавшему).
 */
export async function decideYes(
  deps: CoffeeWeekDeps,
  api: WeekApi,
  week: string,
  by: number,
  choice: YesChoice,
  now: Date,
): Promise<string | null> {
  if (mskMoment(choice.ymd, choice.hhmm).getTime() <= now.getTime()) return "Это время уже прошло — выбери другое.";
  if (!(await deps.weeks.decide(week, "yes", by, now))) return alreadyDecided(deps, week);
  const spot = spotBySlug(choice.spot);
  const ev = await deps.events.create({
    kind: "club_event",
    club: "run",
    format: "coffee_run",
    spot: spot?.slug ?? null,
    title: coffeeRunName(spot?.name ?? choice.place ?? "другое место"),
    starts_at: mskMoment(choice.ymd, choice.hhmm).toISOString(),
    place: spot?.address ?? choice.place,
    responsible_chat_id: null,
    created_by: by,
  }, now);
  await deps.weeks.setEvent(week, ev.id);
  const team = await deps.listTeam();
  const everyone = team.map((m) => m.chat_id);

  // 1–2. Итог у всех фаундеров и анонс команде.
  await editAll(api, await deps.weeks.get(week), decidedText(nameOf(team.find((m) => m.chat_id === by)), ev, "yes"));
  await sendAll(api, everyone, `🏃 ${ev.title}, ${shortDay(ev.starts_at)}, ${hhmmOf(ev.starts_at)}. Подробности в 🏃 Ивенты.`);

  // 3. Кто ответственный — спрашиваем ответившего фаундера.
  const pick: InlineKeyboardMarkup = {
    inline_keyboard: team.map((m) => [{ text: nameOf(m), callback_data: `cr:${ev.id}:${m.chat_id}` }]),
  };
  await api.sendMessage(by, `Кто ответственный за ${lcFirst(ev.title)} ${shortDay(ev.starts_at)}?`, { reply_markup: pick }).catch(() => {});

  // 4. Задачи отделам.
  await createCoffeeTasks(deps, api, week, ev, by, team, now);

  // 5. Опрос «кто будет».
  const day = shortDay(ev.starts_at);
  await sendAll(api, everyone, `Будешь на кофе-ране ${day}?`, rsvpKeyboard(ev.id));
  return null;
}

const rsvpKeyboard = (eventId: number): InlineKeyboardMarkup => ({
  inline_keyboard: [[{ text: "Буду", callback_data: `rs:${eventId}:y` }, { text: "Не смогу", callback_data: `rs:${eventId}:n` }]],
});

/**
 * Задачи кофе-рана: от каждого отдела одна задача его ответственному за
 * кофе-ран (coffee-run-template.ts) — заголовок, чек-лист и кнопка
 * «➕ Раздать задачи отделу». Нет ответственного — задача отдела не
 * создаётся, фаундеру сообщение.
 */
export async function createCoffeeTasks(
  deps: CoffeeWeekDeps,
  api: WeekApi,
  week: string,
  ev: TeamEvent,
  author: number,
  team: TeamMember[],
  now: Date,
): Promise<AssignedTask[]> {
  const runDate = mskToday(new Date(ev.starts_at));
  const label = `${ev.title}, ${shortDay(ev.starts_at)}`;
  const drafts: AssignedTaskDraft[] = [];
  const lateLines = new Set<number>();
  for (const [i, t] of COFFEE_OWNER_TASKS.entries()) {
    const setting = deps.ownerSetting ? await deps.ownerSetting(t.setting).catch(() => null) : null;
    const owner = coffeeOwner(t, team, setting);
    const username = normalizeTaskUsername(owner?.username);
    if (!owner || !username) {
      await api.sendMessage(author, `Ответственный за кофе-ран (${t.role}) не найден, задача отдела ${departmentName(t.department)} не создана. Назначь его в 👥 Команда → «☕ Кофе-ран: ответственные».`).catch(() => {});
      continue;
    }
    const { due, late } = coffeeTaskDue(t, week, runDate, now);
    if (late) lateLines.add(i + 1);
    drafts.push({ line: i + 1, username, what: coffeeOwnerTaskText(t, label, { weekStart: week, runDate }), due_at: due.toISOString() });
  }
  if (!drafts.length) return [];
  await syncTeamTaskMembers({ store: deps.tasks }, now, team);
  const tasks = await deps.tasks.importAssignedTasks(author, TASK_SOURCE_BASE + ev.id, drafts);
  await deps.weeks.setTasks(week, tasks.map((t) => t.id));
  const late = new Set(tasks.filter((t) => lateLines.has(t.line)).map((t) => t.id));
  const authorName = team.find((m) => m.chat_id === author)?.username ?? undefined;
  // Ответственному — кнопка раздать задачи отделу (обычный ввод задач).
  await deliverAssigned(api as unknown as Parameters<typeof deliverAssigned>[0], deps.tasks, tasks.filter((t) => t.delivery_state === "pending"), authorName, now, late, {
    rowsFor: () => [[{ text: "➕ Раздать задачи отделу", callback_data: taskCb.upload() }]],
  });
  return tasks;
}

// ── Подтверждение за 24 часа ─────────────────────────────────────────────────

const confirmKeyboard = (eventId: number): InlineKeyboardMarkup => ({
  inline_keyboard: [[{ text: "Проводим", callback_data: `cc:${eventId}:y` }, { text: "Отменяем", callback_data: `cc:${eventId}:n` }]],
});

/** За сутки — «Проводим?» ответственному (нет — автору); за 12 часов без ответа — фаундерам. */
export async function dispatchConfirmations(deps: CoffeeWeekDeps, api: WeekApi, now: Date): Promise<string[]> {
  const done: string[] = [];
  const soon = await deps.events.listBetween(now, new Date(now.getTime() + CONFIRM_BEFORE_MS));
  const team = await deps.listTeam();
  for (const ev of soon.filter(isCoffeeRunEvent)) {
    const left = Date.parse(ev.starts_at) - now.getTime();
    if (left <= CONFIRM_BEFORE_MS && !ev.confirm_asked_at && (await deps.events.mark(ev.id, "confirm_asked_at", now))) {
      const to = ev.responsible_chat_id ?? ev.created_by;
      await api.sendMessage(to, `Завтра ${lcFirst(ev.title)}, ${hhmmOf(ev.starts_at)}. Проводим?`, { reply_markup: confirmKeyboard(ev.id) }).catch(() => {});
      done.push(`confirm ${ev.id}`);
      continue;
    }
    if (left <= CONFIRM_NAG_BEFORE_MS && ev.confirm_asked_at && !ev.confirmed_at && (await deps.events.mark(ev.id, "confirm_nag_at", now))) {
      const who = nameOf(team.find((m) => m.chat_id === (ev.responsible_chat_id ?? ev.created_by)));
      await sendAll(api, foundersOf(deps), `Ответственный ${who} не подтвердил кофе-ран на завтра.`);
      done.push(`nag ${ev.id}`);
    }
  }
  return done;
}

/** «Отменяем»: событие отменено, незакрытые задачи этого кофе-рана — тоже. */
async function cancelCoffeeRun(deps: CoffeeWeekDeps, ev: TeamEvent, now: Date): Promise<void> {
  await deps.events.cancel(ev.id, now);
  const row = await deps.weeks.byEvent(ev.id);
  for (const id of row?.task_ids ?? []) {
    const t = await deps.tasks.getAssignedTask(id);
    if (!t || (t.status !== "open" && t.status !== "taken" && t.status !== "declined")) continue;
    await deps.tasks.setAssignedStatus(id, t.assigned_by, "cancel").catch(() => {});
  }
}

// ── Кнопки и формы ───────────────────────────────────────────────────────────

const CALLBACK_RE = /^(cw|cr|rs|cc):/;

function dayButtons(week: string, today: string): InlineKeyboardMarkup {
  const rows: InlineKeyboardMarkup["inline_keyboard"] = [];
  const sunday = addDays(week, 6);
  for (let d = today; d <= sunday; d = addDays(d, 1)) rows.push([{ text: dayHeader(d), callback_data: `cw:d:${week}:${d}` }]);
  return { inline_keyboard: rows };
}

function timeButtons(week: string, ymd: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      TIMES.slice(0, 2).map((t) => ({ text: t, callback_data: `cw:t:${week}:${ymd}:${t.replace(":", "")}` })),
      TIMES.slice(2).map((t) => ({ text: t, callback_data: `cw:t:${week}:${ymd}:${t.replace(":", "")}` })),
      [{ text: "Другое", callback_data: `cw:to:${week}:${ymd}` }],
    ],
  };
}

function spotButtons(week: string, ymd: string, hhmm: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      ...SPOTS.map((s) => [{ text: s.name, callback_data: `cw:s:${week}:${ymd}:${hhmm}:${s.slug}` }]),
      [{ text: "Другое место", callback_data: `cw:so:${week}:${ymd}:${hhmm}` }],
    ],
  };
}

/** «Кофе-ран · Усачёва» посреди фразы: строчная только первая буква. */
const lcFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

const fmtHHMM = (hhmm: string) => `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;

export async function handleCoffeeWeekUpdate(ctx: Context, deps: CoffeeWeekDeps, now = new Date()): Promise<boolean> {
  if (ctx.chat?.type !== "private" || !ctx.from) return false;
  const uid = ctx.from.id;
  const data = ctx.callbackQuery?.data ?? "";
  const text = ctx.message?.text?.trim() ?? "";
  // Нажавшему — сразу; остальным ночью — утром (тихие часы, outbox.ts).
  const api = quietApi<WeekApi>({
    sendMessage: (chat, t, other) => ctx.api.sendMessage(chat, t, other),
    editMessageText: (chat, id, t, other) => ctx.api.editMessageText(chat, id, t, other),
  }, "coffee", now, { except: uid });
  const edit = async (t: string, keyboard?: InlineKeyboardMarkup) => {
    await ctx.editMessageText(t, keyboard ? { reply_markup: keyboard } : undefined).catch(() => ctx.reply(t, keyboard ? { reply_markup: keyboard } : undefined));
  };

  const weekly = /^\/coffee_weekly(?:@\w+)?(?:\s+(on|off))?\s*$/i.exec(text);
  if (weekly) {
    await weeklyCommand(ctx, uid, weekly[1]?.toLowerCase(), now);
    return true;
  }

  // Своё время или место — следующим сообщением.
  if (text && !text.startsWith("/") && !data) {
    const form = await deps.forms.get(uid);
    if (form?.kind !== "cw.time" && form?.kind !== "cw.place") return false;
    if (teamFormExpired(form, now)) {
      await deps.forms.clear(uid);
      await ctx.reply("Форма устарела. Начни с вопроса «Проводим кофе-ран на этой неделе?».");
      return true;
    }
    if (form.kind === "cw.time") {
      const m = /^(\d{1,2})[:.](\d{2})$/.exec(text);
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
        await ctx.reply("Время — ЧЧ:ММ, например 10:30. Отмена: /cancel.");
        return true;
      }
      await deps.forms.clear(uid);
      const hhmm = `${m[1].padStart(2, "0")}${m[2]}`;
      await ctx.reply(`Где? ${dayHeader(form.params.ymd)}, ${fmtHHMM(hhmm)}`, { reply_markup: spotButtons(form.params.week, form.params.ymd, hhmm) });
      return true;
    }
    await deps.forms.clear(uid);
    const res = await decideYes(deps, api, form.params.week, uid, { ymd: form.params.ymd, hhmm: fmtHHMM(form.params.hhmm), spot: null, place: text.slice(0, 200) }, now);
    if (res) await ctx.reply(res);
    return true;
  }

  if (!CALLBACK_RE.test(data)) return false;
  await ctx.answerCallbackQuery().catch(() => {});
  const parts = data.split(":");
  const [kind, op] = parts;

  if (kind === "rs") {
    const [, id, ans] = parts;
    const ev = await deps.events.get(Number(id));
    if (!ev || ev.cancelled_at) {
      await edit("Этот кофе-ран отменён.");
      return true;
    }
    await deps.rsvp.set(ev.id, uid, ans === "y" ? "yes" : "no", now);
    await edit(`Будешь на кофе-ране ${shortDay(ev.starts_at)}? Ответ: ${ans === "y" ? "буду ✅" : "не смогу"}. Можно поменять.`, rsvpKeyboard(ev.id));
    return true;
  }

  if (kind === "cc") {
    const [, id, ans] = parts;
    const ev = await deps.events.get(Number(id));
    if (!ev || ev.cancelled_at) {
      await edit("Этот кофе-ран уже отменён.");
      return true;
    }
    if (ev.responsible_chat_id !== uid && ev.created_by !== uid && !isFounder(uid)) {
      await ctx.reply("Подтвердить кофе-ран может ответственный, автор или фаундер.");
      return true;
    }
    const team = await deps.listTeam();
    if (ans === "y") {
      if (!(await deps.events.mark(ev.id, "confirmed_at", now))) {
        await edit(`Уже подтверждено: ${lcFirst(ev.title)}, ${shortDay(ev.starts_at)} ${hhmmOf(ev.starts_at)}.`);
        return true;
      }
      await edit(`✅ Проводим: ${lcFirst(ev.title)}, ${shortDay(ev.starts_at)} ${hhmmOf(ev.starts_at)}.`);
      await sendAll(api, team.map((m) => m.chat_id), `✅ Кофе-ран завтра в ${hhmmOf(ev.starts_at)} подтверждён\n\n${coffeeCardText(ev, await rsvpLine(deps, ev))}`);
    } else {
      await cancelCoffeeRun(deps, ev, now);
      await edit(`❌ Отменено: ${lcFirst(ev.title)}, ${shortDay(ev.starts_at)}.`);
      await sendAll(api, team.map((m) => m.chat_id), "❌ Кофе-ран завтра отменён");
      await ctx.reply("Участникам отмену нужно разослать через основного бота командой /cancel.");
    }
    return true;
  }

  if (kind === "cr") {
    const [, id, chat] = parts;
    const ev = await deps.events.get(Number(id));
    if (!ev) return true;
    if (ev.created_by !== uid && !isFounder(uid)) {
      await ctx.reply("Ответственного выбирает фаундер, принявший решение.");
      return true;
    }
    const updated = await deps.events.assignResponsible(ev.id, Number(chat), now);
    const team = await deps.listTeam();
    const who = nameOf(team.find((m) => m.chat_id === Number(chat)));
    await edit(`Ответственный за ${lcFirst(ev.title)}: ${who}.`);
    if (updated) {
      await api.sendMessage(Number(chat), `Ты ответственный за кофе-ран.\n\n${coffeeCardText(updated, null)}`, { parse_mode: "HTML" }).catch(() => {});
    }
    return true;
  }

  // cw: шаги решения. Блокировка — только на финальном нажатии (decideYes / decideNo).
  if (!isFounder(uid)) {
    await ctx.reply("Решение про кофе-ран принимают фаундеры.");
    return true;
  }
  const week = parts[2];
  if ((await deps.weeks.get(week))?.decision) {
    await ctx.reply(await alreadyDecided(deps, week));
    return true;
  }
  if (op === "no") {
    const res = await decideNo(deps, api, week, uid, now);
    if (res) await ctx.reply(res);
    return true;
  }
  if (op === "same") {
    const last = await lastRun(deps, now);
    if (!last) return true;
    const ymd = addDays(week, last.weekday - 1);
    if (mskMoment(ymd, last.hhmm).getTime() <= now.getTime()) {
      await edit("Этот день уже прошёл. Выбери день:", dayButtons(week, mskToday(now)));
      return true;
    }
    const res = await decideYes(deps, api, week, uid, { ymd, hhmm: last.hhmm, spot: last.spot, place: null }, now);
    if (res) await ctx.reply(res);
    return true;
  }
  if (op === "pick") {
    await edit(`${WEEK_QUESTION} Выбери день:`, dayButtons(week, mskToday(now)));
    return true;
  }
  if (op === "d") {
    await edit(`${dayHeader(parts[3])}. Во сколько?`, timeButtons(week, parts[3]));
    return true;
  }
  if (op === "to") {
    await deps.forms.set(uid, openTeamForm("cw.time", { week, ymd: parts[3] }, now), now);
    await ctx.reply("Пришли время одним сообщением, например 10:30. Отмена: /cancel.");
    return true;
  }
  if (op === "t") {
    await edit(`${dayHeader(parts[3])}, ${fmtHHMM(parts[4])}. Где?`, spotButtons(week, parts[3], parts[4]));
    return true;
  }
  if (op === "so") {
    await deps.forms.set(uid, openTeamForm("cw.place", { week, ymd: parts[3], hhmm: parts[4] }, now), now);
    await ctx.reply("Пришли место одним сообщением: адрес или название. Отмена: /cancel.");
    return true;
  }
  if (op === "s") {
    const res = await decideYes(deps, api, week, uid, { ymd: parts[3], hhmm: fmtHHMM(parts[4]), spot: parts[5], place: null }, now);
    if (res) await ctx.reply(res);
    return true;
  }
  return true;
}

// ── Боевые зависимости и тикер ───────────────────────────────────────────────

async function readWeeklySetting(): Promise<string | null> {
  const { data, error } = await tgAdmin().from("team_settings").select("value").eq("key", WEEKLY_SETTING).maybeSingle();
  if (error) throw new Error(`team_settings: ${error.message}`);
  return (data as { value: string | null } | null)?.value ?? null;
}

async function writeWeeklySetting(value: "on" | "off", by: number, now: Date): Promise<void> {
  const { error } = await tgAdmin().from("team_settings")
    .upsert({ key: WEEKLY_SETTING, value, updated_by: by, updated_at: now.toISOString() }, { onConflict: "key" });
  if (error) throw new Error(`team_settings: ${error.message}`);
}

export function defaultCoffeeWeekDeps(): CoffeeWeekDeps {
  return {
    weeks: supabaseWeekStore(),
    events: supabaseEventStore(),
    rsvp: supabaseRsvpStore(),
    tasks: createSupabaseStore(),
    forms: supabaseTeamForms(),
    // Кофе-ран — модуль nika: анонсы, опрос и задачи только её участникам.
    listTeam: () => listProjectTeam(NIKA),
    // Пока кофе-раны проводим — вопрос идёт каждую неделю; выключает фаундер командой /coffee_weekly off.
    enabled: async () => (await readWeeklySetting()) !== "off",
    ownerSetting: (key) => supabaseSettingsStore().get(key),
  };
}

/** Проход 15-минутного тикера (instrumentation.ts). */
export async function tickCoffeeRunWeek(now = new Date()): Promise<string[]> {
  if (!teamBotConfigured()) return [];
  const api = new Api(teamToken());
  // Тихие часы: подтверждение «Проводим?» и напоминания ночью ложатся в очередь до 09:00.
  const weekApi = quietApi<WeekApi>({
    sendMessage: (chat, text, other) => api.sendMessage(chat, text, other),
    editMessageText: (chat, id, text, other) => api.editMessageText(chat, id, text, other),
  }, "coffee", now);
  return dispatchCoffeeRunWeek(defaultCoffeeWeekDeps(), weekApi, now);
}

/** Скрытая команда фаундера: /coffee_weekly on|off — проводим ли кофе-раны каждую неделю. */
async function weeklyCommand(ctx: Context, uid: number, arg: string | undefined, now: Date): Promise<void> {
  if (!isFounder(uid)) {
    await ctx.reply("Это команда фаундеров.");
    return;
  }
  if (arg === "on" || arg === "off") await writeWeeklySetting(arg, uid, now);
  const state = arg ?? ((await readWeeklySetting()) === "off" ? "off" : "on");
  await ctx.reply(state === "off"
    ? "Кофе-раны на паузе: по понедельникам вопрос не приходит. Включить: /coffee_weekly on."
    : `Кофе-раны каждую неделю: вопрос фаундерам по понедельникам в ${WEEKLY_ASK_HOUR}:00. Выключить: /coffee_weekly off.`);
}
