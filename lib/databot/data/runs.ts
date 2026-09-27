import { asRows, callRpc, toCountMap, toNum } from "./client";
import { DatabotDataError } from "./errors";

/**
 * Данные раздела «Забеги» из SQL-функций 037. Остальные цифры карточки
 * (заявки, подтверждения, динамика) берутся из lib/team напрямую — чтобы
 * два бота считали одно и то же одними функциями.
 */

export interface RunPeople {
  total: number;
  newPeople: number;
  returningPeople: number;
  /** Код метки (attr_last) → заявок; без метки — ключ "none". */
  byLink: Record<string, number>;
}

export function parseRunPeople(raw: unknown): RunPeople {
  const rows = asRows(raw, "databot_run_people");
  // Функция агрегирует без group by и всегда отдаёт ровно одну строку —
  // даже для забега без заявок (нули). Пусто — ответ сломан.
  const r = rows[0];
  if (!r) throw new DatabotDataError("db_error", "databot_run_people: пустой ответ");
  return {
    total: toNum(r.total, "total"),
    newPeople: toNum(r.new_people, "new_people"),
    returningPeople: toNum(r.returning_people, "returning_people"),
    byLink: toCountMap(r.by_link, "by_link"),
  };
}

export async function fetchRunPeople(spot: string, date: string): Promise<RunPeople> {
  return parseRunPeople(await callRpc("databot_run_people", { p_spot: spot, p_date: date }));
}

export interface RunsTableRow {
  spot: string;
  runDate: string;
  total: number;
  confirmed: number;
  reminded: number;
  newPeople: number;
}

export function parseRunsTable(raw: unknown): RunsTableRow[] {
  return asRows(raw, "databot_runs_table").map((r) => ({
    spot: String(r.spot),
    // date из PostgREST — строка YYYY-MM-DD; на всякий случай отрезаем время.
    runDate: String(r.run_date).slice(0, 10),
    total: toNum(r.total, "total"),
    confirmed: toNum(r.confirmed, "confirmed"),
    reminded: toNum(r.reminded, "reminded"),
    newPeople: toNum(r.new_people, "new_people"),
  }));
}

/** Забеги с fromYmd по toYmd включительно, свежие сверху. */
export async function fetchRunsTable(fromYmd: string, toYmd: string): Promise<RunsTableRow[]> {
  return parseRunsTable(await callRpc("databot_runs_table", { p_from: fromYmd, p_to: toYmd }));
}
