import { isRefundable, kopecks, rub, type YkPayment, type YkReceipt, type YooKassaApi } from "../yookassa";
import type { ClubOrder, ClubOrderStore } from "./orders";
import { moscowToday, sessionOfSignup, type ClubSession } from "./sessions";

/**
 * Оплата занятий клуба через API ЮKassa. Общая логика для формы на сайте,
 * вебхука ЮKassa, страницы /paid и бота мероприятий.
 *
 *   startPayment   — холд мест на 20 минут и платёж (redirect); повторный
 *                    вызов при активном холде отдаёт тот же платёж;
 *   processPayment — правда о платеже: GET /payments/{id} в API ЮKassa (телу
 *                    вебхука не доверяем), затем paid / canceled / возврат при
 *                    овербукинге. Идемпотентна: повтор ничего не ломает;
 *   refreshOrder   — то же для заказа, который ждёт оплаты (страница, бот);
 *   expireHolds    — фоновая задача: истёкшие холды → expired.
 */

export const HOLD_MINUTES = 20;
/** Префикс deep-link бота: /start st_<token> (без префикса — привязка аккаунта). */
export const CLUB_START_PREFIX = "st_";

export interface PaymentDeps {
  orders: ClubOrderStore;
  yk: YooKassaApi | null;
  /** Публичный origin сайта — для return_url. */
  origin: string | null;
  /** Сообщение в Telegram, если чат заказа известен (необязательно). */
  notify?: (order: ClubOrder, event: "paid" | "refunded_overbooked") => Promise<void>;
  now?: () => Date;
  env?: Record<string, string | undefined>;
}

const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};
export const ticketsLabel = (n: number) => `${n} ${plural(n, "билет", "билета", "билетов")}`;

export const paidPageUrl = (origin: string, token: string) => `${origin}/paid?o=${encodeURIComponent(token)}`;

/** Ссылка в бота мероприятий; username — только из env. */
export function botStartUrl(token: string, username = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME): string | null {
  const u = username?.trim().replace(/^@/, "");
  return u ? `https://t.me/${u}?start=${CLUB_START_PREFIX}${token}` : null;
}

/** Чек 54-ФЗ: почта из формы, количество и цена одного билета. YOOKASSA_RECEIPT=0 — без чека. */
export function paymentReceipt(
  order: Pick<ClubOrder, "email" | "amount_rub" | "quantity">,
  session: ClubSession,
  env: Record<string, string | undefined> = process.env,
): YkReceipt | undefined {
  if (env.YOOKASSA_RECEIPT === "0") return undefined;
  const taxSystem = Number(env.YOOKASSA_TAX_SYSTEM_CODE);
  const quantity = order.quantity || 1;
  return {
    customer: { email: order.email },
    items: [{
      description: `${session.title}, ${session.dateLabel} ${session.time}`.slice(0, 128),
      quantity: quantity.toFixed(2),
      amount: rub(order.amount_rub / quantity),
      vat_code: Number(env.YOOKASSA_VAT_CODE ?? 1), // 1 — без НДС
      payment_mode: "full_payment",
      payment_subject: "service",
    }],
    ...(Number.isInteger(taxSystem) && taxSystem > 0 ? { tax_system_code: taxSystem } : {}),
  };
}

const holdActive = (o: Pick<ClubOrder, "payment_status" | "hold_expires_at">, now: Date) =>
  o.payment_status === "pending_payment" && !!o.hold_expires_at && Date.parse(o.hold_expires_at) > now.getTime();

export type StartResult =
  | { kind: "redirect"; url: string; order: ClubOrder }
  | { kind: "paid"; order: ClubOrder }
  | { kind: "no_seats" }
  | { kind: "closed"; reason: string }
  | { kind: "unavailable"; reason: string };

/**
 * Холд и платёж для заказа. Активный холд с живым платежом — тот же платёж
 * (повторная отправка формы, бот), а не новый.
 */
export async function startPayment(deps: PaymentDeps, order: ClubOrder, session: ClubSession): Promise<StartResult> {
  const now = deps.now?.() ?? new Date();
  if (order.payment_status === "paid") return { kind: "paid", order };
  if (session.date < moscowToday(now)) return { kind: "closed", reason: "занятие уже прошло" };
  if (!deps.yk) return { kind: "unavailable", reason: "ключи ЮKassa не заданы" };
  if (!deps.origin) return { kind: "unavailable", reason: "не задан публичный адрес сайта" };

  if (holdActive(order, now) && order.yk_payment_id && order.yk_confirmation_url) {
    let payment: YkPayment | null = null;
    try {
      payment = await deps.yk.getPayment(order.yk_payment_id);
    } catch (err) {
      // ЮKassa не ответила — отдаём ту же ссылку: платёж ещё может быть жив.
      console.error("[club-pay] getPayment при повторе:", err instanceof Error ? err.message : String(err));
      return { kind: "redirect", url: order.yk_confirmation_url, order };
    }
    if (payment.status === "pending") return { kind: "redirect", url: order.yk_confirmation_url, order };
    const { order: fresh } = await processPayment(deps, payment.id, payment);
    if (fresh?.payment_status === "paid") return { kind: "paid", order: fresh };
    if (fresh) order = fresh;
  }

  const held = await deps.orders.hold(order.id, session.capacity, HOLD_MINUTES);
  if (held === "no_seats") return { kind: "no_seats" };
  if (held !== "held") return { kind: "closed", reason: `заказ в статусе ${order.payment_status}` };
  const fresh = await deps.orders.byId(order.id);
  if (!fresh) return { kind: "closed", reason: "заказ пропал" };
  const attempt = fresh.payment_attempt;

  let payment: YkPayment;
  try {
    payment = await deps.yk.createPayment({
      amount: rub(fresh.amount_rub),
      description: `${session.title}, ${session.dateLabel} ${session.time} · ${ticketsLabel(fresh.quantity)}`,
      returnUrl: paidPageUrl(deps.origin, fresh.confirm_token),
      metadata: { order_id: fresh.id, club: fresh.club, event_date: fresh.event_date },
      receipt: paymentReceipt(fresh, session, deps.env),
    }, `club-${fresh.id}-${attempt}`);
  } catch (err) {
    console.error(`[club-pay] createPayment (заказ ${fresh.id}):`, err instanceof Error ? err.message : String(err));
    await deps.orders.releaseHold(fresh.id, attempt).catch(() => {});
    return { kind: "unavailable", reason: "ЮKassa не создала платёж" };
  }
  const url = payment.confirmation?.confirmation_url;
  if (!url) {
    await deps.orders.releaseHold(fresh.id, attempt).catch(() => {});
    return { kind: "unavailable", reason: "у платежа нет ссылки на оплату" };
  }
  await deps.orders.setPayment(fresh.id, attempt, payment.id, url);
  return { kind: "redirect", url, order: { ...fresh, yk_payment_id: payment.id, yk_confirmation_url: url } };
}

