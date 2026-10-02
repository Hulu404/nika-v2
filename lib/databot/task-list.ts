import { DueError, extractDue, parseDue } from "./assigned-due";
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
 * One task per line. A «что / срок / @a + @b» row creates one independent
 * assignment per recipient. The double-dash and older forms remain.
 */
export function parseTaskList(text: string, now: Date = new Date()): AssignedTaskDraft[] {
  const lines = text.split(/\r?\n/);
  lines[0] = lines[0].replace(/^\/(?:assign|tasks_add)(?:@\w+)?(?:\s+|$)/i, "");
  const tasks: AssignedTaskDraft[] = [];
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, "");
    if (!line) continue;
    const doubleDash = line.includes("--");
    const slashFields = doubleDash ? null : /^(.*)\s*\/\s*([^/]*)\s*\/\s*(.+)$/.exec(line);
    if (doubleDash || slashFields) {
      const fields = doubleDash ? line.split(/\s*--\s*/) : slashFields!.slice(1);
      if (fields.length !== 3) throw new TaskListError(index + 1, "Нужны три поля: что делать / дедлайн / @ник + @ник.");
      const [what, dueText, recipients] = fields.map(field => field.trim());
      if (!what || what.length > 3000) throw new TaskListError(index + 1, "Нужен текст задачи длиной до 3000 символов.");
      const names = recipients.split(/\s*\+\s*/);
      const usernamePattern = doubleDash ? /^@?[a-z0-9_]{1,32}$/i : /^@[a-z0-9_]{1,32}$/i;
      if (!names.length || names.some(name => !usernamePattern.test(name)))
        throw new TaskListError(index + 1, "Укажите ники исполнителей через +: @alice + @bob.");
      const usernames = names.map(normalizeTaskUsername);
      if (new Set(usernames).size !== usernames.length)
        throw new TaskListError(index + 1, "Один и тот же исполнитель указан в строке несколько раз.");
      let due: Date;
      try { due = parseDue(dueText.replace(/^до\s+/i, ""), now); }
      catch (err) {
        if (err instanceof DueError) throw new TaskListError(index + 1, err.message);
        throw err;
      }
      if (tasks.length + usernames.length > 50)
        throw new TaskListError(index + 1, "В одном сообщении допускается не более 50 назначений.");
      for (const username of usernames)
        tasks.push({ line: index + 1, username, what, due_at: due.toISOString() });
      continue;
    }
    if (!slashFields && line.includes(" / "))
      throw new TaskListError(index + 1, "Нужны три поля: что делать / дедлайн / @ник + @ник.");
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
