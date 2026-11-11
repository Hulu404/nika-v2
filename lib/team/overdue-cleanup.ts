import type { DatabotStore } from "../databot/data/store";
import type { AssignedTask } from "../databot/task-list";
import type { SettingsStore } from "./settings";

/**
 * Разовая чистка просроченных задач по списку Дмитрия (11.11.2026): задачи,
 * которые висели в «⏰ Просрочено» и руками удалять долго. Отменяет (статус
 * cancelled) без уведомлений исполнителям и авторам, как coffee-cleanup.ts.
 * Строки в базе остаются — это отмена, а не удаление.
 *
 * Задача попадает под чистку, только если совпали все три признака:
 * исполнитель, начало текста и срок не позже 28.10.2026. Выполняется один
 * раз: отметка в team_settings.
 */
export const OVERDUE_CLEANUP_SETTING = "cleanup_overdue_list_2026_11_11";

/** Срок не позже конца 28.10.2026 по МСК — самого позднего срока в списке. */
const DUE_BEFORE = Date.parse("2026-10-29T00:00:00+03:00");

/** [исполнитель, начало текста задачи]. */
export const OVERDUE_CLEANUP_LIST: ReadonlyArray<readonly [string, string]> = [
  ["hulu404", "FE5 · D1–D2: очередь врача и шаг после визита"],
  ["hulu404", "B8 · Маршрут после визита"],
  ["zuzya_zyzya", "Кофе-ран · Усачёва, вс 01.11: контент и анонсы"],
  ["hulu404", "FE6 · A1–A2: настройки клиники, стоп-кнопка, загрузки"],
  ["hulu404", "FE7 · A3: отчёт и выгрузка"],
  ["hulu404", "B9 · Дожим «не записался за 7 дней»"],
  ["dissidenceandtea", "B10 · Отчёт 30 дней против контроля"],
  ["ananas_2711", "смонтировать 3 варианта релсов из всех материалов которые были за все кофе-раны"],
];

const OPEN: ReadonlyArray<AssignedTask["status"]> = ["open", "taken", "declined"];

export function isListedOverdue(t: Pick<AssignedTask, "username" | "what" | "due_at" | "status">): boolean {
  if (!OPEN.includes(t.status) || !t.due_at || Date.parse(t.due_at) >= DUE_BEFORE) return false;
  const who = t.username.replace(/^@/, "").toLowerCase();
  const what = t.what.trim();
  return OVERDUE_CLEANUP_LIST.some(([u, prefix]) => u === who && what.startsWith(prefix));
}

/** null — уже выполнялась; иначе сколько задач отменено. */
export async function cleanupListedOverdue(deps: { tasks: DatabotStore; settings: SettingsStore }, now: Date): Promise<number | null> {
  if (await deps.settings.get(OVERDUE_CLEANUP_SETTING)) return null;
  const stale = (await deps.tasks.listAssignedOverview(new Date(0))).filter(isListedOverdue);
  let n = 0;
  for (const t of stale) {
    try {
      await deps.tasks.setAssignedStatus(t.id, t.assigned_by, "cancel");
      n++;
    } catch (err) {
      console.error("[team] overdue cleanup:", t.id, err instanceof Error ? err.message : String(err));
    }
  }
  await deps.settings.set(OVERDUE_CLEANUP_SETTING, `${n} @ ${now.toISOString()}`, null, now);
  console.log(`[team] overdue cleanup: отменено ${n} просроченных задач по списку`);
  return n;
}
