import { asFormState, type FormState } from "../form";
import type { AuditEntry, InviteRow, MemberRow, Zone } from "../types";
import type { DatabotStore } from "./store";
import { normalizeTaskUsername } from "../tasks";
import { isActiveAssigned, type AssignedAction, type AssignedStatus, type AssignedTask, type AssignedTaskDraft } from "../task-list";
import { MemoryTasks } from "./memory-tasks";

/**
 * Хранилище в памяти — для тестов конвейера и разделов. Повторяет смысл
 * supabase-store.ts, включая условия погашения приглашения, поэтому сценарии
 * «сработало один раз», «истекло через 48 часов», «убранный теряет доступ»
 * проверяются без базы.
 *
 * failNext("findActiveMember") — следующая такая операция бросит, как база,
 * которая не ответила.
 */
export class MemoryStore extends MemoryTasks implements DatabotStore {
  assignedTasks = new Map<number, AssignedTask>();
  members = new Map<number, MemberRow>();
  invites = new Map<string, InviteRow>();
  audit: Array<AuditEntry & { created_at: string }> = [];
  sessions = new Map<string, unknown>();
  rateLimited = new Set<string>();
  private failing = new Set<keyof DatabotStore>();

  async importAssignedTasks(ownerId: number, messageId: number, drafts: AssignedTaskDraft[]): Promise<AssignedTask[]> {
    this.maybeFail("importAssignedTasks");
    const owner = this.members.get(ownerId);
    if (!owner?.is_active || !owner.is_owner) throw new Error("assigned:owner");
    const previous = [...this.assignedTasks.values()].filter(t => t.source_chat_id === ownerId && t.source_message_id === messageId);
    if ((previous.length && previous.length !== drafts.length) ||
        previous.some(t => !drafts.some(d => d.line === t.line && d.username === t.username && d.what === t.what)))
      throw new Error("assigned:source_changed");
    const recipients = drafts.map(draft => {
      const matches = [...this.members.values()].filter(m => m.is_active && normalizeTaskUsername(m.username) === draft.username);
      if (matches.length !== 1) throw new Error(`assigned:identity:${draft.line}`);
      return matches[0].chat_id;
    });
    return drafts.map((draft, index) => {
      let task = [...this.assignedTasks.values()].find(t => t.source_chat_id === ownerId &&
        t.source_message_id === messageId && t.line === draft.line);
      if (task && (task.username !== draft.username || task.what !== draft.what)) throw new Error("assigned:source_changed");
      if (!task) {
        task = { ...draft, id: this.assignedTasks.size + 1, source_chat_id: ownerId,
          source_message_id: messageId, assignee_id: recipients[index], assigned_by: ownerId,
          created_at: this.clock().toISOString(), delivery_state: "pending", delivered_message_id: null,
          status: "open", status_at: this.clock().toISOString(), reminded_at: null, overdue_notified_at: null };
        this.assignedTasks.set(task.id, task);
      }
      return structuredClone(task);
    });
  }

  async listAssignedTasks(userId: number): Promise<AssignedTask[]> {
    this.maybeFail("listAssignedTasks");
    const member = this.members.get(userId);
    if (!member?.is_active || !member.username) return [];
    return structuredClone([...this.assignedTasks.values()].filter(t => t.assignee_id === userId &&
      normalizeTaskUsername(member.username) === t.username));
  }

  async getAssignedTask(id: number): Promise<AssignedTask | null> {
    this.maybeFail("getAssignedTask");
    return structuredClone(this.assignedTasks.get(id) ?? null);
  }

