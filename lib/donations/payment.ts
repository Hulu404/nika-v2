import type { SupabaseClient } from "@supabase/supabase-js";
import { rub, type YkPayment, type YkReceipt, type YooKassaApi } from "../yookassa";
import {
  DONATION_MAX_RUB,
  DONATION_MIN_RUB,
  PAYMENT_DESCRIPTION,
  RECEIPT_ITEM,
} from "../telegram/donation-copy";
import type { Donation, DonationStore } from "./store";

/**
 * Оплата доната через API ЮKassa — тот же магазин и те же ключи, что у
 * билетов, но своя логика: ни мест, ни холдов. Счёт Telegram (sendInvoice) не
 * используем: по таким платежам ЮKassa не шлёт HTTP-уведомления.
 *
 *   startDonationPayment — новая попытка: платёж (redirect) и ссылка на оплату.
 * Переход по вебхуку — lib/donations/process.ts.
 */

/** «500», «1 000», «500 р», «500 ₽», «500 руб.» → 500. Слова и дроби — null. */
export function parseDonationAmount(raw: string): number | null {
  const text = raw.trim().toLowerCase().replace(/ | /g, " ");
  const m = /^(\d{1,3}(?:[ ]\d{3})+|\d+)\s*(?:₽|р\.?|руб\.?|рублей|рубля|рубль)?$/.exec(text);
  if (!m) return null;
  const amount = Number(m[1].replace(/ /g, ""));
  if (!Number.isSafeInteger(amount) || amount < DONATION_MIN_RUB || amount > DONATION_MAX_RUB) return null;
  return amount;
}

/** Та же проверка почты, что у формы записи на сайте (lib/clubs/signup.ts). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zа-я]{2,}$/i;

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

/** Чек 54-ФЗ: те же env, что у билетов (YOOKASSA_RECEIPT=0 — без чека). */
export function donationReceipt(
  donation: Pick<Donation, "email" | "amount_rub">,
  env: Record<string, string | undefined> = process.env,
): YkReceipt | undefined {
  if (env.YOOKASSA_RECEIPT === "0") return undefined;
  const taxSystem = Number(env.YOOKASSA_TAX_SYSTEM_CODE);
  return {
    customer: { email: donation.email },
    items: [{
      description: RECEIPT_ITEM,
      quantity: "1.00",
      amount: rub(donation.amount_rub),
      vat_code: Number(env.YOOKASSA_VAT_CODE ?? 1), // 1 — без НДС
      payment_mode: "full_payment",
      payment_subject: "service",
    }],
    ...(Number.isInteger(taxSystem) && taxSystem > 0 ? { tax_system_code: taxSystem } : {}),
  };
}

export const thanksPageUrl = (origin: string, donationId: string) => `${origin}/thanks?d=${encodeURIComponent(donationId)}`;

export interface DonationPaymentDeps {
  store: DonationStore;
  yk: YooKassaApi | null;
  origin: string | null;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  /** Сообщение в бот после вебхука, если чат известен. */
  notify?: (donation: Donation, event: "paid" | "canceled") => Promise<void>;
}

export type DonationStart = { kind: "redirect"; url: string; donation: Donation } | { kind: "unavailable"; reason: string };

/** Новая попытка оплаты доната: платёж ЮKassa и ссылка на страницу оплаты. */
export async function startDonationPayment(deps: DonationPaymentDeps, donation: Donation): Promise<DonationStart> {
  if (!deps.yk) return { kind: "unavailable", reason: "ключи ЮKassa не заданы" };
  if (!deps.origin) return { kind: "unavailable", reason: "не задан публичный адрес сайта" };
  if (donation.payment_status === "paid") return { kind: "unavailable", reason: "уже оплачено" };

  const attempt = await deps.store.nextAttempt(donation.id);
  let payment: YkPayment;
  try {
    payment = await deps.yk.createPayment({
      amount: rub(donation.amount_rub),
      description: PAYMENT_DESCRIPTION,
      returnUrl: thanksPageUrl(deps.origin, donation.id),
      metadata: { kind: "donation", donation_id: donation.id },
      receipt: donationReceipt(donation, deps.env),
    }, `donation-${donation.id}-${attempt}`);
  } catch (err) {
    console.error(`[donation] createPayment (${donation.id}):`, err instanceof Error ? err.message : String(err));
    return { kind: "unavailable", reason: "ЮKassa не создала платёж" };
  }
  const url = payment.confirmation?.confirmation_url;
  if (!url) return { kind: "unavailable", reason: "у платежа нет ссылки на оплату" };
  await deps.store.setPayment(donation.id, payment.id, url);
  return { kind: "redirect", url, donation: { ...donation, yk_payment_id: payment.id, yk_confirmation_url: url, payment_attempt: attempt } };
}

/**
 * Последняя почта человека для чека: донаты, заказы клубов, заявки на
 * кофе-раны — сначала по чату, потом по нику. null — почты нет нигде.
 */
export async function lastKnownEmail(
  db: SupabaseClient,
  who: { chatId: number; username: string | null },
): Promise<string | null> {
  const tables = ["donations", "club_signups", "coffee_run_signups"] as const;
  const pick = async (column: "tg_chat_id" | "tg_username", value: number | string) => {
    const found: Array<{ email: string; created_at: string }> = [];
    for (const table of tables) {
      const { data, error } = await db
        .from(table)
        .select("email, created_at")
        .eq(column, value)
        .neq("email", "")
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw new Error(`${table} email: ${error.message}`);
      const row = ((data as Array<{ email: string; created_at: string }> | null) ?? [])[0];
      if (row && normalizeEmail(row.email)) found.push(row);
    }
    found.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return found[0]?.email ?? null;
  };
  return (await pick("tg_chat_id", who.chatId)) ?? (who.username ? await pick("tg_username", who.username) : null);
}
