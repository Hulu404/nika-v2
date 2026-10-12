import { tgAdmin } from "../../telegram/supabase";
import type { Intent } from "./intent";

/** Черновик живёт час: потом «Создать» не сработает, а очистка его удалит. */
export const DRAFT_TTL_MS = 3_600_000;

/** Что лежит в team_ai_drafts.intent: разбор модели и выбор человека кнопками. */
export interface DraftBody {
  parsed: Intent;
  /** Слот упоминания (a0 — первый исполнитель, p1 — второй участник) → chat_id. */
  picks: Record<string, number>;
  /** Задача, к которой привязано напоминание (по task_hint). */
  taskId?: number | null;
  voice?: boolean;
}

export interface Draft {
  id: number;
  chat_id: number;
  intent: DraftBody;
  source_text: string | null;
  message_id: number | null;
  created_at: string;
  confirmed_at: string | null;
}

export interface DraftStore {
  create(row: { chat_id: number; intent: DraftBody; source_text: string | null }, now: Date): Promise<Draft>;
  get(id: number): Promise<Draft | null>;
  setMessage(id: number, messageId: number): Promise<void>;
  setBody(id: number, body: DraftBody): Promise<void>;
  /** Атомарно: true только у первого нажатия «Создать». */
  confirm(id: number, now: Date): Promise<boolean>;
  remove(id: number): Promise<void>;
  /** Удалить всё старше before. */
  purge(before: Date): Promise<number>;
}

export interface Reminder {
  id: number;
  chat_id: number;
  text: string;
  remind_at: string;
  task_id: number | null;
  sent_at: string | null;
}

export interface ReminderStore {
  create(row: { chat_id: number; text: string; remind_at: string; task_id: number | null }, now: Date): Promise<Reminder>;
  listDue(now: Date): Promise<Reminder[]>;
  /** Атомарно: true только у первого прохода. */
  markSent(id: number, now: Date): Promise<boolean>;
}

export interface ParticipantStore {
  add(eventId: number, chatIds: number[]): Promise<void>;
  /** Участники по событиям; событий без участников в карте нет. */
  forEvents(eventIds: number[]): Promise<Map<number, number[]>>;
}

// ── Supabase ─────────────────────────────────────────────────────────────────

export function supabaseDraftStore(): DraftStore {
  const t = () => tgAdmin().from("team_ai_drafts");
  const fail = (e: { message: string }) => new Error(`team_ai_drafts: ${e.message}`);
  return {
    async create(row, now) {
      const { data, error } = await t().insert({ ...row, created_at: now.toISOString() }).select("*").single();
      if (error) throw fail(error);
      return data as Draft;
    },
    async get(id) {
      const { data, error } = await t().select("*").eq("id", id).maybeSingle();
      if (error) throw fail(error);
      return (data as Draft | null) ?? null;
    },
    async setMessage(id, messageId) {
      const { error } = await t().update({ message_id: messageId }).eq("id", id);
      if (error) throw fail(error);
    },
    async setBody(id, body) {
      const { error } = await t().update({ intent: body }).eq("id", id).is("confirmed_at", null);
      if (error) throw fail(error);
    },
    async confirm(id, now) {
      const { data, error } = await t().update({ confirmed_at: now.toISOString() }).eq("id", id).is("confirmed_at", null).select("id");
      if (error) throw fail(error);
      return (data ?? []).length === 1;
    },
    async remove(id) {
      const { error } = await t().delete().eq("id", id);
      if (error) throw fail(error);
    },
    async purge(before) {
      const { data, error } = await t().delete().lt("created_at", before.toISOString()).select("id");
      if (error) throw fail(error);
      return (data ?? []).length;
    },
  };
}

