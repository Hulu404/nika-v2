import { InlineKeyboard } from "grammy";
import { tgAdmin } from "./supabase";
import { countPaidSeats, hasEnoughSeats, isSoldOut } from "../clubs/seats";
import { moscowToday, SESSIONS, sessionOfSignup, type ClubSession } from "../clubs/sessions";
import { normalizeTelegramUsername } from "../coffeerun/telegram-username";
import { publicOriginFromEnv } from "../public-origin";
import { SUPPORT_LABEL, SUPPORT_URL } from "./cta";
import type { BotContext } from "./bot";

/**
 * Запись на занятие клуба (/stretch) и её оплата в боте мероприятий.
 *
 * Заявка приходит с лендинга (POST /api/club-signup) со статусом pending.
 * Кнопка «Оплатить в Telegram» ведёт на t.me/<bot>?start=st_<token>; бот
 * находит заявку и присылает счёт ЮKassa (Telegram Payments, sendInvoice).
 *
 * Оплата в три шага Telegram:
 *   1) sendInvoice — счёт с payload `club:<id заявки>`;
 *   2) pre_checkout_query — последняя проверка до списания (заявка есть, ещё не
 *      оплачена, сумма совпадает, занятие не прошло). Ответить надо за 10 секунд;
 *   3) message.successful_payment — деньги списаны: payment_status = 'paid'.
 *
 * Источник истины об оплате — successful_payment, а не нажатие кнопки.
 * Повтор апдейта не страшен: строка обновляется только из pending.
 */
export const CLUB_START_PREFIX = "st_";
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
  payment_status: "pending" | "paid" | "refunded" | "waitlist";
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

/**
 * Чек 54-ФЗ для ЮKassa: provider_data счёта. Почту берём из заявки — она там
 * обязательна, отдельно Telegram её не спрашивает.
 * YOOKASSA_RECEIPT=0 отключает чек (магазин без фискализации).
 */
export function receiptProviderData(
  signup: Pick<ClubSignup, "email" | "amount_rub"> & TicketDetails,
  session: ClubSession,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (env.YOOKASSA_RECEIPT === "0") return undefined;
  const taxSystem = Number(env.YOOKASSA_TAX_SYSTEM_CODE);
  return JSON.stringify({
    receipt: {
      customer: { email: signup.email },
      items: [
        {
          description: `${session.title}, ${session.dateLabel} ${session.time}`.slice(0, 128),
          quantity: (signup.quantity ?? 1).toFixed(2),
          amount: { value: (signup.amount_rub / (signup.quantity ?? 1)).toFixed(2), currency: "RUB" },
          vat_code: Number(env.YOOKASSA_VAT_CODE ?? 1), // 1 — без НДС
          payment_mode: "full_payment",
          payment_subject: "service",
        },
      ],
      ...(Number.isInteger(taxSystem) && taxSystem > 0 ? { tax_system_code: taxSystem } : {}),
    },
  });
}

function whenWhere(session: ClubSession): string {
  return `${session.dateLabel} (${session.weekday}), ${session.time}, ${session.place}, ${session.metro}`;
}

/** Сообщение перед счётом: что именно человек оплачивает. */
export function invoiceIntroText(signup: Pick<ClubSignup, "name"> & TicketDetails, session: ClubSession): string {
  return [
    `${signup.name}, заявка на занятие найдена.`,
    `${ticketLabel(signup.quantity ?? 1)}${signup.is_gift ? ` в подарок. Получатель: ${signup.gift_recipient}` : ""}.`,
    "",
    `${session.title}: ${whenWhere(session)}.`,
    `Сбор с ${session.gatherAt}.`,
    "",
    "Количество мест ограничено, коврик закрепляется после оплаты. Счёт ниже.",
  ].join("\n");
}

