import type { DatabotStore } from "../databot/data/store";
import type { AssignedTask } from "../databot/task-list";
import { LEGACY_COFFEE_TASKS } from "./coffee-run-template";
import type { SettingsStore } from "./settings";

/**
 * Разовая чистка задач кофе-рана старого образца (по пять задач всем
 * участникам SMM и ивентов). Отменяет незакрытые, у которых срок уже прошёл;
 * задачи с ещё не прошедшим сроком не трогает. Никаких уведомлений: статус
 * меняется напрямую в хранилище, без сообщений исполнителям и авторам.
 *
 * Признак — источник (source_message_id задач кофе-рана, coffee-run-week.ts)
 * и текст одного из прежних шаблонов: новые задачи ответственным под чистку
 * не попадают. Выполняется один раз: отметка в team_settings.
 */

export const COFFEE_CLEANUP_SETTING = "cleanup_legacy_coffee_tasks_v1";
/** Диапазон source_message_id задач кофе-рана (TASK_SOURCE_BASE + id события). */
const SOURCE_FROM = 2_000_000_000;
const SOURCE_TO = 3_000_000_000;

const OPEN: ReadonlyArray<AssignedTask["status"]> = ["open", "taken", "declined"];

export function isLegacyCoffeeTask(t: Pick<AssignedTask, "source_message_id" | "what">): boolean {
  return t.source_message_id >= SOURCE_FROM && t.source_message_id < SOURCE_TO
    && LEGACY_COFFEE_TASKS.some((w) => t.what === w || t.what.startsWith(`${w} · `));
}

/** null — уже выполнялась; иначе сколько задач отменено. */
export async function cleanupLegacyCoffeeTasks(deps: { tasks: DatabotStore; settings: SettingsStore }, now: Date): Promise<number | null> {
  if (await deps.settings.get(COFFEE_CLEANUP_SETTING)) return null;
  const stale = (await deps.tasks.listAssignedOverview(new Date(0)))
    .filter((t) => OPEN.includes(t.status) && !!t.due_at && Date.parse(t.due_at) < now.getTime() && isLegacyCoffeeTask(t));
  let n = 0;
  for (const t of stale) {
    try {
      await deps.tasks.setAssignedStatus(t.id, t.assigned_by, "cancel");
      n++;
    } catch (err) {
      console.error("[team] cleanup:", t.id, err instanceof Error ? err.message : String(err));
    }
  }
  await deps.settings.set(COFFEE_CLEANUP_SETTING, `${n} @ ${now.toISOString()}`, null, now);
  console.log(`[team] cleanup: отменено ${n} старых задач кофе-рана`);
  return n;
}
