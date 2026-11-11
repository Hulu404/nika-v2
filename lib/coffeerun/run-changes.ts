import type { SupabaseClient } from "@supabase/supabase-js";
import { tgAdmin } from "../telegram/supabase";
import { markCancelled, markMoved } from "../telegram/poll-store";
import type { CoffeeRun } from "./run";

/**
 * Переносы (/moved) и отмены (/cancel) забегов в базе: coffee_run_changes
 * (миграция 073). Раньше они жили только в памяти процесса (poll-store.ts) и
 * терялись при перезапуске или деплое Railway, и бот мог позвать на
 * отменённый забег или спросить «придёшь в 12:30?» после переноса на 18:00.
 *
 * Память осталась кэшем: при старте процесса её заполняет loadRunChangesIntoMemory().
 */

export interface RunChange {
  run_date: string;
  spot: string;
  kind: "moved" | "cancelled";
  new_start: string | null;
  created_at: string;
}

export interface RunStatus {
  cancelled: boolean;
  /** Новое время старта после переноса; null — переноса не было. */
  movedStart: string | null;
}

const TABLE = "coffee_run_changes";

/** Записать перенос или отмену. Повторный перенос обновляет время. Бросает при ошибке базы. */
export async function saveRunChange(
  change: { run: Pick<CoffeeRun, "date" | "spot">; kind: "moved" | "cancelled"; newStart?: string | null; by?: number | null },
  db: SupabaseClient = tgAdmin(),
): Promise<void> {
  const { error } = await db.from(TABLE).upsert(
    {
      run_date: change.run.date,
      spot: change.run.spot,
      kind: change.kind,
      new_start: change.kind === "moved" ? change.newStart ?? null : null,
      created_by: change.by ?? null,
      created_at: new Date().toISOString(),
    },
    { onConflict: "run_date,spot,kind" },
  );
  if (error) throw new Error(`${TABLE}: ${error.message}`);
}

/** Как saveRunChange, но ошибка — только в лог: объявление людям важнее записи. */
export async function saveRunChangeSafe(
  change: Parameters<typeof saveRunChange>[0],
  db?: SupabaseClient,
): Promise<void> {
  try {
    await saveRunChange(change, db);
  } catch (err) {
    console.error("[run-changes] запись:", err instanceof Error ? err.message : err);
  }
}

/** Статус забега из базы. Бросает при ошибке — вызывающий решает, что делать с сомнением. */
export async function runStatus(run: Pick<CoffeeRun, "date" | "spot">, db: SupabaseClient = tgAdmin()): Promise<RunStatus> {
  const { data, error } = await db
    .from(TABLE)
    .select("run_date, spot, kind, new_start, created_at")
    .eq("run_date", run.date)
    .eq("spot", run.spot);
  if (error) throw new Error(`${TABLE}: ${error.message}`);
  const rows = (data as RunChange[] | null) ?? [];
  return {
    cancelled: rows.some((r) => r.kind === "cancelled"),
    movedStart: rows.find((r) => r.kind === "moved")?.new_start ?? null,
  };
}

/**
 * Статус для переклички и напоминаний: база, а при её сбое — память процесса.
 * Здесь лучше показать время из кэша, чем не напомнить вовсе.
 */
export async function runStatusOrMemory(
  run: Pick<CoffeeRun, "date" | "spot">,
  memory: { movedStartFor(date: string): string | null; cancelledAt(date: string): string | null },
  db?: SupabaseClient,
): Promise<RunStatus> {
  try {
    return await runStatus(run, db);
  } catch (err) {
    console.error("[run-changes] чтение, беру память:", err instanceof Error ? err.message : err);
    return { cancelled: memory.cancelledAt(run.date) !== null, movedStart: memory.movedStartFor(run.date) };
  }
}

/** Заполнить кэш в памяти из базы при старте процесса (переносы и отмены за последние 30 дней). */
export async function loadRunChangesIntoMemory(db: SupabaseClient = tgAdmin(), now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await db
    .from(TABLE)
    .select("run_date, spot, kind, new_start, created_at")
    .gte("run_date", since);
  if (error) throw new Error(`${TABLE}: ${error.message}`);
  const rows = (data as RunChange[] | null) ?? [];
  for (const r of rows) {
    if (r.kind === "moved" && r.new_start) markMoved(r.run_date, r.new_start);
    if (r.kind === "cancelled") markCancelled(r.run_date, r.created_at);
  }
  return rows.length;
}
