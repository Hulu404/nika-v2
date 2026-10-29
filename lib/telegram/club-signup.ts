import { Api, InlineKeyboard } from "grammy";
import { supabaseClubOrders, type ClubOrder } from "../clubs/orders";
import { CLUB_START_PREFIX, isHoldActive, refreshOrder, startPayment, type PaymentDeps } from "../clubs/payments";
export { CLUB_START_PREFIX };
import { yookassaFromEnv } from "../yookassa";
import { tgAdmin } from "./supabase";
import { countPaidSeats, hasEnoughSeats, isSoldOut } from "../clubs/seats";
import { moscowToday, SESSIONS, sessionOfSignup, type ClubSession } from "../clubs/sessions";
import { normalizeTelegramUsername } from "../coffeerun/telegram-username";
import { publicOriginFromEnv } from "../public-origin";
import { SUPPORT_LABEL, SUPPORT_URL } from "./cta";
import type { BotContext } from "./bot";

/**
 * Заказ на занятие клуба (/stretch) в боте мероприятий.
 *
 * Оплата — на сайте, через API ЮKassa (lib/clubs/payments.ts): форма → холд
 * мест на 20 минут → платёж → /paid?o=<token> → вебхук ЮKassa. Бот по
 * /start st_<token> находит заказ, привязывает чат и отвечает по статусу:
 * оплачено — «всё супер, приходи»; ждёт оплаты — сверяет с ЮKassa и даёт
 * «Проверить ещё раз»; отменён или холд истёк — новая ссылка на оплату (если
 * места есть).
 *
 * Счёт Telegram Payments бот больше не выставляет. pre_checkout_query и
 * successful_payment остались как фоллбэк: счета, отправленные до перехода на
 * ЮKassa, можно оплатить, деньги не потеряются. Заказ, по которому создан
 * платёж ЮKassa, старый счёт уже не примет (checkoutRefusal: статус не pending).
 */
const PAYLOAD_PREFIX = "club:";
const TABLE = "club_signups";
const COLUMNS =
  "id, name, email, tg_username, club, event_date, event_time, amount_rub, payment_status, confirmed_at, quantity, is_gift, gift_recipient";

export interface ClubSignup {
  id: string;
  name: string;
  email: string;
  tg_username: string;
  club: string;
  event_date: string;
  event_time: string;
  amount_rub: number;
  payment_status: ClubOrder["payment_status"];
  confirmed_at: string | null;
  quantity: number;
  is_gift: boolean;
  gift_recipient: string | null;
}

type TicketDetails = Partial<Pick<ClubSignup, "quantity" | "is_gift" | "gift_recipient">>;

export function ticketLabel(quantity: number): string {
  const last = quantity % 10, lastTwo = quantity % 100;
  return `${quantity} ${last === 1 && lastTwo !== 11 ? "билет" : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? "билета" : "билетов"}`;
}

// ── Чистые функции (покрыты тестами) ────────────────────────────────────────

/** Токен из payload `/start st_<token>`; null, если payload не наш. */
export function parseClubToken(payload: string): string | null {
  const trimmed = payload.trim();
  if (!trimmed.startsWith(CLUB_START_PREFIX)) return null;
  const token = trimmed.slice(CLUB_START_PREFIX.length);
  return /^[a-f0-9]{16,64}$/i.test(token) ? token : null;
}

export function invoicePayload(signupId: string): string {
  return `${PAYLOAD_PREFIX}${signupId}`;
}

