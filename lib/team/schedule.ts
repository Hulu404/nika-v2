import { InlineKeyboard, type Context } from "grammy";
import { COFFEE_RUNS } from "../coffeerun/run";
import { findMember, listTeam, type TeamMember } from "./access";
import { clubByKey } from "./clubs";
import {
  EVENT_ADD_HINT,
  EVENT_CALLBACK_RE,
  EVENT_TIME_PROMPT,
  escapeHtmlTeam,
  eventAnnounceText,
  eventCancelAskScreen,
  eventCancelledText,
  eventCard,
  eventCb,
  eventClubKeyboard,
  eventDraftText,
  eventKindKeyboard,
  eventNotifyKeyboard,
  eventWhen,
  scheduleScreen,
  type TaskScreen,
} from "./copy";
import {
  EventParseError,
  canManageEvent,
  coffeeRunStart,
  coffeeRunTitle,
  parseEventLine,
  parseEventTime,
  scheduleItems,
  supabaseEventStore,
  weekRange,
  type TeamEvent,
  type TeamEventKind,
  type TeamEventStore,
} from "./events";
import { openTeamForm, supabaseTeamForms, teamFormExpired, type TeamFormStore } from "./form";
import { mskMidnight } from "../databot/dates";
import { addDays } from "../databot/time";

/**
 * Расписание «Пятницы» (/schedule, /event). Создавать события может любой
 * участник; менять время и отменять — автор, ответственный и фаундеры.
 */

export interface ScheduleDeps {
  events: TeamEventStore;
  forms: TeamFormStore;
  findMember: (chatId: number) => Promise<TeamMember | null>;
  listTeam: () => Promise<TeamMember[]>;
  /** Экран ивента клуба (этап «Ивенты»). Без него открывается простая карточка. */
  openClubEvent?: (ctx: Context, ev: TeamEvent) => Promise<void>;
  openCoffeeRun?: (ctx: Context, spot: string, date: string) => Promise<void>;
}

export function defaultScheduleDeps(): ScheduleDeps {
  return { events: supabaseEventStore(), forms: supabaseTeamForms(), findMember, listTeam };
}

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

async function show(ctx: Context, screen: TaskScreen, edit: boolean): Promise<void> {
  const opts = { ...HTML, reply_markup: screen.keyboard };
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

async function namesOf(deps: ScheduleDeps): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  for (const m of await deps.listTeam()) if (m.username) map.set(m.chat_id, m.username);
  return map;
}

/** Разослать всем в команде, кроме автора действия. Сбои отдельных отправок не останавливают остальных. */
async function broadcast(ctx: Context, deps: ScheduleDeps, except: number, text: string): Promise<number> {
  let sent = 0;
  for (const m of await deps.listTeam()) {
    if (m.chat_id === except) continue;
    try {
      await ctx.api.sendMessage(m.chat_id, text, HTML);
      sent++;
    } catch {
      /* человек закрыл бота — это не повод не сообщить остальным */
    }
  }
  return sent;
}

export async function showSchedule(ctx: Context, deps: ScheduleDeps, offset: number, edit: boolean, now: Date): Promise<void> {
  const { fromYmd, days } = weekRange(now, offset);
  const from = mskMidnight(fromYmd);
  const to = mskMidnight(addDays(fromYmd, 7));
  const events = await deps.events.listBetween(from, to);
  await show(ctx, scheduleScreen(scheduleItems(events, days, COFFEE_RUNS), days, offset), edit);
}

const SCHEDULE_COMMAND = /^\/(schedule|event)(?:@([a-z0-9_]+))?(?=\s|$)/i;

