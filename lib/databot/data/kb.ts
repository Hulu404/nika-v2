import { db, dbTimeout, toNum, toNumOrNull } from "./client";
import { DatabotDataError, classifyDbError } from "./errors";
import type { Zone } from "../types";

/**
 * Справочник (databot_kb). Без кеша: правку совета следующий же запрос любого
 * человека видит сразу.
 */

export interface KbArticle {
  slug: string;
  title: string;
  /** Уже санитизированный Telegram HTML (kb-html.ts). */
  body: string;
  zones: Zone[];
  aliases: string[];
  sort: number;
  updatedAt: string;
  updatedBy: number | null;
  prevBody: string | null;
}

function toArticle(r: Record<string, unknown>): KbArticle {
  return {
    slug: String(r.slug),
    title: String(r.title),
    body: String(r.body),
    zones: (Array.isArray(r.zones) ? r.zones : []).map(String) as Zone[],
    aliases: (Array.isArray(r.aliases) ? r.aliases : []).map(String),
    sort: toNum(r.sort, "sort"),
    updatedAt: String(r.updated_at),
    updatedBy: toNumOrNull(r.updated_by, "updated_by"),
    prevBody: r.prev_body === null || r.prev_body === undefined ? null : String(r.prev_body),
  };
}

function fail(op: string, error: { message: string; code?: string }): never {
  throw new DatabotDataError(classifyDbError(error), `databot_kb ${op}: ${error.message}`);
}

export async function listKbArticles(): Promise<KbArticle[]> {
  const { data, error } = await db()
    .from("databot_kb")
    .select("slug, title, body, zones, aliases, sort, updated_at, updated_by, prev_body")
    .order("sort", { ascending: true })
    .order("title", { ascending: true })
    .abortSignal(dbTimeout());
  if (error) fail("list", error);
  return (data ?? []).map((r) => toArticle(r as Record<string, unknown>));
}

export async function getKbArticle(slug: string): Promise<KbArticle | null> {
  const { data, error } = await db()
    .from("databot_kb")
    .select("slug, title, body, zones, aliases, sort, updated_at, updated_by, prev_body")
    .eq("slug", slug)
    .abortSignal(dbTimeout())
    .maybeSingle();
  if (error) fail("get", error);
  return data ? toArticle(data as Record<string, unknown>) : null;
}

export async function insertKbArticle(
  a: Pick<KbArticle, "slug" | "title" | "body" | "zones">,
  by: number,
  now: Date,
): Promise<void> {
  const { error } = await db()
    .from("databot_kb")
    .insert({ slug: a.slug, title: a.title, body: a.body, zones: a.zones, updated_by: by, updated_at: now.toISOString() })
    .abortSignal(dbTimeout());
  if (error) fail("insert", error);
}

/**
 * Записать новые body и prev_body. Только если body в базе всё ещё тот, от
 * которого считали: двое правят одну статью — второй не затрёт первого молча.
 * false — статью успели изменить или удалить.
 */
export async function writeKbBody(
  slug: string,
  expectedBody: string,
  next: { body: string; prevBody: string | null },
  by: number,
  now: Date,
): Promise<boolean> {
  const { data, error } = await db()
    .from("databot_kb")
    .update({ body: next.body, prev_body: next.prevBody, updated_by: by, updated_at: now.toISOString() })
    .eq("slug", slug)
    .eq("body", expectedBody)
    .select("slug")
    .abortSignal(dbTimeout());
  if (error) fail("update", error);
  return (data?.length ?? 0) > 0;
}

export async function deleteKbArticle(slug: string): Promise<boolean> {
  const { data, error } = await db()
    .from("databot_kb")
    .delete()
    .eq("slug", slug)
    .select("slug")
    .abortSignal(dbTimeout());
  if (error) fail("delete", error);
  return (data?.length ?? 0) > 0;
}
