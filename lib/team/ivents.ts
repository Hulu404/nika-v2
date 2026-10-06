import type { Context } from "grammy";
import { COFFEE_RUNS } from "../coffeerun/run";
import { findMember, listTeam, type TeamMember } from "./access";
import {
  IVENT_CALLBACK_RE,
  backToRunKeyboard,
  clubEventScreen,
  coffeeRunScreen,
  iventsScreen,
  participantsText,
  pastIventsScreen,
  remindersText,
  runTitle,
  type IventItem,
  type TaskScreen,
} from "./copy";
import { canManageEvent, coffeeRunStart, eventKey, coffeeRunKey, supabaseEventStore, type TeamEvent, type TeamEventStore } from "./events";
import { aggregateRuns, dynamicsFor, fetchArchive, runKeysFrom, type ArchiveRow, type RunAggregate } from "./history";
import { isPast, mergeRuns, teamRun, type RunKey, type TeamRun } from "./runs";
import { fetchRunSignups, summarizeSignups, viewSignups, type SignupRow } from "./stats";

/**
 * Раздел «Ивенты» (/events): предстоящие ивенты всех клубов, экран ивента,
 * участники и рассылка кофе-рана, прошедшие. Один раздел вместо прежних
 * /runs, /run, /who, /notif, /contacts, /history; подсчёт — те же stats.ts и
 * history.ts.
 */

export interface FactReader {
  /** Внесённая явка по ключам coffeerun:<spot>:<date> / event:<id>. */
  getMany(keys: readonly string[]): Promise<Map<string, number>>;
}

export interface EventsDeps {
  events: TeamEventStore;
  findMember: (chatId: number) => Promise<TeamMember | null>;
  listTeam: () => Promise<TeamMember[]>;
  fetchArchive: () => Promise<ArchiveRow[]>;
  fetchSignups: (run: RunKey) => Promise<SignupRow[]>;
  /** Явка (этап «Сводка и явка»). Без неё экраны пишут «Явка не внесена». */
  facts?: FactReader;
  /** Кнопка «Внести явку» и её обработчик. */
  attend?: (ctx: Context, key: string, title: string) => Promise<void>;
}

export function defaultEventsDeps(): EventsDeps {
  return { events: supabaseEventStore(), findMember, listTeam, fetchArchive, fetchSignups: fetchRunSignups };
}

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
const HOUR = 3_600_000;

async function show(ctx: Context, screen: TaskScreen, edit: boolean, html = true): Promise<void> {
  const opts = { ...(html ? HTML : {}), reply_markup: screen.keyboard };
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(screen.text, opts);
      return;
    } catch (err) {
      if ((err instanceof Error ? err.message : String(err)).includes("message is not modified")) return;
    }
  }
  await ctx.reply(screen.text, opts);
}

async function namesOf(deps: EventsDeps): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  for (const m of await deps.listTeam()) if (m.username) map.set(m.chat_id, m.username);
  return map;
}

function aggFor(aggs: readonly RunAggregate[], run: RunKey): RunAggregate | null {
  return aggs.find((a) => a.spot === run.spot && a.date === run.date) ?? null;
}

/** Ориентир времени для сортировки прошедших забегов, которых уже нет в расписании. */
const runMoment = (run: TeamRun) => (run.scheduled ? coffeeRunStart(run.scheduled) : new Date(`${run.date}T10:00:00+03:00`).toISOString());

async function factsFor(deps: EventsDeps, keys: string[]): Promise<Map<string, number>> {
  if (!deps.facts || !keys.length) return new Map();
  return deps.facts.getMany(keys);
}

/** Предстоящие ивенты: team_events (club_event) с этой минуты плюс непрошедшие кофе-раны. */
export async function upcomingIvents(deps: EventsDeps, now: Date): Promise<IventItem[]> {
  const [archive, events] = await Promise.all([
    deps.fetchArchive(),
    deps.events.listBetween(new Date(now.getTime() - 3 * HOUR), new Date(now.getTime() + 365 * 24 * HOUR)),
  ]);
  const aggs = aggregateRuns(archive);
  const runs: IventItem[] = COFFEE_RUNS.filter((r) => !isPast(r.date, now)).map((r) => {
    const run = teamRun({ spot: r.spot, date: r.date }, now);
    return { kind: "run" as const, run, startsAt: coffeeRunStart(r), agg: aggFor(aggs, run) };
  });
  const clubEvents: IventItem[] = events.filter((e) => e.kind === "club_event").map((event) => ({ kind: "event" as const, event }));
  return [...runs, ...clubEvents].sort((a, b) => Date.parse(start(a)) - Date.parse(start(b)));
}

const start = (it: IventItem) => (it.kind === "run" ? it.startsAt : it.event.starts_at);

/** Прошедшие: кофе-раны из базы заявок и ивенты клубов, от новых к старым. */
export async function pastIvents(deps: EventsDeps, now: Date): Promise<IventItem[]> {
  const [archive, events] = await Promise.all([deps.fetchArchive(), deps.events.listPastClubEvents(now, 500)]);
  const aggs = aggregateRuns(archive);
  const runs: IventItem[] = mergeRuns(runKeysFrom(archive), now).filter((r) => r.past)
    .map((run) => ({ kind: "run" as const, run, startsAt: runMoment(run), agg: aggFor(aggs, run) }));
  const items: IventItem[] = [...runs, ...events.map((event) => ({ kind: "event" as const, event }))]
    .sort((a, b) => Date.parse(start(b)) - Date.parse(start(a)));
  const facts = await factsFor(deps, items.map((it) => (it.kind === "run" ? coffeeRunKey(it.run) : eventKey(it.event))));
  return items.map((it) => ({ ...it, fact: facts.get(it.kind === "run" ? coffeeRunKey(it.run) : eventKey(it.event)) ?? null }));
}

