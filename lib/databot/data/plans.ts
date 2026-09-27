import { db, dbTimeout, toNumOrNull } from "./client";
import { DatabotDataError, classifyDbError } from "./errors";

/**
 * План явки на забег (databot_run_plans). Задают ивенты и совет в Промте 6;
 * здесь — только чтение для карточки. null — план не задан, это не ноль.
 */
export async function fetchRunPlan(spot: string, date: string): Promise<number | null> {
  const { data, error } = await db()
    .from("databot_run_plans")
    .select("target")
    .eq("spot", spot)
    .eq("run_date", date)
    .abortSignal(dbTimeout())
    .maybeSingle();
  if (error) throw new DatabotDataError(classifyDbError(error), `databot_run_plans: ${error.message}`);
  return data ? toNumOrNull(data.target, "target") : null;
}

/** Задать план явки: новое число заменяет старое (ключ — спот и дата). */
export async function setRunPlan(spot: string, date: string, target: number, setBy: number, now: Date): Promise<void> {
  const { error } = await db()
    .from("databot_run_plans")
    .upsert(
      { spot, run_date: date, target, set_by: setBy, set_at: now.toISOString() },
      { onConflict: "spot,run_date" },
    )
    .abortSignal(dbTimeout());
  if (error) throw new DatabotDataError(classifyDbError(error), `databot_run_plans: ${error.message}`);
}
