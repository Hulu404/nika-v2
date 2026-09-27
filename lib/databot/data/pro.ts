import { DatabotDataError } from "./errors";
import { asObject, callRpc, toNum } from "./client";

/** Данные раздела «Про и оплаты» (databot_pro). Суммы — в рублях, как в базе. */

export interface ProSummary {
  proNow: number;
  proPaid: number;
  proPromo: number;
  proManual: number;
  paymentsCount: number;
  paymentsSum: number;
  paymentsByPlan: Record<string, { count: number; sum: number }>;
  redeemedByCode: Array<{ code: string; label: string | null; count: number }>;
  redeemedToPaid: number;
  expiring7d: number;
}

export function parsePro(raw: unknown): ProSummary {
  const o = asObject(raw, "databot_pro");
  const byPlan = asObject(o.payments_by_plan ?? {}, "payments_by_plan");
  const redeemed = o.redeemed_by_code ?? [];
  if (!Array.isArray(redeemed)) throw new DatabotDataError("db_error", "redeemed_by_code: ждали массив");

  const summary: ProSummary = {
    proNow: toNum(o.pro_now, "pro_now"),
    proPaid: toNum(o.pro_paid, "pro_paid"),
    proPromo: toNum(o.pro_promo, "pro_promo"),
    proManual: toNum(o.pro_manual, "pro_manual"),
    paymentsCount: toNum(o.payments_count, "payments_count"),
    paymentsSum: toNum(o.payments_sum, "payments_sum"),
    paymentsByPlan: Object.fromEntries(
      Object.entries(byPlan).map(([plan, v]) => {
        const x = asObject(v, `payments_by_plan.${plan}`);
        return [plan, { count: toNum(x.count, "count"), sum: toNum(x.sum, "sum") }];
      }),
    ),
    redeemedByCode: redeemed.map((item: unknown) => {
      const x = asObject(item, "redeemed_by_code[]");
      return {
        code: String(x.code),
        label: x.label === null || x.label === undefined ? null : String(x.label),
        count: toNum(x.count, "count"),
      };
    }),
    redeemedToPaid: toNum(o.redeemed_to_paid, "redeemed_to_paid"),
    expiring7d: toNum(o.expiring_7d, "expiring_7d"),
  };

  // Категории Про не пересекаются по построению SQL. Расхождение — значит
  // функцию сломали, и показывать такие цифры нельзя.
  if (summary.proPaid + summary.proPromo + summary.proManual !== summary.proNow) {
    throw new DatabotDataError("db_error", "databot_pro: категории Про не сходятся с pro_now");
  }
  return summary;
}

export async function fetchPro(from: Date, to: Date): Promise<ProSummary> {
  return parsePro(await callRpc("databot_pro", { p_from: from.toISOString(), p_to: to.toISOString() }));
}
