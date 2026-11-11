import { InlineKeyboard, Keyboard } from "grammy";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COFFEE_RUNS, runForSignup } from "../coffeerun/run";
import { moscowToday, sessionOfSignup, isFreeSession } from "../clubs/sessions";
import { countTakenSeats, isSoldOut } from "../clubs/seats";
import { isHoldActive } from "../clubs/payments";
import { normalizeTelegramUsername } from "../coffeerun/telegram-username";
import { publicOriginFromEnv } from "../public-origin";
import { fromRun, fromSession, upcomingEvents, type LandingEvent } from "../landings/events";
import { placeholderValues } from "../landings/render";
import { attendanceLine, countAttendance, datesNeedingRollcallCheck } from "./attendance";
import { myClubSignups, myCoffeeRuns, rollcallDates, type MyClubRow, type MyCoffeeRunRow } from "./my-signups";
import { SUPPORT_LABEL, SUPPORT_URL } from "./cta";
import { tgAdmin } from "./supabase";
import { ticketLabel } from "./club-signup";
import type { BotContext } from "./bot";

/**
 * Постоянное меню бота мероприятий: клавиатура внизу чата и три экрана.
 *
 *   📅 Расписание      🎟 Мои записи
 *   💬 Служба поддержки
 *
 * Код свой, из «Пятницы» (lib/team) ничего не берём. Тексты дат, времени и
 * места собираются из тех же полей, что и лендинги (lib/landings), поэтому
 * формулировки в боте и на странице совпадают.
 */

export const MENU_SCHEDULE = "📅 Расписание";
export const MENU_MY_SIGNUPS = "🎟 Мои записи";
export const MENU_SUPPORT = "💬 Служба поддержки";
/** Место под четвёртую кнопку. В клавиатуру пока не добавляется: донатов ещё нет. */
export const MENU_DONATE = "💛 Поддержать";

/** Все надписи меню — их ловит bot.hears(). */
export const MENU_LABELS = [MENU_SCHEDULE, MENU_MY_SIGNUPS, MENU_SUPPORT] as const;

/** Инлайн-кнопка «📅 Расписание» под пустыми «Моими записями». */
export const MENU_SCHEDULE_CALLBACK = "menu:schedule";

export const COMMUNITY_URL = "https://t.me/nika_community";

/** Сколько событий показываем в расписании. */
export const SCHEDULE_LIMIT = 6;

export const BOT_ROLE =
  "Я бот мероприятий НИКИ: записываю на забеги и занятия клубов и напоминаю о них.";

export const UNKNOWN_INPUT_TEXT =
  `${BOT_ROLE} Всё, что умею, в кнопках внизу. Нужен живой человек, жми «Служба поддержки».`;

export const HELP_TEXT = [
  BOT_ROLE,
  "",
  "Команды:",
  "/start — подтвердить запись",
  "/stop — приостановить сообщения",
  "",
  "Расписание, твои записи и поддержка — в кнопках внизу.",
].join("\n");

/** Отдельное сообщение с меню, когда основной ответ уже занят инлайн-кнопками. */
export const MENU_HINT = "Расписание, твои записи и поддержка — в кнопках внизу.";

export const SUPPORT_TEXT = "Напиши нам — ответит живой человек, не бот.";

export const NO_EVENTS_TEXT =
  "Новое расписание появится скоро. Анонсы первыми приходят в чат сообщества";

export const NO_UPCOMING_SIGNUPS_TEXT = "Впереди записей нет.";

export function menuKeyboard(): Keyboard {
  return new Keyboard().text(MENU_SCHEDULE).text(MENU_MY_SIGNUPS).row().text(MENU_SUPPORT).resized().persistent();
}

// ── Строки событий ───────────────────────────────────────────────────────────

function formatIcon(format: string): string {
  if (format === "coffeerun") return "🏃";
  if (format === "pilates") return "🧘";
  if (format === "bookclub") return "📚";
  return "•";
}

