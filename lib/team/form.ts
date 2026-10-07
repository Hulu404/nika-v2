import { tgAdmin } from "../telegram/supabase";

/**
 * Формы «Пятницы»: шаг, на котором бот ждёт следующим сообщением текст (список
 * задач, новый срок, время события, число пришедших).
 *
 * Хранятся в tg_sessions под своим ключом data:team:<chat_id>, отдельно от форм
 * «Цифр команды» (data:<chat_id>): один и тот же человек может открыть форму в
 * обоих ботах, и ответ не должен уехать не туда. Префикс data: оставлен ради
 * ежедневной уборки бота данных: она стирает брошенные data:% старше суток.
 *
 * Правила те же, что у форм бота данных: форма живёт 10 минут, любая команда
 * её закрывает, кнопки не трогают.
 */

export const TEAM_FORM_TTL_MS = 10 * 60 * 1000;

export type TeamFormKind =
  | "task.upload"   // ждём список задач после /assign
  | "task.due"      // автор меняет срок задачи: params.id
  | "event.new"     // ждём строку события после «Добавить событие»
  | "event.draft"   // событие разобрано, ждём кнопки типа, клуба и рассылки
  | "event.time"    // новое время события: params.id
  | "attend"        // число пришедших: params.key
  | "social.ig";    // число подписчиков Instagram: params.pending — ждёт «Да»

const KINDS: readonly TeamFormKind[] = ["task.upload", "task.due", "event.new", "event.draft", "event.time", "attend", "social.ig"];

export interface TeamForm {
  kind: TeamFormKind;
  params: Record<string, string>;
  expiresAt: string;
}

export function openTeamForm(kind: TeamFormKind, params: Record<string, string>, now: Date, ttlMs = TEAM_FORM_TTL_MS): TeamForm {
  return { kind, params, expiresAt: new Date(now.getTime() + ttlMs).toISOString() };
}

export function teamFormExpired(form: TeamForm, now: Date): boolean {
  return Date.parse(form.expiresAt) <= now.getTime();
}

function asTeamForm(value: unknown): TeamForm | null {
  const v = value as Partial<TeamForm> | null;
  if (!v || typeof v !== "object" || !v.kind || !KINDS.includes(v.kind)) return null;
  if (typeof v.expiresAt !== "string" || !v.params || typeof v.params !== "object") return null;
  return { kind: v.kind, params: v.params as Record<string, string>, expiresAt: v.expiresAt };
}

export interface TeamFormStore {
  get(chatId: number): Promise<TeamForm | null>;
  set(chatId: number, form: TeamForm, now: Date): Promise<void>;
  clear(chatId: number): Promise<void>;
}

const key = (chatId: number) => `data:team:${chatId}`;

export function supabaseTeamForms(): TeamFormStore {
  return {
    async get(chatId) {
      const { data, error } = await tgAdmin().from("tg_sessions").select("value").eq("key", key(chatId)).maybeSingle();
      if (error) throw new Error(`team form: ${error.message}`);
      return data ? asTeamForm((data as { value: unknown }).value) : null;
    },
    async set(chatId, form, now) {
      const { error } = await tgAdmin()
        .from("tg_sessions")
        .upsert({ key: key(chatId), value: form, updated_at: now.toISOString() }, { onConflict: "key" });
      if (error) throw new Error(`team form: ${error.message}`);
    },
    async clear(chatId) {
      // Не бросает: застрявший шаг формы — меньшее зло, чем упавшая «Отмена».
      const { error } = await tgAdmin().from("tg_sessions").delete().eq("key", key(chatId));
      if (error) console.error("[team-form] clear:", error.message);
    },
  };
}

/** Для тестов. */
export class MemoryTeamForms implements TeamFormStore {
  forms = new Map<number, TeamForm>();
  async get(chatId: number) {
    return asTeamForm(this.forms.get(chatId) ?? null);
  }
  async set(chatId: number, form: TeamForm) {
    this.forms.set(chatId, { ...form });
  }
  async clear(chatId: number) {
    this.forms.delete(chatId);
  }
}
