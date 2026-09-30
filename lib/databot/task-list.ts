import { normalizeTaskUsername } from "./tasks";

export interface AssignedTaskDraft {
  line: number;
  username: string;
  what: string;
}

export interface AssignedTask extends AssignedTaskDraft {
  id: number;
  source_chat_id: number;
  source_message_id: number;
  assignee_id: number;
  assigned_by: number;
  created_at: string;
  delivery_state: "pending" | "sending" | "sent" | "failed" | "uncertain";
  delivered_message_id: number | null;
}

export class TaskListError extends Error {
  constructor(public readonly line: number, reason: string) {
    super(reason);
  }
}

/** One task per line, with exactly one Telegram @username anywhere in the line. */
export function parseTaskList(text: string): AssignedTaskDraft[] {
  const lines = text.split(/\r?\n/);
  lines[0] = lines[0].replace(/^\/(?:assign|tasks_add)(?:@\w+)?(?:\s+|$)/i, "");
  const tasks: AssignedTaskDraft[] = [];
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, "");
    if (!line) continue;
    const tags = [...line.matchAll(/(^|[^\w])@([a-z0-9_]{1,32})(?!\w)/gi)];
    if (tags.length !== 1) throw new TaskListError(index + 1, "Ожидается ровно один @username.");
    const username = normalizeTaskUsername(tags[0][2]);
    const what = line.replace(tags[0][0], tags[0][1]).replace(/^\s*[-—–:]\s*|\s*[-—–:]\s*$/g, "").trim();
    if (!what || what.length > 3000) throw new TaskListError(index + 1, "Нужен текст задачи длиной до 3000 символов.");
    tasks.push({ line: index + 1, username, what });
    if (tasks.length > 50) throw new TaskListError(index + 1, "В одном сообщении допускается не более 50 задач.");
  }
  if (!tasks.length) throw new TaskListError(1, "Список задач пуст.");
  return tasks;
}