/** Короткое имя для кнопок: «кофе-ран», «пилатес», «книжный клуб». */
function shortName(event: LandingEvent): string {
  if (event.format === "coffeerun") return "кофе-ран";
  if (event.format === "pilates") return "пилатес";
  if (event.format === "bookclub") return "книжный клуб";
  return event.title.toLowerCase();
}

function eventTitle(event: LandingEvent): string {
  return event.kind === "coffeerun" ? `Кофе-ран · ${event.title}` : event.title;
}

/** «15 ноября, вс, сбор 12:00, старт 12:30» — из тех же полей, что лендинг. */
export function eventWhen(event: LandingEvent): string {
  const v = placeholderValues(event);
  return `${v.date_label}, ${v.weekday_short.toLowerCase()}, сбор ${v.gather_time}, старт ${v.start_time}`;
}

/** Место: у забега — адрес и спот, у клуба — место и метро. */
export function eventWhere(event: LandingEvent): string {
  if (event.kind === "coffeerun") return `${placeholderValues(event).address_short}, ${event.place}`;
  return event.metro ? `${event.place}, ${event.metro}` : event.place;
}

function eventKey(event: Pick<LandingEvent, "kind" | "date" | "startTime" | "landing">): string {
  return `${event.kind}|${event.landing}|${event.date}|${event.startTime}`;
}

/** Ключ занятия клуба для «мест нет». */
export function soldOutKey(event: LandingEvent): string {
  return eventKey(event);
}

function signupUrl(origin: string, event: LandingEvent): string {
  return `${origin}${event.path}?utm_source=bot&utm_medium=menu`;
}

// ── 📅 Расписание ────────────────────────────────────────────────────────────

export interface ScreenView {
  text: string;
  keyboard: InlineKeyboard;
}

/**
 * Экран расписания. Чистая функция: события, распроданные занятия и origin
 * сайта приходят снаружи. Без origin кнопок записи нет (сайт неизвестен).
 */
export function scheduleView(
  events: readonly LandingEvent[],
  soldOut: ReadonlySet<string>,
  origin: string | null,
): ScreenView {
  const shown = events.slice(0, SCHEDULE_LIMIT);
  if (shown.length === 0) {
    return { text: NO_EVENTS_TEXT, keyboard: new InlineKeyboard().url("Чат сообщества", COMMUNITY_URL) };
  }

  const blocks = shown.map((event) => {
    const lines = [`${formatIcon(event.format)} ${eventTitle(event)}`, eventWhen(event), eventWhere(event)];
    if (event.kind === "club") {
      if (soldOut.has(soldOutKey(event))) lines.push("мест нет, можно в лист ожидания");
      else lines.push(event.priceRub ? `${event.priceRub} ₽` : "бесплатно");
    }
    return lines.join("\n");
  });

  const keyboard = new InlineKeyboard();
  if (origin) {
    shown.forEach((event, i) => {
      if (i > 0) keyboard.row();
      keyboard.url(`Записаться: ${shortName(event)}, ${event.dateLabel}`, signupUrl(origin, event));
    });
  }
  return { text: ["Ближайшие события:", "", blocks.join("\n\n")].join("\n"), keyboard };
}

// ── 🎟 Мои записи ────────────────────────────────────────────────────────────

interface Upcoming {
  event: LandingEvent;
  status?: string;
  button?: { kind: "url"; label: string; url: string } | { kind: "callback"; label: string; data: string };
}

function routeButton(event: LandingEvent): Upcoming["button"] {
  return { kind: "url", label: `Маршрут: ${shortName(event)}, ${event.dateLabel}`, url: event.mapUrl };
}

