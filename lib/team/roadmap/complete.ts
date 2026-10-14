import type { Api } from "grammy";
import type { DatabotStore } from "../../databot/data/store";
import type { AssignedTask } from "../../databot/task-list";
import { escapeHtmlTeam } from "../copy";
import { rmCb } from "./copy";
import type { RoadmapStore } from "./store";

/**
 * Все задачи, привязанные к пункту плана, выполнены — спросить ответственного
 * пункта (без него — автора задачи): «Все задачи по B4 закрыты. Отметить пункт
 * готовым?» [Да] [Ещё нет]. Отменённые задачи не считаются.
 */
export async function checkRoadmapCompletion(
  api: Pick<Api, "sendMessage">,
  deps: { roadmap: Pick<RoadmapStore, "get">; tasks: Pick<DatabotStore, "listAssignedOverview"> },
  task: Pick<AssignedTask, "roadmap_item_id" | "assigned_by">,
): Promise<boolean> {
  if (!task.roadmap_item_id) return false;
  const item = await deps.roadmap.get(task.roadmap_item_id);
  if (!item || item.status === "done" || item.status === "dropped") return false;
  const related = (await deps.tasks.listAssignedOverview(new Date(0))).filter((t) => t.roadmap_item_id === item.id && t.status !== "cancelled");
  if (!related.length || related.some((t) => t.status !== "done")) return false;
  const to = item.owner_chat_id ?? task.assigned_by;
  await api.sendMessage(to, `Все задачи по ${escapeHtmlTeam(item.code ?? item.title)} закрыты. Отметить пункт готовым?`, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Да", callback_data: rmCb.doneYes(item.id) }, { text: "Ещё нет", callback_data: rmCb.doneNo(item.id) }]] },
  }).catch(() => {});
  return true;
}
