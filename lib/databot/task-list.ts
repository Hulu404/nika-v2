import { DueError, extractDue } from "./assigned-due";
import { normalizeTaskUsername } from "./tasks";

export interface AssignedTaskDraft {
  line: number;
  username: string;
  what: string;
  /** Срок, ISO; null — без срока. */
  due_at: string | null;
}

export type AssignedStatus = "open" | "taken" | "done" | "declined" | "cancelled";
export type AssignedAction = "take" | "done" | "decline" | "reopen" | "cancel";

export interface AssignedTask extends AssignedTaskDraft {
  id: number;
  source_chat_id: number;
  source_message_id: number;
  assignee_id: number;
  assigned_by: number;
  created_at: string;
  delivery_state: "pending" | "sending" | "sent" | "failed" | "uncertain";
  delivered_message_id: number | null;
  status: AssignedStatus;
  status_at: string;
  reminded_at: string | null;
  overdue_notified_at: string | null;
}

/** Задача ещё в работе: по ней напоминают, её можно править и отменить. */
export const isActiveAssigned = (t: Pick<AssignedTask, "status">): boolean =>
  t.status === "open" || t.status === "taken";

export class TaskListError extends Error {
  constructor(public readonly line: number, reason: string) {
    super(reason);
  }
}

/**
 * One task per line, with exactly one Telegram @username anywhere in the line
 * and an optional deadline at the end: «@alice — макет до пт 18:00».
 */
export function parseTaskList(text: string, now: Date = new Date()): AssignedTaskDraft[] {
  const lines = text.split(/\r?\n/);
  lines[0] = lines[0].replace(/^\/(?:assign|tasks_add)(?:@\w+)?(?:\s+|$)/i, "");
  const tasks: AssignedTaskDraft[] = [];
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, "");
    if (!line) continue;
    const tags = [...line.matchAll(/(^|[^\w])@([a-z0-9_]{1,32})(?!\w)/gi)];
    if (tags.length !== 1) throw new TaskListError(index + 1, "Ожидается ровно один @username.");
    const username = normalizeTaskUsername(tags[0][2]);
    const body = line.replace(tags[0][0], tags[0][1]).replace(/^\s*[-—–:]\s*|\s*[-—–:]\s*$/g, "").trim();
    let found: { what: string; due: Date | null };
    try { found = extractDue(body, now); }
    catch (err) {
      if (err instanceof DueError) throw new TaskListError(index + 1, err.message);
      throw err;
    }
    const what = found.what.replace(/^\s*[-—–:]\s*|\s*[-—–:]\s*$/g, "").trim();
    if (!what || what.length > 3000) throw new TaskListError(index + 1, "Нужен текст задачи длиной до 3000 символов.");
    tasks.push({ line: index + 1, username, what, due_at: found.due?.toISOString() ?? null });
    if (tasks.length > 50) throw new TaskListError(index + 1, "В одном сообщении допускается не более 50 задач.");
  }
  if (!tasks.length) throw new TaskListError(1, "Список задач пуст.");
  return tasks;
}
