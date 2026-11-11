import { supabaseClubOrders } from "../clubs/orders";
import { processPayment, type PaymentDeps } from "../clubs/payments";
import { publicOriginFromEnv } from "../public-origin";
import { tgAdmin } from "../telegram/supabase";
import { notifyClubOrder } from "../telegram/club-signup";
import { notifyDonation } from "../telegram/donations";
import type { YkPayment, YooKassaApi } from "../yookassa";
import { supabaseDonations } from "./store";
import { isDonationPayment, processDonationPayment } from "./process";

type Handler = (payment: YkPayment) => Promise<{ outcome: string; ref: string | null }>;

/**
 * Платёж из API ЮKassa → донат или билет. Экспорт для теста: донат не должен
 * попадать в processPayment, а билет — в обработчик донатов.
 */
export async function handleVerifiedPayment(
  yk: YooKassaApi,
  paymentId: string,
  deps: { ticket?: Handler; donation?: Handler } = {},
): Promise<{ outcome: string; ref: string | null }> {
  const payment = await yk.getPayment(paymentId);
  if (isDonationPayment(payment)) {
    const run: Handler = deps.donation ?? (async (p) => {
      const { outcome, donation } = await processDonationPayment(
        { store: supabaseDonations(tgAdmin()), yk, origin: publicOriginFromEnv(), notify: notifyDonation },
        p,
      );
      return { outcome, ref: donation ? `donation ${donation.id}` : null };
    });
    return run(payment);
  }
  const runTicket: Handler = deps.ticket ?? (async (p) => {
    const ticketDeps: PaymentDeps = { orders: supabaseClubOrders(tgAdmin()), yk, origin: publicOriginFromEnv(), notify: notifyClubOrder };
    const { outcome, order } = await processPayment(ticketDeps, paymentId, p);
    return { outcome, ref: order ? `order ${order.id}` : null };
  });
  return runTicket(payment);
}
