import { tgAdmin } from "../../telegram/supabase";
import { NIKA, isMissingTable } from "../projects/projects";
import type { ChatMessage } from "./yandex";

/**
 * Память диалога ассистента: последние реплики, открытый черновик и последний
 * показанный список с номерами. Хранится только в team_ai_turns и
 * team_ai_state (миграция 055); в логи и другие таблицы тексты не попадают.
 * Реплики — отдельно по проекту (team_ai_turns.project_id, миграция 058):
 * разговор в RESCAN не всплывает в NIKA. Черновик и список сбрасываются
 * при переключении проекта (bot.ts).
 */

export const TURNS_KEPT = 12;
export const TURNS_TTL_MS = 6 * 3_600_000;
export const TURN_MAX_CHARS = 600;
/** История в запросе к модели — не больше этого суммарно; старые реплики отбрасываются первыми. */
export const HISTORY_MAX_CHARS = 8_000;

export function trimHistory(turns: readonly Turn[], max = HISTORY_MAX_CHARS): Turn[] {
  const out: Turn[] = [];
  let total = 0;
  for (const t of [...turns].reverse()) {
    if (total + t.content.length > max) break;
    total += t.content.length;
    out.unshift(t);
  }
  return out;
}

export type TurnRole = "user" | "assistant" | "tool";

export interface Turn {
  role: TurnRole;
  content: string;
  created_at: string;
}

/** Последний показанный список: «вторая» — это items[1]. */
export interface ShownList {
  kind: "tasks" | "events" | "reminders" | "people";
  items: Array<{ n: number; id: number; label: string }>;
}

export interface AiState {
  draft_id: number | null;
  last_list: ShownList | null;
}

export interface TurnStore {
  add(chatId: number, role: TurnRole, content: string, now: Date, projectId?: string): Promise<void>;
  /** Последние реплики в проекте (не больше 12, не старше 6 часов) по порядку. */
  recent(chatId: number, now: Date, projectId?: string): Promise<Turn[]>;
}

export interface StateStore {
  get(chatId: number): Promise<AiState>;
  setDraft(chatId: number, draftId: number | null, now: Date): Promise<void>;
  setList(chatId: number, list: ShownList | null, now: Date): Promise<void>;
}

const cut = (s: string) => (s.length > TURN_MAX_CHARS ? `${s.slice(0, TURN_MAX_CHARS - 1)}…` : s);

export function supabaseTurnStore(): TurnStore {
  const t = () => tgAdmin().from("team_ai_turns");
  // До миграции 058 колонки project_id нет — тогда одна общая память, как раньше.
  let projects = true;
  const off = (e: { message: string } | null) => {
    if (e && projects && isMissingTable(e.message)) {
      projects = false;
      return true;
    }
    return false;
  };
  return {
    async add(chatId, role, content, now, projectId = NIKA) {
      const row: Record<string, unknown> = { chat_id: chatId, role, content: cut(content), created_at: now.toISOString() };
      let { error } = await t().insert(projects ? { ...row, project_id: projectId } : row);
      if (off(error)) ({ error } = await t().insert(row));
      if (error) throw new Error(`team_ai_turns: ${error.message}`);
      // Старше 6 часов — удалить; сверх 12 последних в проекте — тоже.
      await t().delete().eq("chat_id", chatId).lt("created_at", new Date(now.getTime() - TURNS_TTL_MS).toISOString());
      const mine = () => (projects ? t().select("id").eq("chat_id", chatId).eq("project_id", projectId) : t().select("id").eq("chat_id", chatId));
      const { data } = await mine().order("created_at", { ascending: false }).range(TURNS_KEPT, TURNS_KEPT + 100);
      const old = ((data ?? []) as Array<{ id: number }>).map((r) => r.id);
      if (old.length) await t().delete().in("id", old);
    },
    async recent(chatId, now, projectId = NIKA) {
      const query = () => {
        const q = t().select("role, content, created_at").eq("chat_id", chatId);
        return (projects ? q.eq("project_id", projectId) : q)
          .gte("created_at", new Date(now.getTime() - TURNS_TTL_MS).toISOString())
          .order("created_at", { ascending: false }).limit(TURNS_KEPT);
      };
      let { data, error } = await query();
      if (off(error)) ({ data, error } = await query());
      if (error) throw new Error(`team_ai_turns: ${error.message}`);
      return ((data ?? []) as Turn[]).reverse();
    },
  };
}