export function supabaseReminderStore(): ReminderStore {
  const t = () => tgAdmin().from("team_reminders");
  const fail = (e: { message: string }) => new Error(`team_reminders: ${e.message}`);
  return {
    async create(row, now) {
      const { data, error } = await t().insert({ ...row, created_at: now.toISOString() }).select("*").single();
      if (error) throw fail(error);
      return data as Reminder;
    },
    async listDue(now) {
      const { data, error } = await t().select("*").is("sent_at", null).lte("remind_at", now.toISOString()).order("remind_at").limit(100);
      if (error) throw fail(error);
      return (data ?? []) as Reminder[];
    },
    async markSent(id, now) {
      const { data, error } = await t().update({ sent_at: now.toISOString() }).eq("id", id).is("sent_at", null).select("id");
      if (error) throw fail(error);
      return (data ?? []).length === 1;
    },
  };
}

export function supabaseParticipantStore(): ParticipantStore {
  const t = () => tgAdmin().from("team_event_participants");
  return {
    async add(eventId, chatIds) {
      const rows = [...new Set(chatIds)].map((chat_id) => ({ event_id: eventId, chat_id }));
      const { error } = await t().upsert(rows, { onConflict: "event_id,chat_id", ignoreDuplicates: true });
      if (error) throw new Error(`team_event_participants: ${error.message}`);
    },
    async forEvents(eventIds) {
      const map = new Map<number, number[]>();
      if (!eventIds.length) return map;
      const { data, error } = await t().select("event_id, chat_id").in("event_id", eventIds);
      if (error) throw new Error(`team_event_participants: ${error.message}`);
      for (const r of (data ?? []) as Array<{ event_id: number; chat_id: number }>) map.set(r.event_id, [...(map.get(r.event_id) ?? []), r.chat_id]);
      return map;
    },
  };
}

// ── Память (тесты) ───────────────────────────────────────────────────────────

export class MemoryDraftStore implements DraftStore {
  drafts = new Map<number, Draft>();
  private seq = 0;
  async create(row: { chat_id: number; intent: DraftBody; source_text: string | null }, now: Date) {
    const d: Draft = { id: ++this.seq, ...structuredClone(row), message_id: null, created_at: now.toISOString(), confirmed_at: null };
    this.drafts.set(d.id, d);
    return structuredClone(d);
  }
  async get(id: number) {
    const d = this.drafts.get(id);
    return d ? structuredClone(d) : null;
  }
  async setMessage(id: number, messageId: number) {
    const d = this.drafts.get(id);
    if (d) d.message_id = messageId;
  }
  async setBody(id: number, body: DraftBody) {
    const d = this.drafts.get(id);
    if (d && !d.confirmed_at) d.intent = structuredClone(body);
  }
  async confirm(id: number, now: Date) {
    const d = this.drafts.get(id);
    if (!d || d.confirmed_at) return false;
    d.confirmed_at = now.toISOString();
    return true;
  }
  async remove(id: number) {
    this.drafts.delete(id);
  }
  async purge(before: Date) {
    let n = 0;
    for (const [id, d] of this.drafts) if (d.created_at < before.toISOString()) {
      this.drafts.delete(id);
      n++;
    }
    return n;
  }
}

export class MemoryReminderStore implements ReminderStore {
  reminders = new Map<number, Reminder>();
  async create(row: { chat_id: number; text: string; remind_at: string; task_id: number | null }) {
    const r: Reminder = { id: this.reminders.size + 1, ...row, sent_at: null };
    this.reminders.set(r.id, r);
    return { ...r };
  }
  async listDue(now: Date) {
    return [...this.reminders.values()].filter((r) => !r.sent_at && Date.parse(r.remind_at) <= now.getTime()).map((r) => ({ ...r }));
  }
  async markSent(id: number, now: Date) {
    const r = this.reminders.get(id);
    if (!r || r.sent_at) return false;
    r.sent_at = now.toISOString();
    return true;
  }
}

export class MemoryParticipantStore implements ParticipantStore {
  rows = new Map<number, Set<number>>();
  async add(eventId: number, chatIds: number[]) {
    const set = this.rows.get(eventId) ?? new Set<number>();
    for (const c of chatIds) set.add(c);
    this.rows.set(eventId, set);
  }
  async forEvents(eventIds: number[]) {
    const map = new Map<number, number[]>();
    for (const id of eventIds) if (this.rows.has(id)) map.set(id, [...this.rows.get(id)!]);
    return map;
  }
}