export async function handleScheduleUpdate(ctx: Context, providedDeps?: ScheduleDeps, now = new Date()): Promise<boolean> {
  if (ctx.chat?.type !== "private" || !ctx.from || ctx.chat.id !== ctx.from.id) return false;
  const text = ctx.message?.text?.trim() ?? "";
  const command = SCHEDULE_COMMAND.exec(text);
  if (command?.[2] && ctx.me?.username && command[2].toLowerCase() !== ctx.me.username.toLowerCase()) return false;
  const data = ctx.callbackQuery?.data ?? "";
  const cb = EVENT_CALLBACK_RE.exec(data);
  const isFreeText = !!text && !text.startsWith("/");
  if (!command && !cb && !isFreeText) return false;

  const deps = providedDeps ?? defaultScheduleDeps();
  const uid = ctx.from.id;
  let form = isFreeText ? await deps.forms.get(uid) : null;
  if (isFreeText && form?.kind !== "event.new" && form?.kind !== "event.time") return false;

  if (cb) await ctx.answerCallbackQuery().catch(() => {});
  const member = await deps.findMember(uid);
  if (!member) {
    if (command || cb) {
      await ctx.reply("Расписание доступно участникам команды. Войди через /join.");
      return true;
    }
    return false;
  }

  try {
    if (command) {
      const args = text.slice(command[0].length).trim();
      if (command[1].toLowerCase() === "schedule") {
        await showSchedule(ctx, deps, 0, false, now);
        return true;
      }
      if (!args) {
        await deps.forms.set(uid, openTeamForm("event.new", {}, now), now);
        await ctx.reply(EVENT_ADD_HINT, HTML);
        return true;
      }
      await startDraft(ctx, deps, uid, text, now, false);
      return true;
    }

    if (form && isFreeText) {
      if (teamFormExpired(form, now)) {
        await deps.forms.clear(uid);
        await ctx.reply("Форма устарела. Начни заново: /event или /schedule.");
        return true;
      }
      if (form.kind === "event.new") {
        await startDraft(ctx, deps, uid, text, now, true);
        return true;
      }
      await applyTime(ctx, deps, uid, Number(form.params.id), text, now);
      return true;
    }

    if (!cb) return false;
    const [, op, a, b] = cb;
    switch (op) {
      case "w":
        await showSchedule(ctx, deps, a === "1" ? 1 : 0, true, now);
        return true;
      case "add":
        await deps.forms.set(uid, openTeamForm("event.new", {}, now), now);
        await ctx.reply(EVENT_ADD_HINT, HTML);
        return true;
      case "o":
        await openEvent(ctx, deps, uid, Number(a), Number(b ?? 0));
        return true;
      case "r":
        if (deps.openCoffeeRun) await deps.openCoffeeRun(ctx, a ?? "", b ?? "");
        else await showCoffeeRun(ctx, a ?? "", b ?? "");
        return true;
      case "k": case "c": case "n": case "drop":
        await draftStep(ctx, deps, uid, op, a ?? "", now);
        return true;
      case "t":
        await askTime(ctx, deps, uid, Number(a), now);
        return true;
      case "x":
        await askCancel(ctx, deps, uid, Number(a));
        return true;
      case "X":
        await doCancel(ctx, deps, uid, Number(a), b === "1", now);
        return true;
    }
  } catch (err) {
    console.error("[team-schedule]", err instanceof Error ? err.message : String(err));
    await ctx.reply("Не получилось достать расписание. Попробуй ещё раз чуть позже.");
    return true;
  }
  return false;
}

async function startDraft(ctx: Context, deps: ScheduleDeps, uid: number, text: string, now: Date, fromForm: boolean): Promise<void> {
  let draft;
  try {
    draft = parseEventLine(text.startsWith("/") ? text : `/event ${text}`, now);
  } catch (err) {
    if (err instanceof EventParseError) {
      if (!fromForm) await deps.forms.set(uid, openTeamForm("event.new", {}, now), now);
      await ctx.reply(`${err.message}\nПришли строку ещё раз или /cancel.`);
      return;
    }
    throw err;
  }
  let responsible: TeamMember | null = null;
  if (draft.responsible) {
    responsible = (await deps.listTeam()).find((m) => m.username?.toLowerCase() === draft.responsible) ?? null;
    if (!responsible) {
      await deps.forms.set(uid, openTeamForm("event.new", {}, now), now);
      await ctx.reply(`Не нашла @${draft.responsible} в команде. Проверь ник (полный список в /team) и пришли строку ещё раз или /cancel.`);
      return;
    }
  }
  await deps.forms.set(uid, openTeamForm("event.draft", {
    title: draft.title,
    startsAt: draft.startsAt,
    place: draft.place ?? "",
    resp: responsible ? String(responsible.chat_id) : "",
    respName: responsible?.username ?? "",
  }, now), now);
  await ctx.reply(`${eventDraftText(draft, responsible?.username ?? null)}\n\nЧто это?`, { ...HTML, reply_markup: eventKindKeyboard() });
}

async function draftStep(ctx: Context, deps: ScheduleDeps, uid: number, op: string, value: string, now: Date): Promise<void> {
  const form = await deps.forms.get(uid);
  if (!form || form.kind !== "event.draft" || teamFormExpired(form, now)) {
    await ctx.reply("Черновик устарел. Пришли /event заново.");
    return;
  }
  const p = form.params;
  const head = eventDraftText({ title: p.title, startsAt: p.startsAt, place: p.place || null }, p.respName || null);
  if (op === "drop") {
    await deps.forms.clear(uid);
    await show(ctx, { text: `${head}\n\nНе добавила.`, keyboard: new InlineKeyboard() }, true);
    return;
  }
  if (op === "k") {
    const kind: TeamEventKind = value === "club" ? "club_event" : value === "meeting" ? "meeting" : "other";
    await deps.forms.set(uid, { ...form, params: { ...p, kind } }, now);
    if (kind === "club_event") await show(ctx, { text: `${head}\n\nКакой клуб?`, keyboard: eventClubKeyboard() }, true);
    else await show(ctx, { text: `${head}\n\nСообщить команде?`, keyboard: eventNotifyKeyboard() }, true);
    return;
  }
  if (op === "c") {
    if (!clubByKey(value)) return;
    await deps.forms.set(uid, { ...form, params: { ...p, club: value } }, now);
    await show(ctx, { text: `${head}\n\nСообщить команде?`, keyboard: eventNotifyKeyboard() }, true);
    return;
  }
  // op === "n": последний шаг — сохранить и при желании разослать анонс.
  const kind = (p.kind as TeamEventKind | undefined) ?? "other";
  if (kind === "club_event" && !clubByKey(p.club)) {
    await show(ctx, { text: `${head}\n\nКакой клуб?`, keyboard: eventClubKeyboard() }, true);
    return;
  }
  const ev = await deps.events.create({
    kind,
    club: kind === "club_event" ? p.club : null,
    title: p.title,
    starts_at: p.startsAt,
    place: p.place || null,
    responsible_chat_id: p.resp ? Number(p.resp) : null,
    created_by: uid,
  }, now);
  await deps.forms.clear(uid);
  const names = await namesOf(deps);
  let note = "";
  if (value === "1") note = `\nАнонс ушёл: ${await broadcast(ctx, deps, uid, eventAnnounceText(ev, names))} чел.`;
  await show(ctx, {
    text: `Добавила в расписание:\n\n${head}${note}`,
    keyboard: new InlineKeyboard().text("Открыть расписание", eventCb.week(0)),
  }, true);
}

