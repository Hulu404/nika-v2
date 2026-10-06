import type { ReportId, Section } from "./types";

/**
 * Формы бота данных: шаг, на котором бот ждёт от человека текст (число для
 * плана явки, текст статьи справочника, основа кода метки). Состояние лежит в
 * tg_sessions под ключом data:<chat_id> и живёт 10 минут.
 *
 * Порядок для текста — один на весь бот (pipeline.ts):
 *   • пока форма активна, текст человека идёт в неё, а не в разбор вопроса;
 *   • /cancel и ЛЮБАЯ другая команда форму закрывают;
 *   • нажатие кнопки форму не трогает;
 *   • срок вышел — «Форма устарела», текст никуда не уходит.
 */
export const FORM_TTL_MS = 10 * 60 * 1000;

/** Какая форма ждёт ответа. Каждая — отчёт каталога, чтобы зона проверялась как у кнопок. */
export type FormKind = "run.plan" | "kb.edit" | "kb.new";
const FORM_KINDS: readonly FormKind[] = ["run.plan", "kb.edit", "kb.new"];

/** Куда уходит ответ формы: тот же отчёт и раздел, что у кнопки, — зона проверяется так же. */
export const FORM_ROUTE: Record<FormKind, { report: ReportId; section: Section; action: string }> = {
  "run.plan": { report: "run.plan.set", section: "run", action: "plan_submit" },
  // Правка и новая статья — оба шага идут одним отчётом kb.edit (совет).
  "kb.edit": { report: "kb.edit", section: "kb", action: "edit_text" },
  "kb.new": { report: "kb.edit", section: "kb", action: "new_text" },
};

export interface FormState {
  kind: FormKind;
  /** Проверенные параметры (спот, дата…), с которыми форму открыли. */
  params: Record<string, string>;
  /** ISO-момент, после которого форма устарела. */
  expiresAt: string;
}

export function openForm(kind: FormKind, params: Record<string, string>, now: Date): FormState {
  return { kind, params, expiresAt: new Date(now.getTime() + FORM_TTL_MS).toISOString() };
}

export function formExpired(form: FormState, now: Date): boolean {
  return Date.parse(form.expiresAt) <= now.getTime();
}

/** Из jsonb tg_sessions — только форма правильного вида, иначе null. */
export function asFormState(value: unknown): FormState | null {
  const v = value as Partial<FormState> | null;
  if (!v || typeof v !== "object") return null;
  if (!v.kind || !FORM_KINDS.includes(v.kind)) return null;
  if (typeof v.expiresAt !== "string" || !v.params || typeof v.params !== "object") return null;
  return { kind: v.kind, params: v.params as Record<string, string>, expiresAt: v.expiresAt };
}