export type ProcessOutcome =
  | "paid" | "already_paid" | "overbooked_refunded" | "duplicate_refunded"
  | "canceled" | "pending" | "ignored" | "mismatch";

/**
 * Правда о платеже из API ЮKassa и переход заказа. verified — уже полученный
 * из API платёж (чтобы не спрашивать дважды); тело вебхука сюда не передаётся.
 * Сбой возврата бросает исключение: вебхук ответит 500, ЮKassa повторит.
 */
export async function processPayment(
  deps: PaymentDeps,
  paymentId: string,
  verified?: YkPayment,
): Promise<{ outcome: ProcessOutcome; order: ClubOrder | null }> {
  if (!deps.yk) throw new Error("ключи ЮKassa не заданы");
  const payment = verified ?? (await deps.yk.getPayment(paymentId));
  const orderId = payment.metadata?.order_id;
  if (!orderId) return { outcome: "ignored", order: null };
  const order = await deps.orders.byId(orderId);
  if (!order) {
    console.error(`[club-pay] платёж ${payment.id}: заказа ${orderId} нет`);
    return { outcome: "ignored", order: null };
  }
  const session = sessionOfSignup(order);
  if (!session) {
    console.error(`[club-pay] платёж ${payment.id}: занятия заказа ${order.id} нет в SESSIONS`);
    return { outcome: "mismatch", order };
  }

  if (payment.status === "succeeded" && payment.paid) {
    const result = await deps.orders.confirm(order.id, payment.id, kopecks(payment.amount), session.capacity);
    if (result === "paid") {
      const fresh = (await deps.orders.byId(order.id)) ?? order;
      await deps.notify?.(fresh, "paid").catch(() => {});
      return { outcome: "paid", order: fresh };
    }
    if (result === "already_paid" || result === "refunded") return { outcome: "already_paid", order };
    if (result === "overbooked" || result === "duplicate") {
      // Деньги списаны, а места нет (или заказ уже оплачен другим платежом) — возврат.
      const refund = await deps.yk.refundPayment(payment, `refund-${payment.id}`);
      if (result === "overbooked") {
        await deps.orders.setRefund(order.id, refund.id);
        const fresh = (await deps.orders.byId(order.id)) ?? order;
        await deps.notify?.(fresh, "refunded_overbooked").catch(() => {});
        console.error(`[club-pay] овербукинг: заказ ${order.id}, платёж ${payment.id} возвращён (${refund.id})`);
        return { outcome: "overbooked_refunded", order: fresh };
      }
      console.error(`[club-pay] повторная оплата заказа ${order.id}: платёж ${payment.id} возвращён (${refund.id})`);
      return { outcome: "duplicate_refunded", order };
    }
    console.error(`[club-pay] платёж ${payment.id} заказа ${order.id} не подтверждён: ${result}`);
    return { outcome: "mismatch", order };
  }
  if (payment.status === "canceled") {
    await deps.orders.cancel(order.id, payment.id);
    return { outcome: "canceled", order: (await deps.orders.byId(order.id)) ?? order };
  }
  return { outcome: "pending", order };
}

/** Заказ, который ждёт оплаты, сверяется с ЮKassa (страница /paid, бот). */
export async function refreshOrder(deps: PaymentDeps, order: ClubOrder): Promise<ClubOrder> {
  if (order.payment_status !== "pending_payment" || !order.yk_payment_id || !deps.yk) return order;
  try {
    const { order: fresh } = await processPayment(deps, order.yk_payment_id);
    return fresh ?? order;
  } catch (err) {
    console.error(`[club-pay] сверка заказа ${order.id}:`, err instanceof Error ? err.message : String(err));
    return order;
  }
}

/** Фоновая задача: pending_payment с истёкшим холдом → expired, места свободны. */
export function expireHolds(deps: Pick<PaymentDeps, "orders" | "now">): Promise<number> {
  return deps.orders.expireHolds(deps.now?.() ?? new Date());
}

/** Холд ещё держит места. */
export const isHoldActive = holdActive;
