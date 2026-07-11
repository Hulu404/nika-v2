/**
 * Хелперы форматирования для страниц оплаты (/payment/success, /payment/fail).
 * Код по инструкции robokassa-success-fail-pages.md §2.
 */

const PLAN_LABELS: Record<string, string> = {
  pro: "PRO",
  premium: "Premium",
  // Реальные значения robokassa_payments.plan — это monthly/halfyear (тир один,
  // всегда PRO). Добавлено, чтобы planLabel не падал в fallback `.toUpperCase()`.
  monthly: "PRO",
  halfyear: "PRO",
};

const PERIOD_LABELS: Record<string, string> = {
  monthly: "Месяц",
  yearly: "Год",
};

export function planLabel(plan: string) {
  return PLAN_LABELS[plan] ?? plan.toUpperCase();
}

export function periodLabel(period: string) {
  return PERIOD_LABELS[period] ?? period;
}

export function formatRub(amount: number) {
  return `${amount.toLocaleString("ru-RU")} ₽`;
}

export function formatDateRu(date: Date) {
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// следующее списание = дата оплаты + 1 месяц (пока только monthly)
export function nextBillingDate(paidAt: Date, period: string) {
  const next = new Date(paidAt);
  if (period === "yearly") {
    next.setFullYear(next.getFullYear() + 1);
  } else {
    next.setMonth(next.getMonth() + 1);
  }
  return next;
}
