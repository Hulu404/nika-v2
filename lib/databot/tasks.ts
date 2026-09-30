/** Telegram usernames are identifiers, never substring/display-name matches. */
import { escapeHtml } from "./html";
export const normalizeTaskUsername = (value: string | null | undefined): string =>
  (value ?? "").trim().replace(/^@/, "").toLowerCase();

export interface TaskSource {
  chat_id: number;
  message_id: number;
  message_thread_id: number;
  source_text: string;
  source_version: number;
  what: string;
  assignee_username: string;
  due_at: string;
  requires_result: boolean;
  source_was_pinned: boolean;
}

export interface TaskClaim {
  taken_by: number;
  taken_at: string;
  work_chat_id: number;
  work_thread_id: number;
  work_message_id: number | null;
  send_state: "pending" | "sending" | "sent" | "uncertain" | "rejected";
  pin_state: "pending" | "pinned" | "failed";
  work_unpin_state: "pending" | "done" | "failed";
  source_unpin_state: "pending" | "done" | "failed";
  edit_state: "pending" | "done" | "failed";
}

export interface TaskRow extends TaskSource {
  id: number;
  assignee_id: number | null;
  bound_username: string | null;
  bound_by: number | null;
  bound_at: string | null;
  status: "available" | "invalid" | "active" | "completing" | "done";
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  completion_requested_at: string | null;
  result_url: string | null;
  claim: TaskClaim | null;
}

export class TaskError extends Error {}
export function taskError(code: string): never { throw new TaskError(code); }
export function validResultUrl(value: string): boolean {
  try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) && !!u.hostname; }
  catch { return false; }
}

/** Explicit format: no inference of timezone, owner, deadline or result policy. */
export function parseTask(text: string): Pick<TaskSource, "what" | "assignee_username" | "due_at" | "requires_result"> {
  const fields = new Map<string, string>();
  const details: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^(Что|Кто делает|К какому дню и часу|Ссылка на результат):\s*(.+)$/iu.exec(line.trim());
    if (!m) { if (line.trim()) details.push(line.trim()); continue; }
    const key = m[1].toLowerCase();
    if (fields.has(key)) taskError("format");
    fields.set(key, m[2].trim());
  }
  const what = [fields.get("что"), ...details].filter(Boolean).join("\n");
  const who = fields.get("кто делает") ?? "";
  const due = fields.get("к какому дню и часу") ?? "";
  const result = fields.get("ссылка на результат");
  if (!what || escapeHtml(what).length > 3000 || !/^@[a-z0-9_]{1,32}$/i.test(who) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(due) ||
      !Number.isFinite(Date.parse(due)) || ![undefined, "да", "нет"].includes(result?.toLowerCase())) taskError("format");
  const [y, mo, d] = due.slice(0, 10).split("-").map(Number);
  if (new Date(Date.UTC(y, mo - 1, d)).toISOString().slice(0, 10) !== due.slice(0, 10)) taskError("format");
  return { what, assignee_username: normalizeTaskUsername(who), due_at: new Date(due).toISOString(), requires_result: result?.toLowerCase() === "да" };
}

export interface TaskStore {
  getTask(id: number): Promise<TaskRow | null>;
  findSourceTask(chatId: number, messageId: number): Promise<TaskRow | null>;
  invalidateSourceTask(chatId: number, messageId: number, version: number, sourceText: string): Promise<void>;
  importTask(source: TaskSource, existingOnly?: boolean): Promise<TaskRow | null>;
  listAvailableTasks(chatId: number): Promise<TaskRow[]>;
  listActiveTasks(userId: number, chatId: number): Promise<TaskRow[]>;
  listPendingTaskCleanup(userId: number, chatId: number): Promise<TaskRow[]>;
  bindTask(id: number, userId: number, username: string, adminId: number): Promise<TaskRow>;
  takeTask(id: number, userId: number, username: string, chatId: number, workThreadId: number): Promise<TaskRow>;
  completeTask(id: number, userId: number, username: string, resultUrl: string | null): Promise<TaskRow>;
  taskDelivery(id: number, action: "lock" | "sent" | "uncertain" | "rejected" | "reset_send" | "pinned" | "failed" | "recover" | "work_unpinned" | "work_unpin_failed" | "source_unpinned" | "source_unpin_failed" | "edited" | "edit_failed" | "finish", messageId?: number): Promise<TaskRow | null>;
}

/** Named store methods share the same RPC contract in production and memory. */
export abstract class TaskStoreBase implements TaskStore {
  abstract taskAction(action: string, args: Record<string, unknown>): Promise<TaskRow | null>;
  abstract listAvailableTasks(chatId: number): Promise<TaskRow[]>;
  abstract listActiveTasks(userId: number, chatId: number): Promise<TaskRow[]>;
  abstract listPendingTaskCleanup(userId: number, chatId: number): Promise<TaskRow[]>;
  getTask(id: number) { return this.taskAction("get", { id }); }
  findSourceTask(chatId: number, messageId: number) { return this.taskAction("source", { chat_id: chatId, message_id: messageId }); }
  async invalidateSourceTask(chatId: number, messageId: number, version: number, sourceText: string) {
    await this.taskAction("invalidate", { chat_id: chatId, message_id: messageId, version, source_text: sourceText });
  }
  importTask(source: TaskSource, existingOnly = false) { return this.taskAction("import", { ...source, existing_only: existingOnly }); }
  async bindTask(id: number, userId: number, username: string, adminId: number) {
    return (await this.taskAction("bind", { id, user_id: userId, username: normalizeTaskUsername(username), admin_id: adminId }))!;
  }
  async takeTask(id: number, userId: number, username: string, chatId: number, workThreadId: number) {
    return (await this.taskAction("take", { id, user_id: userId, username: normalizeTaskUsername(username), chat_id: chatId, work_thread_id: workThreadId }))!;
  }
  async completeTask(id: number, userId: number, username: string, resultUrl: string | null) {
    return (await this.taskAction("complete", { id, user_id: userId, username: normalizeTaskUsername(username), result_url: resultUrl }))!;
  }
  taskDelivery(id: number, action: string, messageId?: number) { return this.taskAction(action, { id, message_id: messageId }); }
}