async function openEvent(ctx: Context, deps: ScheduleDeps, uid: number, id: number, offset: number): Promise<void> {
  const ev = await deps.events.get(id);
  if (!ev) {
    await ctx.reply("Такого события больше нет.");
    return;
  }
  if (ev.kind === "club_event" && deps.openClubEvent) {
    await deps.openClubEvent(ctx, ev);
    return;
  }
  await show(ctx, eventCard(ev, await namesOf(deps), canManageEvent(ev, uid), offset), true);
}

/** Карточка кофе-рана только для чтения. Экран с цифрами — в «Ивентах». */
async function showCoffeeRun(ctx: Context, spot: string, date: string): Promise<void> {
  const run = COFFEE_RUNS.find((r) => r.spot === spot && r.date === date);
  if (!run) {
    await ctx.reply("Этого кофе-рана уже нет в расписании.");
    return;
  }
  await show(ctx, {
    text: [`<b>${escapeHtmlTeam(coffeeRunTitle(run))}</b>`, "🏃 Беговой клуб", eventWhen(coffeeRunStart(run)),
      `Сбор ${run.gatherTime}, ${escapeHtmlTeam(run.address)}`].join("\n"),
    keyboard: new InlineKeyboard().text("← К расписанию", eventCb.week(0)),
  }, true);
}

async function managed(ctx: Context, deps: ScheduleDeps, uid: number, id: number): Promise<TeamEvent | null> {
  const ev = await deps.events.get(id);
  if (!ev || ev.cancelled_at) {
    await ctx.reply("Такого события больше нет.");
    return null;
  }
  if (!canManageEvent(ev, uid)) {
    await ctx.reply("Менять время и отменять событие могут автор, ответственный и фаундеры.");
    return null;
  }
  return ev;
}

async function askTime(ctx: Context, deps: ScheduleDeps, uid: number, id: number, now: Date): Promise<void> {
  if (!(await managed(ctx, deps, uid, id))) return;
  await deps.forms.set(uid, openTeamForm("event.time", { id: String(id) }, now), now);
  await ctx.reply(EVENT_TIME_PROMPT);
}

async function applyTime(ctx: Context, deps: ScheduleDeps, uid: number, id: number, text: string, now: Date): Promise<void> {
  const ev = await managed(ctx, deps, uid, id);
  if (!ev) {
    await deps.forms.clear(uid);
    return;
  }
  let startsAt: string;
  try {
    startsAt = parseEventTime(text, now);
  } catch (err) {
    if (err instanceof EventParseError) {
      await ctx.reply(`${err.message}\nПопробуй ещё раз или /cancel.`);
      return;
    }
    throw err;
  }
  await deps.forms.clear(uid);
  const updated = await deps.events.setTime(id, startsAt, now);
  if (!updated) {
    await ctx.reply("Такого события больше нет.");
    return;
  }
  await ctx.reply(`Время обновлено: ${eventWhen(updated.starts_at)}.`);
  await show(ctx, eventCard(updated, await namesOf(deps), true), false);
}

async function askCancel(ctx: Context, deps: ScheduleDeps, uid: number, id: number): Promise<void> {
  const ev = await managed(ctx, deps, uid, id);
  if (ev) await show(ctx, eventCancelAskScreen(ev), true);
}

async function doCancel(ctx: Context, deps: ScheduleDeps, uid: number, id: number, notify: boolean, now: Date): Promise<void> {
  const ev = await managed(ctx, deps, uid, id);
  if (!ev) return;
  const cancelled = await deps.events.cancel(id, now);
  if (!cancelled) {
    await ctx.reply("Событие уже отменено.");
    return;
  }
  if (notify) await broadcast(ctx, deps, uid, eventCancelledText(cancelled));
  await showSchedule(ctx, deps, 0, true, now);
}