  async assignedTaskDelivery(id: number, action: "lock" | "sent" | "failed" | "uncertain", messageId?: number): Promise<AssignedTask | null> {
    this.maybeFail("assignedTaskDelivery");
    const task = this.assignedTasks.get(id);
    if (!task) return null;
    if (action === "lock") {
      if (task.delivery_state !== "pending" && task.delivery_state !== "failed") return null;
      task.delivery_state = "sending";
    } else if (action === "sent") {
      if (task.delivery_state !== "sending" || !messageId || messageId <= 0) throw new Error("assigned:state");
      task.delivery_state = "sent";
      task.delivered_message_id = messageId;
    } else if (task.delivery_state === "sending") task.delivery_state = action;
    return structuredClone(task);
  }

  async setAssignedStatus(id: number, actorId: number, action: AssignedAction): Promise<{ task: AssignedTask; previous: AssignedStatus }> {
    this.maybeFail("setAssignedStatus");
    const task = this.assignedTasks.get(id);
    if (!task) throw new Error("assigned:missing");
    const actor = this.members.get(actorId);
    const rules: Record<AssignedAction, [AssignedStatus, AssignedStatus[]]> = {
      take: ["taken", ["open"]], done: ["done", ["open", "taken"]], decline: ["declined", ["open", "taken"]],
      reopen: ["taken", ["done", "declined"]], cancel: ["cancelled", ["open", "taken", "declined"]],
    };
    if (action === "cancel" ? !(actor?.is_active && actor.is_owner) : task.assignee_id !== actorId || !actor?.is_active)
      throw new Error("assigned:actor");
    const [target, allowed] = rules[action];
    const previous = task.status;
    if (previous === target) return { task: structuredClone(task), previous };
    if (!allowed.includes(previous)) throw new Error("assigned:state");
    task.status = target;
    task.status_at = this.clock().toISOString();
    return { task: structuredClone(task), previous };
  }

  async editAssignedTask(id: number, ownerId: number, patch: { what?: string; due?: string | null }): Promise<AssignedTask> {
    this.maybeFail("editAssignedTask");
    const owner = this.members.get(ownerId);
    if (!owner?.is_active || !owner.is_owner) throw new Error("assigned:actor");
    const task = this.assignedTasks.get(id);
    if (!task) throw new Error("assigned:missing");
    if (!isActiveAssigned(task)) throw new Error("assigned:state");
    if (patch.what !== undefined) {
      if (!patch.what.trim() || patch.what.length > 3000) throw new Error("assigned:format");
      task.what = patch.what;
    }
    if (patch.due !== undefined) {
      task.due_at = patch.due;
      task.reminded_at = null;
      task.overdue_notified_at = null;
    }
    return structuredClone(task);
  }

  async listAssignedOverview(since: Date): Promise<AssignedTask[]> {
    this.maybeFail("listAssignedOverview");
    return structuredClone([...this.assignedTasks.values()]
      .filter(t => isActiveAssigned(t) || Date.parse(t.status_at) >= since.getTime()));
  }

  async listAssignedDue(): Promise<AssignedTask[]> {
    this.maybeFail("listAssignedDue");
    return structuredClone([...this.assignedTasks.values()]
      .filter(t => isActiveAssigned(t) && t.due_at && !t.overdue_notified_at));
  }

  async markAssignedNotice(id: number, kind: "reminder" | "overdue"): Promise<boolean> {
    this.maybeFail("markAssignedNotice");
    const task = this.assignedTasks.get(id);
    const field = kind === "reminder" ? "reminded_at" : "overdue_notified_at";
    if (!task || !isActiveAssigned(task) || task[field]) return false;
    task[field] = this.clock().toISOString();
    return true;
  }

  /** Часы для created_at журнала; тест может подменить. */
  clock: () => Date = () => new Date();

  failNext(op: keyof DatabotStore): void {
    this.failing.add(op);
  }

  private maybeFail(op: keyof DatabotStore): void {
    if (this.failing.delete(op)) throw new Error(`memory-store: ${op} failed`);
  }

  async findActiveMember(chatId: number): Promise<MemberRow | null> {
    this.maybeFail("findActiveMember");
    const m = this.members.get(chatId);
    return m && m.is_active ? { ...m } : null;
  }