/** id заявки из invoice_payload; null — счёт не наш (или чужой формат). */
export function parseInvoicePayload(payload: string): string | null {
  if (!payload.startsWith(PAYLOAD_PREFIX)) return null;
  const id = payload.slice(PAYLOAD_PREFIX.length);
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/**
 * Можно ли списывать деньги. Возвращает текст отказа для человека или null.
 * Отказ здесь — последний шанс не взять деньги за то, чего не будет.
 */
export const SOLD_OUT_REFUSAL =
  "Все коврики только что выкупили. Ты в листе ожидания следующего занятия — деньги не списаны.";

export function checkoutRefusal(
  signup: Pick<ClubSignup, "payment_status" | "amount_rub" | "event_date"> | null,
  query: { currency: string; total_amount: number },
  today: string,
  soldOut = false,
): string | null {
  if (!signup) return "Не нашла заявку. Заполни форму на странице занятия ещё раз.";
  if (signup.payment_status === "paid") return "Это занятие уже оплачено, коврик твой.";
  if (signup.payment_status === "waitlist") return SOLD_OUT_REFUSAL;
  if (signup.payment_status !== "pending") return "Заявка закрыта. Напиши в поддержку.";
  if (signup.event_date < today) return "Занятие уже прошло.";
  if (soldOut) return SOLD_OUT_REFUSAL;
  if (query.currency !== "RUB" || query.total_amount !== signup.amount_rub * 100) {
    return "Сумма счёта устарела. Открой ссылку со страницы занятия заново.";
  }
  return null;
}

function whenWhere(session: ClubSession): string {
  return `${session.dateLabel} (${session.weekday}), ${session.time}, ${session.place}, ${session.metro}`;
}

/** Ответ после оплаты и на повторный вход оплатившего. */
export function paidText(signup: Pick<ClubSignup, "name"> & TicketDetails, session: ClubSession): string {
  return [
    signup.is_gift
      ? `${signup.name}, подарок оплачен: ${ticketLabel(signup.quantity ?? 1)}! Получатель: ${signup.gift_recipient}. Перешли получателю следующее сообщение — это подарочный билет.`
      : (signup.quantity ?? 1) > 1
        ? `${signup.name}, оплата прошла: ${ticketLabel(signup.quantity!)}. Места для вашей компании закреплены! На входе назовите имя покупателя: ${signup.name}.`
        : `${signup.name}, всё супер, заявка оплачена, приходи!`,
    "",
    `${session.title}: ${whenWhere(session)}.`,
    `Приходи к ${session.gatherAt}, чтобы спокойно переодеться. С собой — удобная одежда и носки.`,
    "",
    "Есть травмы или ограничения по здоровью — расскажи тренеру до начала.",
  ].join("\n");
}

/** Отдельное сообщение без цены и контактов покупателя — можно переслать. */
export function giftTicketText(signup: Pick<ClubSignup, "id"> & TicketDetails, session: ClubSession): string {
  return [
    `${signup.gift_recipient}, тебе подарили занятие в NIKA!`,
    `${ticketLabel(signup.quantity ?? 1)} · ${session.title}`,
    whenWhere(session),
    `Сбор с ${session.gatherAt}. С собой — удобная одежда и носки.`,
    "Покажи это сообщение на входе. Один билет — один участник от 18 лет.",
    `Номер заказа: ${signup.id}`,
  ].join("\n\n");
}

/** Места кончились: человек в листе ожидания следующего занятия клуба. */
export function waitlistText(signup: Pick<ClubSignup, "name">, session: ClubSession): string {
  return [
    `${signup.name}, все коврики на ${session.dateLabel} уже выкуплены.`,
    "",
    "Ты в листе ожидания следующего занятия клуба: как только откроем запись, напишу сюда первой.",
  ].join("\n");
}

// ── Работа с базой ──────────────────────────────────────────────────────────

/** pending → waitlist. Только из pending: оплаченную заявку не трогаем. */
async function moveToWaitlist(id: string): Promise<void> {
  const { error } = await tgAdmin()
    .from(TABLE)
    .update({ payment_status: "waitlist", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("payment_status", "pending");
  if (error) console.error("[club] moveToWaitlist:", error.message);
}

async function findBy(column: "confirm_token" | "id", value: string): Promise<ClubSignup | null> {
  const { data, error } = await tgAdmin().from(TABLE).select(COLUMNS).eq(column, value).maybeSingle();
  if (error) {
    console.error(`[club] find by ${column}:`, error.message);
    return null;
  }
  return (data as ClubSignup | null) ?? null;
}

/** Неоплаченный заказ по нику на любое будущее занятие (для /start без токена). */
async function findPendingByUsername(username: string): Promise<ClubSignup | null> {
  const today = moscowToday();
  const dates = SESSIONS.filter((s) => s.date >= today).map((s) => s.date);
  if (dates.length === 0) return null;
  const { data, error } = await tgAdmin()
    .from(TABLE)
    .select(COLUMNS)
    .eq("tg_username", username)
    .in("payment_status", ["pending", "pending_payment", "canceled", "expired"])
    .in("event_date", dates)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[club] findPendingByUsername:", error.message);
    return null;
  }
  return ((data as ClubSignup[] | null) ?? [])[0] ?? null;
}

/**
 * Отмечает вход в бота. Количество, получатель и сумма заказа неизменны.
 */
async function markOpened(
  signup: ClubSignup,
  chatId: number,
  actual: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = { tg_chat_id: chatId, updated_at: new Date().toISOString() };
  if (!signup.confirmed_at) patch.confirmed_at = new Date().toISOString();
  if (actual) patch.tg_username = actual;
  // Сумма заказа фиксируется при оформлении и не меняется у старого счёта.
  const { error } = await tgAdmin().from(TABLE).update(patch).eq("id", signup.id);
  if (error) console.error("[club] markOpened:", error.message);
}

// ── Клавиатуры ──────────────────────────────────────────────────────────────

function sessionKeyboard(session: ClubSession): InlineKeyboard {
  return new InlineKeyboard()
    .url("Как добраться", session.mapUrl)
    .row()
    .url(SUPPORT_LABEL, SUPPORT_URL);
}

/** Дополнительный заказ оформляется на сайте с новым ключом, старый счёт неизменен. */
function paidKeyboard(session: ClubSession): InlineKeyboard {
  const keyboard = sessionKeyboard(session);
  const site = publicOriginFromEnv();
  if (site && session.date >= moscowToday()) {
    keyboard.row().url("Докупить билеты", `${site}${session.landing}?purchase=more#reg`);
  }
  return keyboard;
}

function landingKeyboard(): InlineKeyboard | undefined {
  const site = publicOriginFromEnv();
  const today = moscowToday();
  const next = SESSIONS.find((s) => s.date >= today);
  return site && next ? new InlineKeyboard().url("Страница занятия", `${site}${next.landing}`) : undefined;
}

// ── Хендлеры ────────────────────────────────────────────────────────────────

/** Callback «Проверить ещё раз»: stpay:<token>. */
export const CLUB_CHECK_CALLBACK_RE = /^stpay:([a-f0-9]{16,64})$/i;

export function clubPaymentDeps(): PaymentDeps {
  return { orders: supabaseClubOrders(tgAdmin()), yk: yookassaFromEnv(), origin: publicOriginFromEnv(), notify: notifyClubOrder };
}

export function waitingText(order: Pick<ClubOrder, "name">): string {
  return [
    `${order.name}, ждём подтверждения оплаты от ЮKassa — обычно это минута.`,
    "Если оплата ещё не прошла, нажми «Оплатить». Когда оплатишь, нажми «Проверить ещё раз».",
  ].join("\n");
}

export function payLinkText(order: Pick<ClubOrder, "name" | "quantity" | "amount_rub" | "is_gift">, session: ClubSession): string {
  return [
    `${order.name}, ссылка на оплату готова: ${ticketLabel(order.quantity)}${order.is_gift ? " в подарок" : ""}, ${order.amount_rub} ₽.`,
    `${session.title}: ${whenWhere(session)}.`,
    "",
    "Места держим 20 минут. После оплаты вернись сюда — пришлю подтверждение.",
  ].join("\n");
}

export const NO_SEATS_TEXT = "Мест на это занятие не осталось. Если освободятся, напишу сюда первой.";
export const OVERBOOKED_TEXT =
  "Пока шла оплата, последние места выкупили. Деньги вернули автоматически — они придут на карту в течение нескольких дней. Прости, что так вышло.";

function checkKeyboard(order: Pick<ClubOrder, "confirm_token" | "yk_confirmation_url">): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (order.yk_confirmation_url) kb.url("Оплатить", order.yk_confirmation_url).row();
  return kb.text("Проверить ещё раз", `stpay:${order.confirm_token}`).row().url(SUPPORT_LABEL, SUPPORT_URL);
}

async function replyPaid(ctx: BotContext, order: ClubOrder, session: ClubSession): Promise<void> {
  await ctx.reply(paidText(order, session), { reply_markup: paidKeyboard(session) });
  if (order.is_gift) await ctx.reply(giftTicketText(order, session), { reply_markup: sessionKeyboard(session) });
}

/**
 * Заказ по ссылке из бота или с /paid: привязать чат, сверить оплату с ЮKassa
 * и ответить по статусу.
 */
export async function openClubOrder(ctx: BotContext, input: ClubOrder, deps: PaymentDeps = clubPaymentDeps()): Promise<void> {
  const chatId = ctx.from?.id;
  const session = sessionOfSignup(input);
  if (!session) {
    console.error(`[club] заказ ${input.id}: занятие ${input.club} ${input.event_date} нет в SESSIONS`);
    await ctx.reply("Не нашла это занятие в расписании. Напиши, пожалуйста, в поддержку.", {
      reply_markup: new InlineKeyboard().url(SUPPORT_LABEL, SUPPORT_URL),
    });
    return;
  }
  if (chatId !== undefined) {
    await deps.orders.bindChat(input.id, chatId, normalizeTelegramUsername(ctx.from?.username ?? null)).catch((err) =>
      console.error("[club] bindChat:", err instanceof Error ? err.message : String(err)));
  }
  const order = await refreshOrder(deps, input);
  const now = deps.now?.() ?? new Date();

  if (order.payment_status === "paid") return replyPaid(ctx, order, session);
  if (order.payment_status === "refunded_overbooked") {
    await ctx.reply(OVERBOOKED_TEXT, { reply_markup: landingKeyboard() });
    return;
  }
  if (order.payment_status === "refunded") {
    await ctx.reply("Этот заказ отменён, деньги вернули. Если что-то не так — напиши в поддержку.", { reply_markup: sessionKeyboard(session) });
    return;
  }
  if (order.payment_status === "waitlist") {
    await ctx.reply(waitlistText(order, session));
    return;
  }
  if (session.date < moscowToday(now)) {
    await ctx.reply("Это занятие уже прошло. Следующее появится на странице клуба.", { reply_markup: landingKeyboard() });
    return;
  }
  if (isHoldActive(order, now) && order.yk_payment_id) {
    await ctx.reply(waitingText(order), { reply_markup: checkKeyboard(order) });
    return;
  }

  // Не оплачен: отменён, холд истёк или старая форма без платежа — новая ссылка, если места есть.
  const res = await startPayment(deps, order, session);
  if (res.kind === "paid") return replyPaid(ctx, res.order, session);
  if (res.kind === "redirect") {
    await ctx.reply(payLinkText(res.order, session), { reply_markup: checkKeyboard({ ...res.order, yk_confirmation_url: res.url }) });
    return;
  }
  if (res.kind === "no_seats") {
    await ctx.reply(NO_SEATS_TEXT, { reply_markup: landingKeyboard() });
    return;
  }
  console.error(`[club] новая ссылка на оплату (заказ ${order.id}) не получилась: ${res.kind === "closed" || res.kind === "unavailable" ? res.reason : ""}`);
  await ctx.reply("Не получилось подготовить оплату. Напиши в поддержку — поможем.", {
    reply_markup: new InlineKeyboard().url(SUPPORT_LABEL, SUPPORT_URL),
  });
}

/** /start st_<token> с сайта (/paid или форма). */
export async function handleClubStart(ctx: BotContext, payload: string, deps: PaymentDeps = clubPaymentDeps()): Promise<void> {
  if (ctx.from?.id === undefined) return;
  const token = parseClubToken(payload);
  const order = token ? await deps.orders.byToken(token).catch(() => null) : null;
  if (!order) {
    await ctx.reply(
      "Не нашла заказ по этой ссылке — возможно, она устарела. Оформить запись можно на странице занятия.",
      { reply_markup: landingKeyboard() },
    );
    return;
  }
  await openClubOrder(ctx, order, deps);
}

/** «Проверить ещё раз»: тот же ответ, что на вход по ссылке. */
export async function handleClubCheck(ctx: BotContext, deps: PaymentDeps = clubPaymentDeps()): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  const token = CLUB_CHECK_CALLBACK_RE.exec(ctx.callbackQuery?.data ?? "")?.[1];
  const order = token ? await deps.orders.byToken(token).catch(() => null) : null;
  if (!order) {
    await ctx.reply("Не нашла этот заказ. Оформить запись можно на странице занятия.", { reply_markup: landingKeyboard() });
    return;
  }
  await openClubOrder(ctx, order, deps);
}

