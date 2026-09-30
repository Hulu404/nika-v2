import type { Context } from "grammy";
import { isEnvOwner } from "./access";
import type { DatabotStore } from "./data/store";
import { escapeHtml } from "./html";
import { normalizeTaskUsername } from "./tasks";
import { parseTaskList, TaskListError, type AssignedTask } from "./task-list";

async function sendAssigned(ctx: Context, store: DatabotStore, task: AssignedTask): Promise<void> {
  const locked = await store.assignedTaskDelivery(task.id, "lock");
  if (!locked) return;
  try {
    const sent = await ctx.api.sendMessage(task.assignee_id,
      `<b>Новая задача от команды</b>\n${escapeHtml(task.what)}\n\nОткрыть список: /assigned`,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    await store.assignedTaskDelivery(task.id, "sent", sent.message_id);
  } catch (err) {
    const code = err && typeof err === "object" && "error_code" in err ? Number(err.error_code) : 0;
    await store.assignedTaskDelivery(task.id, code >= 400 && code < 500 ? "failed" : "uncertain");
  }
}

/** Private owner upload and private member inbox; no team-group configuration required. */
export async function handleAssignedUpdate(ctx: Context, store: DatabotStore): Promise<boolean> {
  if (ctx.chat?.type !== "private" || !ctx.message?.text || !ctx.from || ctx.chat.id !== ctx.from.id) return false;
  const text = ctx.message.text.trim();
  const command = /^\/(assign|tasks_add|assigned|assign_retry)(?:@([a-z0-9_]+))?(?=\s|$)/i.exec(text);
  const bareList = !text.startsWith("/") && text.includes("\n") &&
    text.split(/\r?\n/).some(line => /@[a-z0-9_]{1,32}/i.test(line));
  if ((!command && !bareList) || (command?.[2] && command[2].toLowerCase() !== ctx.me.username.toLowerCase())) return false;
  const cmd = command?.[1].toLowerCase() ?? "assign";
  const member = await store.findActiveMember(ctx.from.id);
  if (!member) return false;
  const reply = (body: string) => ctx.reply(body, { parse_mode: "HTML" });
  if (cmd === "assigned") {
    const username = normalizeTaskUsername(ctx.from.username);
    if (!username || normalizeTaskUsername(member.username) !== username) {
      await reply("Telegram-ник изменился или отсутствует. Напишите /start, чтобы обновить профиль, и попросите владельца проверить назначение.");
      return true;
    }
    const tasks = await store.listAssignedTasks(ctx.from.id);
    if (!tasks.length) await reply("Назначенных вам задач пока нет.");
    for (const task of tasks.slice(0, 30)) await reply(`#${task.id} · ${escapeHtml(task.what)}`);
    return true;
  }
  if (!isEnvOwner(ctx.from.id) || !member.is_owner) {
    await reply("Загружать списки задач может только владелец бота.");
    return true;
  }
  if (cmd === "assign_retry") {
    const id = Number(text.slice(command![0].length).trim());
    if (!Number.isSafeInteger(id) || id <= 0) { await reply("Используйте /assign_retry ID."); return true; }
    const task = await store.getAssignedTask(id);
    if (!task || task.assigned_by !== ctx.from.id) await reply("Задача не найдена.");
    else if (task.delivery_state === "uncertain" || task.delivery_state === "sending")
      await reply("Отправка могла пройти. Сначала проверьте личку исполнителя; повтор без проверки может создать дубль.");
    else {
      await sendAssigned(ctx, store, task);
      await reply((await store.getAssignedTask(id))?.delivery_state === "sent" ? "Задача доставлена." : "Доставка не подтверждена. Проверьте, что исполнитель открыл бота.");
    }
    return true;
  }
  if (!text.slice(command?.[0].length ?? 0).trim()) {
    await reply("Отправьте одним сообщением:\n<code>/assign\n@alice — Подготовить макет\n@bob — Проверить текст</code>\nОдна задача и один @username в каждой строке.");
    return true;
  }
  try {
    const drafts = parseTaskList(text);
    const members = await store.listMembers();
    for (const draft of drafts) {
      if (members.filter(m => normalizeTaskUsername(m.username) === draft.username).length !== 1) {
        throw new TaskListError(draft.line, `Ник @${draft.username} отсутствует или неоднозначен среди участников. Попросите человека открыть бота и написать /start.`);
      }
    }
    const tasks = await store.importAssignedTasks(ctx.from.id, ctx.message.message_id, drafts);
    for (const task of tasks.filter(t => t.delivery_state === "pending")) await sendAssigned(ctx, store, task);
    const fresh = await Promise.all(tasks.map(t => store.getAssignedTask(t.id)));
    const sent = fresh.filter(t => t?.delivery_state === "sent").length;
    const pending = fresh.length - sent;
    await reply(`Сохранено задач: ${tasks.length}. Доставлено в личку: ${sent}. Требуют проверки доставки: ${pending}. Участники также могут открыть /assigned.`);
  } catch (err) {
    if (err instanceof TaskListError) await reply(`Строка ${err.line}: ${escapeHtml(err.message)} Список не сохранён.`);
    else if (err instanceof Error && err.message.includes("assigned:source_changed"))
      await reply("Это сообщение уже загружено с другим содержимым. Пришлите исправленный список новым сообщением.");
    else await reply("Не удалось сохранить список. Проверьте участников и миграцию 039_databot_assigned_tasks.sql, затем повторите сообщение.");
  }
  return true;
}