export async function showIvents(ctx: Context, deps: EventsDeps, edit: boolean, now: Date): Promise<void> {
  const [items, names] = await Promise.all([upcomingIvents(deps, now), namesOf(deps)]);
  await show(ctx, iventsScreen(items, names), edit);
}

export async function openCoffeeRunScreen(ctx: Context, deps: EventsDeps, spot: string, date: string, edit: boolean, now: Date): Promise<void> {
  const run = teamRun({ spot, date }, now);
  const [rows, archive, facts] = await Promise.all([
    deps.fetchSignups(run), deps.fetchArchive(), factsFor(deps, [coffeeRunKey(run)]),
  ]);
  if (!rows.length && !run.scheduled && !archive.some((r) => r.spot === spot && r.run_date === date)) {
    await ctx.reply("Про этот кофе-ран я ничего не знаю.");
    return;
  }
  const stats = summarizeSignups(rows, now);
  const dyn = run.past ? null : dynamicsFor(run, archive, now);
  await show(ctx, coffeeRunScreen(run, stats, dyn, facts.get(coffeeRunKey(run)) ?? null, !!deps.attend), edit);
}

export async function openClubEventScreen(ctx: Context, deps: EventsDeps, ev: TeamEvent, uid: number, edit: boolean, now: Date): Promise<void> {
  const [names, facts] = await Promise.all([namesOf(deps), factsFor(deps, [eventKey(ev)])]);
  const past = Date.parse(ev.starts_at) < now.getTime();
  await show(ctx, clubEventScreen(ev, names, {
    past, fact: facts.get(eventKey(ev)) ?? null, canManage: canManageEvent(ev, uid), attendable: !!deps.attend,
  }), edit);
}

const EVENTS_COMMAND = /^\/events(?:@([a-z0-9_]+))?(?=\s|$)/i;

export async function handleEventsUpdate(ctx: Context, providedDeps?: EventsDeps, now = new Date()): Promise<boolean> {
  if (ctx.chat?.type !== "private" || !ctx.from || ctx.chat.id !== ctx.from.id) return false;
  const text = ctx.message?.text?.trim() ?? "";
  const command = EVENTS_COMMAND.exec(text);
  if (command?.[1] && ctx.me?.username && command[1].toLowerCase() !== ctx.me.username.toLowerCase()) return false;
  const cb = IVENT_CALLBACK_RE.exec(ctx.callbackQuery?.data ?? "");
  if (!command && !cb) return false;

  if (cb) await ctx.answerCallbackQuery().catch(() => {});
  const deps = providedDeps ?? defaultEventsDeps();
  const uid = ctx.from.id;
  if (!(await deps.findMember(uid))) {
    await ctx.reply("Ивенты доступны участникам команды. Войди через /join.");
    return true;
  }

  try {
    if (command) {
      await showIvents(ctx, deps, false, now);
      return true;
    }
    const [, op, a, b] = cb!;
    switch (op) {
      case "l":
        await showIvents(ctx, deps, true, now);
        return true;
      case "p": {
        await show(ctx, pastIventsScreen(await pastIvents(deps, now), Number(a ?? 0)), true);
        return true;
      }
      case "r":
        await openCoffeeRunScreen(ctx, deps, a ?? "", b ?? "", true, now);
        return true;
      case "e": {
        const ev = await deps.events.get(Number(a));
        if (!ev || ev.cancelled_at) await ctx.reply("Такого ивента больше нет.");
        else await openClubEventScreen(ctx, deps, ev, uid, true, now);
        return true;
      }
      case "u": {
        const run = teamRun({ spot: a ?? "", date: b ?? "" }, now);
        const rows = await deps.fetchSignups(run);
        await show(ctx, { text: participantsText(run, viewSignups(rows)), keyboard: backToRunKeyboard(run) }, true);
        return true;
      }
      case "m": {
        const run = teamRun({ spot: a ?? "", date: b ?? "" }, now);
        const rows = await deps.fetchSignups(run);
        await show(ctx, { text: remindersText(run, viewSignups(rows), summarizeSignups(rows, now), now), keyboard: backToRunKeyboard(run) }, true, false);
        return true;
      }
      case "me": {
        const updated = await deps.events.setResponsible(Number(a), uid, now);
        if (!updated) await ctx.reply("Ответственный уже есть.");
        const ev = updated ?? (await deps.events.get(Number(a)));
        if (ev) await openClubEventScreen(ctx, deps, ev, uid, true, now);
        return true;
      }
      case "ar":
      case "ae": {
        if (!deps.attend) return true;
        if (op === "ar") {
          const run = teamRun({ spot: a ?? "", date: b ?? "" }, now);
          await deps.attend(ctx, coffeeRunKey(run), `${runTitle(run)}, ${run.date.slice(8, 10)}.${run.date.slice(5, 7)}`);
        } else {
          const ev = await deps.events.get(Number(a));
          if (ev) await deps.attend(ctx, eventKey(ev), ev.title);
        }
        return true;
      }
    }
  } catch (err) {
    console.error("[team-events]", err instanceof Error ? err.message : String(err));
    await ctx.reply("Не получилось достать данные по ивентам. Попробуй ещё раз чуть позже.");
    return true;
  }
  return false;
}