/** Сообщение в чат заказа после вебхука ЮKassa (если человек уже открывал бота). */
export async function notifyClubOrder(order: ClubOrder, event: "paid" | "refunded_overbooked"): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN;
  const session = sessionOfSignup(order);
  if (!order.tg_chat_id || !token || !session) return;
  const api = new Api(token);
  if (event === "refunded_overbooked") {
    await api.sendMessage(order.tg_chat_id, OVERBOOKED_TEXT);
    return;
  }
  await api.sendMessage(order.tg_chat_id, paidText(order, session), { reply_markup: paidKeyboard(session) });
  if (order.is_gift) await api.sendMessage(order.tg_chat_id, giftTicketText(order, session), { reply_markup: sessionKeyboard(session) });
}

/** /start без токена: неоплаченная заявка по нику. true — нашлась и обработана. */
export async function handleClubByUsername(ctx: BotContext): Promise<boolean> {
  const chatId = ctx.from?.id;
  const username = normalizeTelegramUsername(ctx.from?.username ?? null);
  if (chatId === undefined || !username) return false;
  const signup = await findPendingByUsername(username);
  if (!signup) return false;
  const order = await supabaseClubOrders(tgAdmin()).byId(signup.id).catch(() => null);
  if (!order) return false;
  await openClubOrder(ctx, order);
  return true;
}