export function supabaseStateStore(): StateStore {
  const t = () => tgAdmin().from("team_ai_state");
  return {
    async get(chatId) {
      const { data, error } = await t().select("draft_id, last_list").eq("chat_id", chatId).maybeSingle();
      if (error) throw new Error(`team_ai_state: ${error.message}`);
      const row = data as AiState | null;
      return { draft_id: row?.draft_id ?? null, last_list: row?.last_list ?? null };
    },
    async setDraft(chatId, draftId, now) {
      const { error } = await t().upsert({ chat_id: chatId, draft_id: draftId, updated_at: now.toISOString() }, { onConflict: "chat_id" });
      if (error) throw new Error(`team_ai_state: ${error.message}`);
    },
    async setList(chatId, list, now) {
      const { error } = await t().upsert({ chat_id: chatId, last_list: list, updated_at: now.toISOString() }, { onConflict: "chat_id" });
      if (error) throw new Error(`team_ai_state: ${error.message}`);
    },
  };
}

export class MemoryTurnStore implements TurnStore {
  turns = new Map<string, Turn[]>();
  async add(chatId: number, role: TurnRole, content: string, now: Date, projectId = NIKA) {
    const key = `${chatId}:${projectId}`;
    const fresh = (this.turns.get(key) ?? []).filter((x) => Date.parse(x.created_at) >= now.getTime() - TURNS_TTL_MS);
    fresh.push({ role, content: cut(content), created_at: now.toISOString() });
    this.turns.set(key, fresh.slice(-TURNS_KEPT));
  }
  async recent(chatId: number, now: Date, projectId = NIKA) {
    return (this.turns.get(`${chatId}:${projectId}`) ?? []).filter((x) => Date.parse(x.created_at) >= now.getTime() - TURNS_TTL_MS).slice(-TURNS_KEPT);
  }
}

export class MemoryStateStore implements StateStore {
  states = new Map<number, AiState>();
  async get(chatId: number) {
    return structuredClone(this.states.get(chatId) ?? { draft_id: null, last_list: null });
  }
  async setDraft(chatId: number, draftId: number | null, _now?: Date) {
    this.states.set(chatId, { ...(await this.get(chatId)), draft_id: draftId });
  }
  async setList(chatId: number, list: ShownList | null, _now?: Date) {
    this.states.set(chatId, { ...(await this.get(chatId)), last_list: list ? structuredClone(list) : null });
  }
}

/** След вызова инструмента текстом — модель копирует такой формат и выдумывает результаты. */
export const FABRICATION_MARKERS = /сделано:|ассистент:|shown_to_user|"id"\s*:|\{"/i;

/**
 * Сообщения для модели: системная инструкция (с контекстом), прошлые реплики,
 * новое сообщение. В истории — только реплики человека и финальные ответы
 * ассистента: вызовы инструментов и их результаты текстом сюда не попадают
 * никогда (по ним модель училась «вызывать» инструменты строкой). Внутри
 * сообщения инструменты идут только в нативном формате API (agent.ts).
 */
export function dialogMessages(system: string, turns: readonly Turn[], userText: string): ChatMessage[] {
  return [
    { role: "system", text: system },
    ...turns
      .filter((t) => t.role === "user" || (t.role === "assistant" && !FABRICATION_MARKERS.test(t.content)))
      .map((t): ChatMessage => ({ role: t.role as "user" | "assistant", text: t.content })),
    { role: "user", text: userText },
  ];
}

const LIST_NAMES = { tasks: "задач", events: "событий", reminders: "напоминаний", people: "людей" } as const;

/** «Последний показанный список задач: №1 = id 37 «Анонс…» (@ananas_2711), №2 = …» — из реальных данных, без JSON. */
export function shownListText(list: ShownList | null): string | null {
  if (!list?.items.length) return null;
  return `Последний показанный список ${LIST_NAMES[list.kind]}: ${list.items.map((i) => `№${i.n} = id ${i.id} ${i.label}`).join(", ")}`;
}
