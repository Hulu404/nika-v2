export type SubscriptionPlan = "free" | "monthly" | "yearly";

export type SubscriptionStatus = "active" | "pending" | "canceled" | "expired";

export interface Subscription {
  id: string;
  userId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  /** ID платежа в ЮKassa, если оформлена платная подписка. */
  yukassaPaymentId?: string;
  /** Когда заканчивается оплаченный период (ISO-строка). */
  currentPeriodEnd?: string;
  createdAt: string;
}
