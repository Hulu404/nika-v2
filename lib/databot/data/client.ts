import type { SupabaseClient } from "@supabase/supabase-js";
import { tgAdmin } from "../../telegram/supabase";
import { DatabotDataError, classifyDbError } from "./errors";

/**
 * Общее для обёрток data/*.ts: сервисный клиент, таймаут и приведение чисел.
 *
 * Клиент — tgAdmin(), как в supabase-store.ts: lib/supabase-server помечен
 * "server-only" и падает под tsx в scripts/databot-dev.ts.
 */

/** ТЗ, раздел 7: запрос к базе дольше 10 секунд считаем сбоем. */
export const DB_TIMEOUT_MS = 10_000;

export function dbTimeout(): AbortSignal {
  return AbortSignal.timeout(DB_TIMEOUT_MS);
}

export function db(): SupabaseClient {
  return tgAdmin();
}

/**
 * Число из PostgREST: bigint и numeric приходят то числом, то строкой.
 * null и undefined остаются null — «данных нет» не превращается в ноль.
 * Мусор — авария, а не NaN в тексте ответа.
 */
export function toNumOrNull(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new DatabotDataError("db_error", `${field}: не число (${String(value)})`);
  return n;
}

/**
 * Обязательное число: count(*) из SQL-функции null не бывает. Если пришёл
 * null — ответ функции сломан, и это авария, а не ноль.
 */
export function toNum(value: unknown, field: string): number {
  const n = toNumOrNull(value, field);
  if (n === null) throw new DatabotDataError("db_error", `${field}: пусто там, где ждали число`);
  return n;
}

/** Вызов RPC с таймаутом. Ошибка базы — DatabotDataError с кодом. */
export async function callRpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  let result: { data: unknown; error: { message: string; code?: string } | null };
  try {
    result = await db().rpc(name, args).abortSignal(dbTimeout());
  } catch (err) {
    throw new DatabotDataError(classifyDbError(err), `${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (result.error) {
    throw new DatabotDataError(classifyDbError(result.error), `${name}: ${result.error.message}`);
  }
  return result.data;
}

/** jsonb-объект из функции; не объект — авария. */
export function asObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DatabotDataError("db_error", `${field}: ждали объект`);
  }
  return value as Record<string, unknown>;
}

/** Строки из функции returns table; не массив — авария. */
export function asRows(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new DatabotDataError("db_error", `${field}: ждали строки`);
  return value as Record<string, unknown>[];
}

/** jsonb «ключ → число» (by_link, by_channel). */
export function toCountMap(value: unknown, field: string): Record<string, number> {
  const obj = asObject(value ?? {}, field);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = toNum(v, `${field}.${k}`);
  return out;
}