/** pre_checkout_query: последняя проверка перед списанием. */
export async function handleClubPreCheckout(ctx: BotContext): Promise<void> {
  const q = ctx.preCheckoutQuery;
  if (!q) return;
  const id = parseInvoicePayload(q.invoice_payload);
  // Чужой счёт (не наш формат) — не держим человека, честно отказываем.
  const signup = id ? await findBy("id", id) : null;
  const session = signup ? sessionOfSignup(signup) : null;
  const refusal = checkoutRefusal(signup, q, moscowToday());
  if (refusal) {
    console.error(`[club] pre_checkout отказ (${q.invoice_payload}): ${refusal}`);
    await ctx.answerPreCheckoutQuery(false, { error_message: refusal });
    return;
  }
  if (!signup || !session) {
    await ctx.answerPreCheckoutQuery(false, { error_message: "Не нашла занятие. Напиши в поддержку." });
    return;
  }
  const { data: reserved, error } = await tgAdmin().rpc("reserve_club_tickets", {
    signup_id: signup.id, expected_amount: q.total_amount, session_capacity: session.capacity,
  });
  if (error || reserved !== true) {
    if (error) console.error("[club] reserve tickets:", error.message);
    await ctx.answerPreCheckoutQuery(false, { error_message: "Не удалось зарезервировать билеты: мест не хватает или этот заказ уже оплачивается. Деньги не списаны. Попробуй позже или напиши в поддержку." });
    return;
  }
  await ctx.answerPreCheckoutQuery(true);
}