/** Ответ после оплаты и на повторный вход оплатившего. */
export function paidText(signup: Pick<ClubSignup, "name"> & TicketDetails, session: ClubSession): string {
  return [
    signup.is_gift
      ? `${signup.name}, подарок оплачен: ${ticketLabel(signup.quantity ?? 1)}! Получатель: ${signup.gift_recipient}. Перешли получателю следующее сообщение — это подарочный билет.`
      : (signup.quantity ?? 1) > 1
        ? `${signup.name}, оплата прошла: ${ticketLabel(signup.quantity!)}. Места для вашей компании закреплены! На входе назовите имя покупателя: ${signup.name}.`
        : `${signup.name}, оплата прошла, коврик твой!`,
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

/** Неоплаченная заявка по нику на любое будущее занятие (для /start без токена). */
async function findPendingByUsername(username: string): Promise<ClubSignup | null> {
  const today = moscowToday();
  const dates = SESSIONS.filter((s) => s.date >= today).map((s) => s.date);
  if (dates.length === 0) return null;
  const { data, error } = await tgAdmin()
    .from(TABLE)
    .select(COLUMNS)
    .eq("tg_username", username)
    .eq("payment_status", "pending")
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

function landingKeyboard(): InlineKeyboard | undefined {
  const site = publicOriginFromEnv();
  const today = moscowToday();
  const next = SESSIONS.find((s) => s.date >= today);
  return site && next ? new InlineKeyboard().url("Страница занятия", `${site}${next.landing}`) : undefined;
}

// ── Хендлеры ────────────────────────────────────────────────────────────────

/** Общий хвост: отметить вход и прислать счёт (или «уже оплачено»). */
async function openSignup(ctx: BotContext, signup: ClubSignup, chatId: number): Promise<void> {
  const session = sessionOfSignup(signup);
  if (!session) {
    console.error(`[club] заявка ${signup.id}: занятие ${signup.club} ${signup.event_date} нет в SESSIONS`);
    await ctx.reply("Не нашла это занятие в расписании. Напиши, пожалуйста, в поддержку.", {
      reply_markup: new InlineKeyboard().url(SUPPORT_LABEL, SUPPORT_URL),
    });
    return;
  }

  await markOpened(
    signup,
    chatId,
    normalizeTelegramUsername(ctx.from?.username ?? null),
  );

  if (signup.payment_status === "paid") {
    await ctx.reply(paidText(signup, session), { reply_markup: sessionKeyboard(session) });
    if (signup.is_gift) await ctx.reply(giftTicketText(signup, session), { reply_markup: sessionKeyboard(session) });
    return;
  }
  if (signup.event_date < moscowToday()) {
    await ctx.reply("Это занятие уже прошло. Следующее появится на странице клуба.", {
      reply_markup: landingKeyboard(),
    });
    return;
  }
  // Места кончились, пока заявка ждала оплаты, — счёт не выставляем.
  if (signup.payment_status === "pending") {
    const occupied = await countPaidSeats(tgAdmin(), session);
    if (isSoldOut(occupied, session)) {
      await moveToWaitlist(signup.id);
      signup.payment_status = "waitlist";
    } else if (!hasEnoughSeats(occupied, session, signup.quantity)) {
      await ctx.reply("Для всего заказа мест уже не хватает. Оформи меньше билетов на странице занятия или напиши в поддержку.", { reply_markup: landingKeyboard() });
      return;
    }
  }
  if (signup.payment_status === "waitlist") {
    await ctx.reply(waitlistText(signup, session));
    return;
  }
  if (signup.payment_status !== "pending") {
    await ctx.reply("Заявка закрыта. Напиши в поддержку.", { reply_markup: sessionKeyboard(session) });
    return;
  }

  const providerToken = process.env.TELEGRAM_PAYMENT_PROVIDER_TOKEN?.trim();
  if (!providerToken) {
    console.error("[club] TELEGRAM_PAYMENT_PROVIDER_TOKEN не задан — счёт не отправлен");
    await ctx.reply(
      `${invoiceIntroText(signup, session)}\n\nОплата откроется совсем скоро — я пришлю счёт сюда.`,
    );
    return;
  }

  await ctx.reply(invoiceIntroText(signup, session));
  try {
    await ctx.replyWithInvoice(
      session.title,
      `${session.dateLabel}, ${session.time} · ${session.place}`.slice(0, 255),
      invoicePayload(signup.id),
      "RUB",
      [{ label: `${ticketLabel(signup.quantity)}${signup.is_gift ? " в подарок" : ""}`, amount: signup.amount_rub * 100 }],
      {
        provider_token: providerToken,
        provider_data: receiptProviderData(signup, session),
      },
    );
  } catch (err) {
    // Частые причины: сумма ниже минимума Telegram (≈88 ₽, см. MIN_INVOICE_RUB),
    // неверный provider token. Человеку — честно, в лог — подробно.
    console.error(
      `[club] sendInvoice не прошёл (заявка ${signup.id}, ${signup.amount_rub} ₽):`,
      err instanceof Error ? err.message : String(err),
    );
    await ctx.reply("Не получилось выставить счёт. Мы уже разбираемся — напиши в поддержку, поможем.", {
      reply_markup: new InlineKeyboard().url(SUPPORT_LABEL, SUPPORT_URL),
    });
  }
}

/** /start st_<token> с лендинга. */
export async function handleClubStart(ctx: BotContext, payload: string): Promise<void> {
  const chatId = ctx.from?.id;
  if (chatId === undefined) return;
  const token = parseClubToken(payload);
  const signup = token ? await findBy("confirm_token", token) : null;
  if (!signup) {
    await ctx.reply(
      "Не нашла заявку по этой ссылке — возможно, она устарела. Заполни форму на странице занятия ещё раз.",
      { reply_markup: landingKeyboard() },
    );
    return;
  }
  await openSignup(ctx, signup, chatId);
}

/** /start без токена: неоплаченная заявка по нику. true — нашлась и обработана. */
export async function handleClubByUsername(ctx: BotContext): Promise<boolean> {
  const chatId = ctx.from?.id;
  const username = normalizeTelegramUsername(ctx.from?.username ?? null);
  if (chatId === undefined || !username) return false;
  const signup = await findPendingByUsername(username);
  if (!signup) return false;
  await openSignup(ctx, signup, chatId);
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
    await ctx.reply(paidText(signup, session), { reply_markup: sessionKeyboard(session) });
    if (signup.is_gift) await ctx.reply(giftTicketText(signup, session), { reply_markup: sessionKeyboard(session) });
  } else {
    await ctx.reply("Платёж получен, но не удалось подтвердить билеты. Напиши в поддержку — проверим оплату и запись.", {
      reply_markup: new InlineKeyboard().url(SUPPORT_LABEL, SUPPORT_URL),
    });
  }
  return true;
}
