import { TaskStoreBase, taskError, normalizeTaskUsername, validResultUrl, type TaskRow, type TaskSource } from "../tasks";
import type { MemberRow } from "../types";

export abstract class MemoryTasks extends TaskStoreBase {
  tasks = new Map<number, TaskRow>();
  abstract members: Map<number, MemberRow>;
  abstract clock: () => Date;
  async listAvailableTasks(chatId: number) {
    return structuredClone([...this.tasks.values()].filter(t => t.chat_id === chatId && t.status === "available"));
  }
  async listActiveTasks(userId: number, chatId: number) {
    if (!this.members.get(userId)?.is_active) taskError("member");
    return structuredClone([...this.tasks.values()].filter(t => t.chat_id === chatId && ["active", "completing"].includes(t.status) && t.claim?.taken_by === userId));
  }
  async listPendingTaskCleanup(userId: number, chatId: number) {
    if (!this.members.get(userId)?.is_active) taskError("member");
    return structuredClone([...this.tasks.values()].filter(t => t.chat_id === chatId && t.status === "completing" &&
      t.claim?.taken_by === userId && (t.claim.work_unpin_state !== "done" || t.claim.edit_state !== "done" ||
      (t.source_was_pinned && t.claim.source_unpin_state !== "done"))));
  }
  // No await between checks and writes: one atomic operation on this instance.
  async taskAction(action: string, a: Record<string, unknown>): Promise<TaskRow | null> {
    const now = this.clock().toISOString();
    let t = this.tasks.get(Number(a.id));
    if (action === "get") return t ? structuredClone(t) : null;
    if (action === "source") return structuredClone([...this.tasks.values()].find(t => t.chat_id === a.chat_id && t.message_id === a.message_id) ?? null);
    if (action === "invalidate") {
      t = [...this.tasks.values()].find(t => t.chat_id === a.chat_id && t.message_id === a.message_id);
      if (t && ["available", "invalid"].includes(t.status) && Number(a.version) > t.source_version) {
        Object.assign(t, { status: "invalid", source_text: a.source_text, source_version: a.version,
          assignee_id: null, bound_username: null, bound_by: null, bound_at: null, updated_at: now });
      }
      return null;
    }
    if (action === "import") {
      const { existing_only: existingOnly, ...source } = a;
      const s = source as unknown as TaskSource;
      t = [...this.tasks.values()].find(t => t.chat_id === s.chat_id && t.message_id === s.message_id);
      if (!t) {
        if (existingOnly) return null;
        t = { ...s, id: this.tasks.size + 1, assignee_id: null, bound_username: null, bound_by: null, bound_at: null,
          status: "available", created_at: now, updated_at: now, completed_at: null, completion_requested_at: null, result_url: null, claim: null };
        this.tasks.set(t.id, t);
      } else if (s.source_version > t.source_version && ["available", "invalid"].includes(t.status)) {
        if (s.assignee_username !== t.assignee_username) {
          Object.assign(t, { assignee_id: null, bound_username: null, bound_by: null, bound_at: null });
        }
        Object.assign(t, s, { status: "available", source_was_pinned: t.source_was_pinned || s.source_was_pinned, updated_at: now });
      } else if (s.source_was_pinned) {
        t.source_was_pinned = true;
      }
      return structuredClone(t);
    }
    if (!t) taskError("missing");
    const uid = Number(a.user_id);
    if (["bind", "take", "complete"].includes(action)) {
      const m = this.members.get(uid);
      if (!m?.is_active) taskError("member");
      if (!a.username) taskError("identity");
      if (action !== "bind" && (t.assignee_id !== uid || t.bound_username !== a.username)) taskError("identity");
      if (action !== "bind") {
        const matches = [...this.members.values()].filter(m => m.is_active && normalizeTaskUsername(m.username) === a.username);
        if (matches.length !== 1 || matches[0].chat_id !== uid) taskError("identity");
      } else if (!this.members.get(Number(a.admin_id))?.is_active) taskError("member");
    }
    if (action === "bind") {
      if (["done", "completing"].includes(t.status) || (t.claim && t.claim.taken_by !== uid)) taskError("state");
      Object.assign(t, { assignee_id: uid, bound_username: a.username, bound_by: a.admin_id, bound_at: now });
    } else if (action === "take") {
      if (t.chat_id !== a.chat_id) taskError("state");
      if (t.status !== "available") taskError("state");
      if ([...this.tasks.values()].filter(t => ["active", "completing"].includes(t.status) && t.claim?.taken_by === uid).length >= 4) taskError("limit");
      t.status = "active";
      t.claim = { taken_by: uid, taken_at: now, work_chat_id: Number(a.chat_id), work_thread_id: Number(a.work_thread_id),
        work_message_id: null, send_state: "pending", pin_state: "pending",
        work_unpin_state: "pending", source_unpin_state: "pending", edit_state: "pending" };
    } else if (action === "complete") {
      if (!(["active", "completing", "done"].includes(t.status)) || t.claim?.taken_by !== uid) taskError("state");
      if (t.status !== "active") return structuredClone(t);
      if ((t.requires_result && !a.result_url) || (a.result_url && !validResultUrl(String(a.result_url)))) taskError("result");
      Object.assign(t, { status: "completing", completion_requested_at: now, result_url: a.result_url ?? null });
    } else {
      const c = t.claim;
      if (!c) taskError("state");
      if (action === "lock") { if (c.send_state !== "pending" && c.send_state !== "rejected") return null; c.send_state = "sending"; }
      else if (action === "sent" || action === "recover") {
        if (!Number.isSafeInteger(a.message_id) || Number(a.message_id) <= 0) taskError("state");
        if (c.work_message_id && c.work_message_id !== a.message_id) taskError("state");
        if ([...this.tasks.values()].some(other => other.id !== t.id && other.claim?.work_chat_id === c.work_chat_id &&
            other.claim.work_message_id === a.message_id)) taskError("state");
        c.work_message_id = Number(a.message_id); c.send_state = "sent";
      } else if (action === "uncertain") { if (c.send_state === "sending") c.send_state = "uncertain"; }
      else if (action === "rejected") { if (c.send_state === "sending") c.send_state = "rejected"; }
      else if (action === "reset_send") {
        if (!["sending", "uncertain"].includes(c.send_state) || c.work_message_id ||
            Date.parse(t.updated_at) > this.clock().getTime() - 60_000) taskError("state");
        c.send_state = "pending";
      }
      else if (action === "pinned" || action === "failed") { if (!c.work_message_id) taskError("state"); c.pin_state = action; }
      else if (action === "work_unpinned" || action === "work_unpin_failed") { c.work_unpin_state = action === "work_unpinned" ? "done" : "failed"; }
      else if (action === "source_unpinned" || action === "source_unpin_failed") { c.source_unpin_state = action === "source_unpinned" ? "done" : "failed"; }
      else if (action === "edited" || action === "edit_failed") { c.edit_state = action === "edited" ? "done" : "failed"; }
      else if (action === "finish") {
        if (t.status !== "completing" || c.work_unpin_state !== "done" || c.edit_state !== "done" ||
            (t.source_was_pinned && c.source_unpin_state !== "done")) taskError("state");
        t.status = "done"; t.completed_at = now;
      }
      else taskError("state");
    }
    t.updated_at = now;
    return structuredClone(t);
  }
}
