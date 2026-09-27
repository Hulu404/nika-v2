import { db, dbTimeout } from "./client";
import { DatabotDataError, classifyDbError } from "./errors";

/** Активные метки link_codes — для живой статьи «Метки и ссылки». */
export interface LinkCode {
  code: string;
  label: string;
  channel: string | null;
}

export async function fetchActiveLinkCodes(): Promise<LinkCode[]> {
  const { data, error } = await db()
    .from("link_codes")
    .select("code, label, channel")
    .eq("is_active", true)
    .order("code", { ascending: true })
    .abortSignal(dbTimeout());
  if (error) throw new DatabotDataError(classifyDbError(error), `link_codes: ${error.message}`);
  return (data ?? []).map((r) => ({
    code: String(r.code),
    label: String(r.label ?? ""),
    channel: r.channel === null || r.channel === undefined ? null : String(r.channel),
  }));
}
