import { kopecks, type YkPayment } from "../yookassa";
import type { Donation } from "./store";
import type { DonationPaymentDeps } from "./payment";

/**
 * Донат по вебхуку ЮKassa. Вебхук (app/api/yookassa/webhook/route.ts) сначала
 * получает платёж из API (телу не доверяем) и, если metadata.kind = donation,
 * отдаёт его сюда, мимо processPayment билетов.
 */

export type DonationOutcome = "paid" | "already_paid" | "canceled" | "pending" | "ignored" | "mismatch";

/** Платёж ЮKassa — донат? Решает metadata.kind, тело вебхука сюда не доходит. */
export const isDonationPayment = (payment: Pick<YkPayment, "metadata">) => payment.metadata?.kind === "donation";

/**
 * Переход доната по уже проверенному в API платежу. Повторная доставка
 * вебхука ничего не меняет: paid не переписывается, canceled — только из
 * ожидания оплаты этим же платежом.
 */
export async function processDonationPayment(deps: DonationPaymentDeps, payment: YkPayment): Promise<{ outcome: DonationOutcome; donation: Donation | null }> {
  const id = payment.metadata?.donation_id;
  if (!id) return { outcome: "ignored", donation: null };
  const donation = await deps.store.byId(id);
  if (!donation) {
    console.error(`[donation] платёж ${payment.id}: доната ${id} нет`);
    return { outcome: "ignored", donation: null };
  }

  if (payment.status === "succeeded" && payment.paid) {
    if (kopecks(payment.amount) !== donation.amount_rub * 100) {
      console.error(`[donation] платёж ${payment.id}: сумма ${payment.amount.value} не совпала с ${donation.amount_rub} ₽ доната ${id}`);
      return { outcome: "mismatch", donation };
    }
    const now = deps.now?.() ?? new Date();
    const paid = await deps.store.markPaid(id, payment.id, now.toISOString());
    if (!paid) return { outcome: "already_paid", donation };
    await deps.notify?.(paid, "paid").catch((err) => console.error("[donation] notify paid:", err instanceof Error ? err.message : err));
    return { outcome: "paid", donation: paid };
  }
  if (payment.status === "canceled") {
    const canceled = await deps.store.markCanceled(id, payment.id);
    if (!canceled) return { outcome: "ignored", donation };
    await deps.notify?.(canceled, "canceled").catch((err) => console.error("[donation] notify canceled:", err instanceof Error ? err.message : err));
    return { outcome: "canceled", donation: canceled };
  }
  return { outcome: "pending", donation };
}