  async findMember(chatId: number): Promise<MemberRow | null> {
    this.maybeFail("findMember");
    const m = this.members.get(chatId);
    return m ? { ...m } : null;
  }

  async listMembers(): Promise<MemberRow[]> {
    this.maybeFail("listMembers");
    return [...this.members.values()].filter((m) => m.is_active).map((m) => ({ ...m }));
  }

  async touchMember(
    chatId: number,
    patch: { username: string | null; display_name: string | null; is_owner: boolean },
    now: Date,
  ): Promise<void> {
    const m = this.members.get(chatId);
    if (!m || !m.is_active) return;
    Object.assign(m, patch, { last_seen_at: now.toISOString() });
  }

  async upsertMember(
    row: {
      chat_id: number;
      zone: Zone;
      is_owner: boolean;
      invited_by: number | null;
      username: string | null;
      display_name: string | null;
    },
    now: Date,
  ): Promise<MemberRow> {
    this.maybeFail("upsertMember");
    const prev = this.members.get(row.chat_id);
    const next: MemberRow = {
      joined_at: prev?.joined_at ?? now.toISOString(),
      last_seen_at: now.toISOString(),
      ...row,
      is_active: true,
      removed_at: null,
    };
    this.members.set(row.chat_id, next);
    return { ...next };
  }

  async setZone(chatId: number, zone: Zone): Promise<boolean> {
    this.maybeFail("setZone");
    const m = this.members.get(chatId);
    if (!m || !m.is_active) return false;
    m.zone = zone;
    return true;
  }

  async removeMember(chatId: number, now: Date): Promise<boolean> {
    this.maybeFail("removeMember");
    const m = this.members.get(chatId);
    if (!m || !m.is_active) return false;
    m.is_active = false;
    m.removed_at = now.toISOString();
    return true;
  }

  async createInvite(
    row: Pick<InviteRow, "token" | "zone" | "created_by" | "expires_at">,
    now: Date,
  ): Promise<InviteRow> {
    this.maybeFail("createInvite");
    const invite: InviteRow = { ...row, created_at: now.toISOString(), used_at: null, used_by: null };
    this.invites.set(row.token, invite);
    return { ...invite };
  }

  async redeemInvite(
    token: string,
    chatId: number,
    now: Date,
  ): Promise<{ zone: Zone; created_by: number } | null> {
    this.maybeFail("redeemInvite");
    const inv = this.invites.get(token);
    // Те же условия, что в update … where used_at is null and expires_at > now.
    if (!inv || inv.used_at !== null || Date.parse(inv.expires_at) <= now.getTime()) return null;
    inv.used_at = now.toISOString();
    inv.used_by = chatId;
    return { zone: inv.zone, created_by: inv.created_by };
  }

  async findInvite(token: string): Promise<InviteRow | null> {
    this.maybeFail("findInvite");
    const inv = this.invites.get(token);
    return inv ? { ...inv } : null;
  }

  async auditSince(since: Date): Promise<Array<{ chat_id: number; report: string }>> {
    this.maybeFail("auditSince");
    return this.audit
      .filter((a) => Date.parse(a.created_at) >= since.getTime())
      .map((a) => ({ chat_id: a.chat_id, report: a.report }));
  }

  async writeAudit(entry: AuditEntry): Promise<void> {
    this.audit.push({ ...entry, created_at: this.clock().toISOString() });
  }

  async clearSession(chatId: number): Promise<void> {
    this.sessions.delete(`data:${chatId}`);
  }

  async getForm(chatId: number): Promise<FormState | null> {
    this.maybeFail("getForm");
    return asFormState(this.sessions.get(`data:${chatId}`));
  }

  async setForm(chatId: number, form: FormState): Promise<void> {
    this.maybeFail("setForm");
    this.sessions.set(`data:${chatId}`, { ...form });
  }

  async checkRateLimit(key: string): Promise<boolean> {
    return !this.rateLimited.has(key);
  }
}
