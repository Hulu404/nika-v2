import { formatDue } from "./assigned-due";
import { escapeHtml } from "./html";
import { isActiveAssigned, type AssignedAction, type AssignedStatus, type AssignedTask } from "./task-list";

/**
 * Тексты и кнопки задач из /assign. Ни одного похода в базу: всё, что нужно,
 * приходит аргументами, поэтому экраны проверяются тестами напрямую.
 */

/** callback_data кнопок задач: a:<действие>:<id>. Свой префикс — мимо разбора разделов. */
export const ASSIGNED_CALLBACK = /^a:(take|done|decline|reopen):([1-9]\d{0,15})$/;
export const assignedCallback = (action: Exclude<AssignedAction, "cancel">, id: number) => `a:${action}:${id}`;

/** Первая строка доставки. bot.ts узнаёт по ней сообщение, которое нельзя повторять автоматически. */
export const NEW_TASK_HEADER = "<b>Новая задача от команды</b>";

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
export function taskCard(t: AssignedTask, now: Date, header = `<b>Задача #${t.id}</b>`): string {
  return [header, escapeHtml(t.what), dueLine(t, now), `Статус: ${STATUS_LABEL[t.status]}`]
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

export function deliveryText(t: AssignedTask, now: Date): string {
  return `${taskCard(t, now, NEW_TASK_HEADER)}\n\n#${t.id} · все мои задачи: /tasks`;
}

/** Уведомление владельцу о действии исполнителя. Без глаголов прошедшего времени: род не знаем. */
export function ownerNotice(t: AssignedTask, previous: AssignedStatus): string {
  const who = `@${escapeHtml(t.username)}`;
  const what = escapeHtml(short(t.what, 300));
  if (t.status === "done") return `✅ ${who}: задача #${t.id} — сделано\n${what}`;
  if (t.status === "declined") return `↩️ ${who}: задача #${t.id} — не сможет\n${what}\nНазначить другому — новым /assign, эту закрыть: /assign_cancel ${t.id}`;
  if (t.status === "taken" && previous !== "open") return `🔄 ${who}: задача #${t.id} снова в работе\n${what}`;
  return `${who}: задача #${t.id} — ${STATUS_LABEL[t.status]}`;
}

/** Нужно ли сообщать владельцу. «Взял в работу» видно в /assign_status, лишний пинг не нужен. */
export function ownerShouldKnow(t: AssignedTask, previous: AssignedStatus): boolean {
  return previous !== t.status && (t.status === "done" || t.status === "declined" || (t.status === "taken" && previous !== "open"));
}

export function reminderText(t: AssignedTask, now: Date): string {
  return taskCard(t, now, `⏰ <b>Срок задачи #${t.id}: ${formatDue(t.due_at!)}</b>`);
}

export function overdueText(t: AssignedTask, now: Date): string {
  return taskCard(t, now, `⚠️ <b>Срок задачи #${t.id} прошёл</b>`) + "\nЕсли не успеваешь — нажми «Не смогу», владелец увидит.";
}

export function overdueOwnerText(t: AssignedTask): string {
  return `⚠️ Просрочена задача #${t.id} у @${escapeHtml(t.username)} (срок ${formatDue(t.due_at!)}, ${STATUS_LABEL[t.status]})\n${escapeHtml(short(t.what, 300))}`;
}

export function short(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

const DELIVERY_ISSUE = new Set<AssignedTask["delivery_state"]>(["pending", "failed", "uncertain", "sending"]);

/**
 * Обзор для владельца, по людям. Сначала просроченное, потом по сроку,
 * затем закрытые задачи каждого человека.
 * Возвращает массив сообщений: длинный обзор режем по 4000 символов на
 * границе строк — лимит Telegram 4096.
 */
export function overviewMessages(tasks: AssignedTask[], now: Date): string[] {
  const active = tasks.filter(isActiveAssigned);
  const closed = tasks.filter(t => !isActiveAssigned(t));
  const overdue = active.filter(t => isOverdue(t, now)).length;
  const lines = [`<b>Задачи команды</b> · в работе ${active.length}${overdue ? `, просрочено ${overdue}` : ""}`];
  if (!active.length) lines.push("Открытых задач нет.");
  const byPerson = new Map<string, AssignedTask[]>();
  for (const t of tasks) byPerson.set(t.username, [...(byPerson.get(t.username) ?? []), t]);
  const key = (t: AssignedTask) => [isOverdue(t, now) ? 0 : 1, t.due_at ? Date.parse(t.due_at) : Infinity, t.id];
  const cmp = (a: AssignedTask, b: AssignedTask) => {
    const [x, y] = [key(a), key(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  };
  for (const [username, list] of [...byPerson].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push("", `<b>@${escapeHtml(username)}</b>`);
    for (const t of list.filter(isActiveAssigned).sort(cmp)) {
      const mark = isOverdue(t, now) ? "⚠️" : t.status === "taken" ? "🔄" : "🆕";
      const due = t.due_at ? ` · до ${formatDue(t.due_at)}` : "";
      const mail = DELIVERY_ISSUE.has(t.delivery_state) ? " · 📭 не доставлено" : "";
      lines.push(`${mark} #${t.id} ${escapeHtml(short(t.what, 90))}${due}${mail}`);
    }
    for (const t of list.filter(t => !isActiveAssigned(t))
      .sort((a, b) => Date.parse(b.status_at) - Date.parse(a.status_at) || b.id - a.id)) {
      const icon = t.status === "done" ? "✅" : t.status === "declined" ? "↩️" : "✖️";
      lines.push(`${icon} #${t.id} ${escapeHtml(short(t.what, 90))}`);
    }
  }
  if (closed.length) {
    const count = (s: AssignedStatus) => closed.filter(t => t.status === s).length;
    const parts = ([["done", "✅"], ["declined", "↩️"], ["cancelled", "✖️"]] as const)
      .filter(([s]) => count(s)).map(([s, icon]) => `${icon} ${count(s)}`);
    lines.push("", `Закрыто всего: ${parts.join(" · ")}`);
  }
  lines.push("", "Правка: /assign_edit ID текст · срок: /assign_due ID пт 18:00 · отмена: /assign_cancel ID");
  return chunk(lines, 4000);
}

function chunk(lines: string[], max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const line of lines) {
    const next = cur ? `${cur}\n${line}` : line;
    if (next.length > max && cur) { out.push(cur); cur = line; }
    else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

export const ASSIGN_HELP = [
  "Откройте /tasks и отправьте следующим сообщением:",
  "<code>Подготовить макет / пт 18:00 / @alice",
  "Проверить текст / 03.10 / @bob</code>",
  "Одна задача и один @username в каждой строке. Срок: «пт», «завтра 12:00», «03.10», «18:00».",
  "",
  "Дальше: /assign_status — кто что делает · /assign_edit ID текст · /assign_due ID срок|нет · /assign_cancel ID",
].join("\n");
