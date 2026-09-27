import { DatabotDataError } from "./errors";
import { asRows, callRpc, toNum } from "./client";

/** Данные раздела «Соцсети и метки» (databot_traffic, databot_traffic_since). */

export interface TrafficRow {
  code: string;
  label: string;
  /** instagram, telegram, vk, offline, partner, other; null — канал не задан. */
  channel: string | null;
  clicks: number;
  visitors: number;
  signupsCoffeerun: number;
  signupsApp: number;
}

export function parseTraffic(raw: unknown): TrafficRow[] {
  return asRows(raw, "databot_traffic").map((r) => ({
    code: String(r.code),
    label: String(r.label ?? ""),
    channel: r.channel === null || r.channel === undefined ? null : String(r.channel),
    clicks: toNum(r.clicks, "clicks"),
    visitors: toNum(r.visitors, "visitors"),
    signupsCoffeerun: toNum(r.signups_coffeerun, "signups_coffeerun"),
    signupsApp: toNum(r.signups_app, "signups_app"),
  }));
}

/** Все метки за [from, to), в том числе без переходов. */
export async function fetchTraffic(from: Date, to: Date): Promise<TrafficRow[]> {
  return parseTraffic(await callRpc("databot_traffic", { p_from: from.toISOString(), p_to: to.toISOString() }));
}

export function parseTrafficSince(raw: unknown): Date | null {
  if (raw === null || raw === undefined) return null;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) throw new DatabotDataError("db_error", "databot_traffic_since: не дата");
  return d;
}

/** С какого момента пишутся переходы; null — ещё ни одного. */
export async function fetchTrafficSince(): Promise<Date | null> {
  return parseTrafficSince(await callRpc("databot_traffic_since", {}));
}