/**
 * message.successful_payment: деньги списаны. Учитываем и waitlist: статус мог
 * измениться, пока платёж шёл. Повтор не перезаписывает первую отметку.
 * Возвращает true, если платёж наш.
 */
export async function handleClubPayment(ctx: BotContext): Promise<boolean> {
  const p = ctx.message?.successful_payment;
  if (!p) return false;
  const id = parseInvoicePayload(p.invoice_payload);
  if (!id) return false;
  if (p.currency !== "RUB") return false;

  const { data, error } = await tgAdmin()
    .from(TABLE)
    .update({
      payment_status: "paid",
      paid_at: new Date().toISOString(),
      tg_payment_charge_id: p.telegram_payment_charge_id,
      provider_payment_charge_id: p.provider_payment_charge_id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("amount_rub", p.total_amount / 100)
    .in("payment_status", ["pending", "waitlist"])
    .select(COLUMNS);
  if (error) {
    // Деньги уже у нас, а строка не обновилась — это надо разбирать руками.
    console.error(
      `[club] ОПЛАТА НЕ ЗАПИСАНА: заявка ${id}, charge ${p.telegram_payment_charge_id}, ` +
        `ЮKassa ${p.provider_payment_charge_id}:`,
      error.message,
    );
  }

  const signup = ((data as ClubSignup[] | null) ?? [])[0] ?? (await findBy("id", id));
  if (!data?.length && signup?.payment_status === "paid") {
    console.error(`[club] повторная оплата заявки ${id}: charge ${p.telegram_payment_charge_id}`);
  }
  const session = signup ? sessionOfSignup(signup) : null;
  if (signup && session && signup.payment_status === "paid") {
    await ctx.reply(paidText(signup, session), { reply_markup: paidKeyboard(session) });
    if (signup.is_gift) await ctx.reply(giftTicketText(signup, session), { reply_markup: sessionKeyboard(session) });
  } else {
    await ctx.reply("Платёж получен, но не удалось подтвердить билеты. Напиши в поддержку — проверим оплату и запись.", {
      reply_markup: new InlineKeyboard().url(SUPPORT_LABEL, SUPPORT_URL),
    });
  }
  return true;
}
