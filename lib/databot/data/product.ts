import { asObject, callRpc, toCountMap, toNum, toNumOrNull } from "./client";

/** Данные раздела «Продукт» (databot_product). */

export interface ProductSummary {
  signups: number;
  onboarded: number;
  tgLinked: number;
  /** Канал последнего касания → регистраций; "none" — касания нет, "other" — не по метке. */
  byChannel: Record<string, number>;
  active7d: number;
  sprintsStarted: number;
  sprintsActive: number;
  sprintsClosed: number;
  nudgeSent: number;
  nudgeClicked: number;
  /** Возврат после пропуска (North Star). null — до Фазы 0 (user_day_facts), это «нет данных», а не ноль. */
  nsm: number | null;
}

export function parseProduct(raw: unknown): ProductSummary {
  const o = asObject(raw, "databot_product");
  return {
    signups: toNum(o.signups, "signups"),
    onboarded: toNum(o.onboarded, "onboarded"),
    tgLinked: toNum(o.tg_linked, "tg_linked"),
    byChannel: toCountMap(o.by_channel, "by_channel"),
    active7d: toNum(o.active_7d, "active_7d"),
    sprintsStarted: toNum(o.sprints_started, "sprints_started"),
    sprintsActive: toNum(o.sprints_active, "sprints_active"),
    sprintsClosed: toNum(o.sprints_closed, "sprints_closed"),
    nudgeSent: toNum(o.nudge_sent, "nudge_sent"),
    nudgeClicked: toNum(o.nudge_clicked, "nudge_clicked"),
    nsm: toNumOrNull(o.nsm, "nsm"),
  };
}

export async function fetchProduct(from: Date, to: Date): Promise<ProductSummary> {
  return parseProduct(await callRpc("databot_product", { p_from: from.toISOString(), p_to: to.toISOString() }));
}
