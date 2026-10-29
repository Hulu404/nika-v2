import { normalizeTelegramUsername } from "../coffeerun/telegram-username";
import type { YooKassaApi } from "../yookassa";
import type { ClubOrder, ClubOrderStore } from "./orders";
import { botStartUrl, paidPageUrl, startPayment } from "./payments";
import { hasEnoughSeats, isSoldOut } from "./seats";
import { sessionForSignup, type ClubSession } from "./sessions";

/**
 * Заявка с лендинга занятия (/stretch) → сразу оплата ЮKassa.
 *
 * Строка ложится в club_signups, ставится холд мест на 20 минут, создаётся
 * платёж (redirect), ответ несёт redirectUrl — страница уводит туда человека.
 * После оплаты ЮKassa возвращает его на /paid?o=<token>.
 *
 * Повторная отправка той же формы (тот же request_token, или те же ник,
 * количество и подарок, пока холд жив) отдаёт тот же платёж, а не новый.
 * Все места заняты — заявка в лист ожидания, без оплаты.
 *
 * Цена и дата — из lib/clubs/sessions.ts, не из браузера.
 */

const LEVELS = ["first", "sometimes", "regular"] as const;
const MATS = ["own", "studio"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zа-я]{2,}$/i;

function mintToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function yesNo(v: unknown): boolean | null {
  if (v === "yes" || v === true) return true;
  if (v === "no" || v === false) return false;
  return null;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

export interface SignupDeps {
  orders: ClubOrderStore;
  yk: YooKassaApi | null;
  origin: string | null;
  botUsername?: string | null;
  /** Занятые места (оплаченные + активные холды); NaN/∞ — посчитать не смогли. */
  taken: (session: ClubSession) => Promise<number>;
  /** Заказ по ключу формы (request_token) — или старой формы по нику. */
  findByKey: (session: ClubSession, key: { token: string } | { username: string }) => Promise<ClubOrder | null>;
  /** Та же форма отправлена ещё раз: ждущий оплаты заказ с теми же данными и живым холдом. */
  findSamePending: (session: ClubSession, q: { username: string; quantity: number; isGift: boolean }) => Promise<ClubOrder | null>;
  /** Новая строка. duplicate — confirm_token уже есть (гонка двух повторов). */
  insert: (fields: Record<string, unknown>) => Promise<"ok" | "duplicate">;
  now?: () => Date;
}

export interface SignupResponse {
  status: number;
  body: Record<string, unknown>;
}

export async function handleSignup(raw: unknown, deps: SignupDeps): Promise<SignupResponse> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { status: 400, body: { error: "Invalid JSON" } };
  const body = raw as Record<string, unknown>;
  const clean = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
  const name = clean(body.name);
  const email = clean(body.email);
  const tgUsername = normalizeTelegramUsername(typeof body.telegram === "string" ? body.telegram : null);
  const level = oneOf(body.level, LEVELS);
  const mat = oneOf(body.mat, MATS);
  const towel = yesNo(body.towel);
  const water = yesNo(body.water);
  const quantity = body.quantity === undefined ? 1 : body.quantity;
  const isGift = body.is_gift === true;
  const giftRecipient = isGift ? clean(body.gift_recipient) : null;
  const requestToken = body.request_token;

  const invalid: string[] = [];
  if (name.length < 2) invalid.push("name");
  if (!tgUsername) invalid.push("telegram");
  if (!EMAIL_RE.test(email)) invalid.push("email");
  if (!isGift) {
    if (!level) invalid.push("level");
    if (!mat) invalid.push("mat");
    if (towel === null) invalid.push("towel");
    if (water === null) invalid.push("water");
  }
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 16) invalid.push("quantity");
  if (body.is_gift !== undefined && typeof body.is_gift !== "boolean") invalid.push("is_gift");
  if (isGift && (typeof body.gift_recipient !== "string" || !giftRecipient || giftRecipient.length < 2)) invalid.push("gift_recipient");
  if (requestToken !== undefined && (typeof requestToken !== "string" || !/^[a-f0-9]{32}$/.test(requestToken))) invalid.push("request_token");
  if (body.consent !== true) invalid.push("consent");
  if (invalid.length) return { status: 422, body: { error: "Invalid fields", fields: invalid } };

  const session = sessionForSignup({
    club: typeof body.club === "string" ? body.club.trim().slice(0, 50) : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(body.event_date ?? "")) ? String(body.event_date) : null,
  }, deps.now?.());
  if (!session) return { status: 404, body: { error: "No upcoming session" } };
  const ticketCount = quantity as number;
  if (ticketCount > session.capacity) return { status: 422, body: { error: "Invalid fields", fields: ["quantity"] } };

  const respond = (order: Pick<ClubOrder, "confirm_token" | "payment_status" | "quantity" | "amount_rub" | "is_gift">, redirectUrl: string | null = null): SignupResponse => ({
    status: 200,
    body: {
      ok: true,
      redirectUrl,
      statusUrl: deps.origin ? paidPageUrl(deps.origin, order.confirm_token) : null,
      confirmUrl: botStartUrl(order.confirm_token, deps.botUsername ?? undefined),
      paid: order.payment_status === "paid",
      waitlist: order.payment_status === "waitlist",
      quantity: order.quantity,
      amount: order.amount_rub,
      isGift: order.is_gift,
    },
  });
  const available = async () => {
    const taken = await deps.taken(session);
    return Number.isFinite(taken) ? Math.max(0, session.capacity - taken) : 0;
  };
  const pay = async (order: ClubOrder): Promise<SignupResponse> => {
    const res = await startPayment({ orders: deps.orders, yk: deps.yk, origin: deps.origin, now: deps.now }, order, session);
    if (res.kind === "redirect") return respond(res.order, res.url);
    if (res.kind === "paid") return respond(res.order);
    if (res.kind === "no_seats") return { status: 409, body: { error: "Not enough seats", available: await available() } };
    if (res.kind === "closed") return respond(order);
    console.error(`[club-signup] оплата недоступна (заказ ${order.id}): ${res.reason}`);
    return { status: 503, body: { error: "Payment unavailable" } };
  };

  // Тот же заказ: ключ формы (или ник у старой формы без ключа), затем — те же данные с живым холдом.
  const existing =
    (await deps.findByKey(session, typeof requestToken === "string" ? { token: requestToken } : { username: tgUsername! })) ??
    (await deps.findSamePending(session, { username: tgUsername!, quantity: ticketCount, isGift }));
  if (existing) {
    if (existing.payment_status === "paid" || existing.payment_status === "waitlist") return respond(existing);
    return pay(existing);
  }

  const taken = await deps.taken(session);
  if (!Number.isFinite(taken)) return { status: 503, body: { error: "Availability unavailable" } };
  const waitlist = isSoldOut(taken, session);
  if (!waitlist && !hasEnoughSeats(taken, session, ticketCount)) {
    return { status: 409, body: { error: "Not enough seats", available: Math.max(0, session.capacity - taken) } };
  }
  const token = (requestToken as string | undefined) ?? mintToken();
  const now = (deps.now?.() ?? new Date()).toISOString();
  const fields = {
    club: session.club, format: session.format, spot: session.spot, event_date: session.date, event_time: session.time,
    source: clean(body.source || session.club, 100),
    name, tg_username: tgUsername, email,
    level: isGift ? null : level, mat: isGift ? null : mat, towel: isGift ? null : towel, water: isGift ? null : water,
    quantity: ticketCount, is_gift: isGift, gift_recipient: giftRecipient,
    consent_at: now, confirm_token: token, updated_at: now,
    amount_rub: session.priceRub * ticketCount,
    payment_status: waitlist ? "waitlist" : "pending",
  };
  const inserted = await deps.insert(fields);
  const order = await deps.orders.byToken(token);
  if (!order) {
    console.error(`[club-signup] заказ ${token} не нашёлся после записи (${inserted})`);
    return { status: 500, body: { error: "DB error" } };
  }
  if (order.payment_status === "waitlist" || order.payment_status === "paid") return respond(order);
  return pay(order);
}