/** Подтверждённые заявки на будущие забеги, по одной на забег. */
function upcomingCoffee(rows: readonly MyCoffeeRunRow[], today: string, now: Date): Upcoming[] {
  const seen = new Set<string>();
  const out: Upcoming[] = [];
  for (const row of rows) {
    if (!row.confirmed_at || !row.run_date || row.run_date < today) continue;
    const run =
      COFFEE_RUNS.find((r) => r.spot === row.spot && r.date === row.run_date) ?? runForSignup(row, now);
    const key = `${run.spot}|${run.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const event = fromRun(run);
    out.push({ event, button: routeButton(event) });
  }
  return out;
}

/**
 * Заказы на будущие занятия клубов. Несколько оплаченных заказов на одно
 * занятие (докупка) — одна строка с общим числом билетов. Подарок — своей
 * строкой. Лист ожидания показываем, только если на это занятие нет оплаты.
 */
function upcomingClub(rows: readonly MyClubRow[], today: string, now: Date): Upcoming[] {
  type Group = { event: LandingEvent; paid: number; free: boolean; gifts: number[]; pay: MyClubRow[]; waitlist: boolean };
  const groups = new Map<string, Group>();
  for (const row of rows) {
    if (row.event_date < today) continue;
    const session = sessionOfSignup(row);
    if (!session) continue;
    const key = `${row.club}|${row.event_date}|${row.event_time}`;
    const g =
      groups.get(key) ??
      { event: fromSession(session), paid: 0, free: isFreeSession(session), gifts: [], pay: [], waitlist: false };
    groups.set(key, g);
    const quantity = row.quantity ?? 1;
    if (row.payment_status === "paid") {
      if (row.is_gift) g.gifts.push(quantity);
      else g.paid += quantity;
    } else if (row.payment_status === "pending_payment" && isHoldActive(row as Parameters<typeof isHoldActive>[0], now)) {
      g.pay.push(row);
    } else if (row.payment_status === "waitlist") {
      g.waitlist = true;
    }
  }

  const out: Upcoming[] = [];
  for (const g of groups.values()) {
    if (g.paid > 0) {
      const status = g.free ? "записан" : "оплачено";
      out.push({ event: g.event, status: g.paid > 1 ? `${status}, ${ticketLabel(g.paid)}` : status, button: routeButton(g.event) });
    }
    for (const q of g.gifts) out.push({ event: g.event, status: `оплачено, подарок: ${ticketLabel(q)}` });
    for (const row of g.pay) {
      const label = `Оплатить: ${shortName(g.event)}, ${g.event.dateLabel}`;
      out.push({
        event: g.event,
        status: "ждёт оплаты",
        // Ссылка ЮKassa текущей попытки, а без неё — «Проверить ещё раз»
        // (stpay:): тот же путь, что /start st_<token>, он сам выдаст ссылку.
        button: row.yk_confirmation_url
          ? { kind: "url", label, url: row.yk_confirmation_url }
          : { kind: "callback", label, data: `stpay:${row.confirm_token}` },
      });
    }
    if (g.waitlist && g.paid === 0 && g.pay.length === 0) out.push({ event: g.event, status: "в листе ожидания" });
  }
  return out;
}

function minutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export interface MySignupsInput {
  coffee: readonly MyCoffeeRunRow[];
  club: readonly MyClubRow[];
  rollcallDates: ReadonlySet<string>;
  now: Date;
}

/** Экран «Мои записи». Чистая функция от строк базы. */
export function mySignupsView(input: MySignupsInput): ScreenView {
  const today = moscowToday(input.now);
  const upcoming = [...upcomingCoffee(input.coffee, today, input.now), ...upcomingClub(input.club, today, input.now)].sort(
    (a, b) => a.event.date.localeCompare(b.event.date) || minutes(a.event.startTime) - minutes(b.event.startTime),
  );
  const counter = attendanceLine(countAttendance(input.coffee, input.club, today, input.rollcallDates));
  const keyboard = new InlineKeyboard();

  if (upcoming.length === 0) {
    keyboard.text(MENU_SCHEDULE, MENU_SCHEDULE_CALLBACK);
    return { text: [NO_UPCOMING_SIGNUPS_TEXT, ...(counter ? ["", counter] : [])].join("\n"), keyboard };
  }

  const blocks = upcoming.map(({ event, status }) =>
    [
      `${formatIcon(event.format)} ${eventTitle(event)}${status ? ` — ${status}` : ""}`,
      eventWhen(event),
      eventWhere(event),
    ].join("\n"),
  );
  let first = true;
  for (const { button } of upcoming) {
    if (!button) continue;
    if (!first) keyboard.row();
    first = false;
    if (button.kind === "url") keyboard.url(button.label, button.url);
    else keyboard.text(button.label, button.data);
  }
  return { text: ["Впереди:", "", blocks.join("\n\n"), ...(counter ? ["", counter] : [])].join("\n"), keyboard };
}

// ── Хендлеры ─────────────────────────────────────────────────────────────────

export interface MenuDeps {
  db?: () => SupabaseClient;
  now?: () => Date;
  origin?: () => string | null;
}

/** Распроданные занятия среди событий. Ошибка базы — считаем, что места есть. */
async function soldOutSet(events: readonly LandingEvent[], db: () => SupabaseClient): Promise<Set<string>> {
  const out = new Set<string>();
  for (const event of events) {
    if (event.kind !== "club" || !event.session) continue;
    try {
      if (isSoldOut(await countTakenSeats(db(), event.session), event.session)) out.add(soldOutKey(event));
    } catch (err) {
      console.error("[menu] места:", err instanceof Error ? err.message : err);
    }
  }
  return out;
}

export async function handleScheduleMenu(ctx: BotContext, deps: MenuDeps = {}): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const events = upcomingEvents(now).slice(0, SCHEDULE_LIMIT);
  const soldOut = await soldOutSet(events, deps.db ?? tgAdmin);
  const view = scheduleView(events, soldOut, (deps.origin ?? publicOriginFromEnv)());
  await ctx.reply(view.text, { reply_markup: view.keyboard, link_preview_options: { is_disabled: true } });
}

export async function handleMySignupsMenu(ctx: BotContext, deps: MenuDeps = {}): Promise<void> {
  const chatId = ctx.from?.id;
  if (chatId === undefined) return;
  const now = deps.now?.() ?? new Date();
  const who = { chatId, username: normalizeTelegramUsername(ctx.from?.username ?? null) };

  let coffee: MyCoffeeRunRow[] = [];
  let club: MyClubRow[] = [];
  let rollcall = new Set<string>();
  try {
    const db = (deps.db ?? tgAdmin)();
    [coffee, club] = await Promise.all([myCoffeeRuns(db, who), myClubSignups(db, who)]);
    rollcall = await rollcallDates(db, datesNeedingRollcallCheck(coffee, moscowToday(now)));
  } catch (err) {
    console.error("[menu] мои записи:", err instanceof Error ? err.message : err);
  }

  const view = mySignupsView({ coffee, club, rollcallDates: rollcall, now });
  await ctx.reply(view.text, { reply_markup: view.keyboard, link_preview_options: { is_disabled: true } });
}

export async function handleSupportMenu(ctx: BotContext): Promise<void> {
  await ctx.reply(SUPPORT_TEXT, { reply_markup: new InlineKeyboard().url(SUPPORT_LABEL, SUPPORT_URL) });
}

/** Инлайн «📅 Расписание» из пустых «Моих записей». */
export async function handleScheduleCallback(ctx: BotContext, deps: MenuDeps = {}): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  await handleScheduleMenu(ctx, deps);
}

/** Сообщение-носитель клавиатуры меню после ответа с инлайн-кнопками. */
export async function sendMenuHint(ctx: BotContext): Promise<void> {
  await ctx.reply(MENU_HINT, { reply_markup: menuKeyboard() }).catch((err) => {
    console.error("[menu] клавиатура:", err instanceof Error ? err.message : err);
  });
}
