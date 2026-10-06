import { formatDue } from "./assigned-due";
import { escapeHtml } from "./html";
import { isActiveAssigned, type AssignedAction, type AssignedStatus, type AssignedTask } from "./task-list";

/**
 * Карточки задач из /assign для напоминаний (assigned-reminders.ts) и
 * callback_data статусных кнопок. Экраны задач «Пятницы» — lib/team/copy.ts.
 * Ни одного похода в базу.
 */

/** callback_data кнопок задач: a:<действие>:<id>. Свой префикс — мимо разбора разделов. */
export const ASSIGNED_CALLBACK = /^a:(take|done|decline|reopen):([1-9]\d{0,15})$/;
export const assignedCallback = (action: Exclude<AssignedAction, "cancel">, id: number) => `a:${action}:${id}`;

export const STATUS_LABEL: Record<AssignedStatus, string> = {
  open: "🆕 новая",
  taken: "🔄 в работе",
  done: "✅ сделано",
  declined: "↩️ не сможет",
  cancelled: "✖️ отменена",
};

type Button = { text: string; callback_data: string };

export function isOverdue(t: AssignedTask, now: Date): boolean {
  return isActiveAssigned(t) && !!t.due_at && Date.parse(t.due_at) <= now.getTime();
}

export function dueLine(t: AssignedTask, now: Date): string | null {
  if (!t.due_at) return null;
  return isOverdue(t, now) ? `Срок: ${formatDue(t.due_at)} — ⚠️ просрочена` : `Срок: ${formatDue(t.due_at)}`;
}

/** Карточка задачи для исполнителя. */
export function taskCard(t: AssignedTask, now: Date, header = `<b>Задача #${t.id}</b>`, teammates: string[] = []): string {
  const together = teammates.length ? `Вместе с вами: ${teammates.map(name => `@${escapeHtml(name)}`).join(", ")}` : null;
  return [header, escapeHtml(t.what), dueLine(t, now), together, `Статус: ${STATUS_LABEL[t.status]}`]
    .filter((l): l is string => l !== null).join("\n");
}

/** Кнопки исполнителя: только переходы, которые разрешит база. */
export function taskButtons(t: AssignedTask): Button[][] | undefined {
  const b = (text: string, action: Exclude<AssignedAction, "cancel">) => ({ text, callback_data: assignedCallback(action, t.id) });
  switch (t.status) {
    case "open": return [[b("Взял в работу", "take"), b("Сделано", "done")], [b("Не смогу", "decline")]];
    case "taken": return [[b("Сделано", "done"), b("Не смогу", "decline")]];
    case "done": return [[b("Вернуть в работу", "reopen")]];
    case "declined": return [[b("Всё-таки возьму", "reopen")]];
    case "cancelled": return undefined;
  }
}

const HOURS_LABEL: Record<number, string> = { 24: "24 часа", 12: "12 часов", 3: "3 часа" };

/** Напоминание называет порог: «Через 12 часов срок: пт 03.10, 18:00». */
export function reminderText(t: AssignedTask, now: Date, teammates: string[] = [], hours?: number): string {
  const head = hours && HOURS_LABEL[hours]
    ? `⏰ <b>Через ${HOURS_LABEL[hours]} срок: ${formatDue(t.due_at!)}</b>`
    : `⏰ <b>Срок задачи #${t.id}: ${formatDue(t.due_at!)}</b>`;
  return taskCard(t, now, head, teammates);
}

export function overdueText(t: AssignedTask, now: Date, teammates: string[] = []): string {
  return taskCard(t, now, `⚠️ <b>Срок задачи #${t.id} прошёл</b>`, teammates) + "\nЕсли не успеваешь, нажми «Не смогу», автор увидит.";
}

export function overdueOwnerText(t: AssignedTask): string {
  return `⚠️ Просрочена задача #${t.id} у @${escapeHtml(t.username)} (срок ${formatDue(t.due_at!)}, ${STATUS_LABEL[t.status]})\n${escapeHtml(short(t.what, 300))}`;
}

export function short(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
