import type { Api, Context } from "grammy";
import { DueError, extractDue, parseDue } from "../databot/assigned-due";
import { ASSIGNED_CALLBACK } from "../databot/assigned-view";
import { createSupabaseStore } from "../databot/data/supabase-store";
import type { DatabotStore } from "../databot/data/store";
import { normalizeTaskUsername } from "../databot/tasks";
import { isActiveAssigned, parseTaskList, TaskListError, type AssignedTask } from "../databot/task-list";
import type { Zone } from "../databot/types";
import { findMember, listTeam, type TeamMember } from "./access";
import { isFounder } from "./config";
import {
  TASK_DUE_PROMPT,
  TASK_UPLOAD_PROMPT,
  assignReportText,
  assigneeChangeText,
  authorNoticeText,
  authorTaskCard,
  cancelConfirmScreen,
  escapeHtmlTeam,
  groupKey,
  myTaskCard,
  newTasksText,
  openMyTasksKeyboard,
  parseTaskCallback,
  shortDue,
  taskCb,
  tasksScreen,
  type TaskScreen,
  type TaskTab,
} from "./copy";
import { openTeamForm, supabaseTeamForms, teamFormExpired, type TeamFormStore } from "./form";

/**
 * Задачи «Пятницы».
 *
 * Права: ставить задачи может любой участник (кому угодно и себе); править
 * текст, срок и отменять — автор или фаундер; отмечать статус — только
 * исполнитель. Участник видит только задачи, где он автор или исполнитель;
 * фаундер видит все задачи команды (вкладка «Вся команда», «Выполненные»).
 * Те же правила держит база (045, 048), здесь — понятные ответы.
 *
 * Экраны живут в одном сообщении: /tasks присылает список, всё остальное
 * (вкладки, карточки, «← К списку») редактирует его же.
 */

const TASK_COMMAND = /^\/(tasks|assigned|assign|assign_edit|assign_due|assign_cancel|assign_retry|cancel)(?:@([a-z0-9_]+))?(?=\s|$)/i;

export interface TeamTaskDeps {
  store: DatabotStore;
  findMember: (chatId: number) => Promise<TeamMember | null>;
  listTeam: () => Promise<TeamMember[]>;
  forms: TeamFormStore;
}

function defaultDeps(): TeamTaskDeps {
  return { store: createSupabaseStore(), findMember, listTeam, forms: supabaseTeamForms() };
}

/**
 * RPC задач опираются на databot_members (стабильная привязка Telegram ID).
 * Перед работой с задачами зеркалим туда состав команды; is_owner — признак
 * фаундера, а не роль в team_members.
 */
export async function syncTeamTaskMembers(
  deps: Pick<TeamTaskDeps, "store">,
  now: Date,
  members: TeamMember[],
): Promise<void> {
  if (!members.length) throw new Error("team task roster is empty");
  for (const member of members) {
    const founder = isFounder(member.chat_id);
    const zone: Zone = founder ? "council" : "smm";
    await deps.store.upsertMember({
      chat_id: member.chat_id,
      username: member.username,
      display_name: member.display_name,
      zone,
      is_owner: founder,
      invited_by: member.added_by,
    }, now);
  }
}

/** Ошибки хранилища → человеческий текст. Неизвестное — наверх. */
function storeError(err: unknown): string | null {
  const message = err instanceof Error ? err.message : "";
  if (message.startsWith("assigned:missing")) return "Задача не найдена.";
  if (message.startsWith("assigned:actor")) return "Это может только автор задачи (правка, срок, отмена) или исполнитель (статус).";
  if (message.startsWith("assigned:state")) return "Задача уже закрыта или отменена, действие недоступно.";
  if (message.startsWith("assigned:format")) return "Текст задачи — от 1 до 3000 символов.";
  return null;
}

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

/** Показать экран: в том же сообщении, если пришли кнопкой, иначе новым. */
async function show(ctx: Context, screen: TaskScreen, edit: boolean): Promise<void> {
  const opts = { ...HTML, reply_markup: screen.keyboard };
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(screen.text, opts);
      return;
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      if (text.includes("message is not modified")) return;
    }
  }
  await ctx.reply(screen.text, opts);
}

async function namesOf(deps: TeamTaskDeps): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  for (const m of await deps.listTeam()) if (m.username) map.set(m.chat_id, m.username);
  return map;
}

/** Задачи из этой же строки списка у того же автора. */
function groupOf(tasks: readonly AssignedTask[], task: AssignedTask): AssignedTask[] {
  return tasks.filter((t) => groupKey(t) === groupKey(task)).sort((a, b) => a.id - b.id);
}

/**
 * Доставка: одно сообщение исполнителю на один /assign со всеми его новыми
 * задачами. Каждую задачу запираем перед отправкой (lock) — повторная
 * обработка того же сообщения дублей не пришлёт.
 */
export async function deliverAssigned(
  api: Pick<Api, "sendMessage">,
  store: DatabotStore,
  tasks: readonly AssignedTask[],
  authorName: string | undefined,
  now: Date,
): Promise<void> {
  const byAssignee = new Map<number, AssignedTask[]>();
  for (const t of tasks) byAssignee.set(t.assignee_id, [...(byAssignee.get(t.assignee_id) ?? []), t]);
  for (const [assignee, list] of byAssignee) {
    const locked: AssignedTask[] = [];
    for (const t of list) {
      const l = await store.assignedTaskDelivery(t.id, "lock");
      if (l) locked.push(l);
    }
    if (!locked.length) continue;
    const mates = new Map<number, string[]>();
    for (const t of locked) mates.set(t.id, await store.listAssignedTeammates(t));
    try {
      const sent = await api.sendMessage(assignee, newTasksText(locked, authorName, mates, now),
        { ...HTML, reply_markup: openMyTasksKeyboard() });
      for (const t of locked) await store.assignedTaskDelivery(t.id, "sent", sent.message_id);
    } catch (err) {
      const code = err && typeof err === "object" && "error_code" in err ? Number(err.error_code) : 0;
      for (const t of locked) await store.assignedTaskDelivery(t.id, code >= 400 && code < 500 ? "failed" : "uncertain");
    }
  }
}

/**
 * Команды и кнопки задач. false — апдейт не про задачи, его разбирает
 * остальной бот (забеги, расписание, FAQ).
 */
export async function handleTeamTaskUpdate(ctx: Context, providedDeps?: TeamTaskDeps, now = new Date()): Promise<boolean> {
  if (ctx.chat?.type !== "private" || !ctx.from || ctx.chat.id !== ctx.from.id) return false;
  const text = ctx.message?.text?.trim() ?? "";
  const command = TASK_COMMAND.exec(text);
  if (command?.[2] && ctx.me?.username && command[2].toLowerCase() !== ctx.me.username.toLowerCase()) return false;
  const data = ctx.callbackQuery?.data ?? "";
  const cb = parseTaskCallback(data);
  const legacy = ASSIGNED_CALLBACK.exec(data);
  const isFreeText = !!text && !text.startsWith("/");
  if (!command && !cb && !legacy && !isFreeText) return false;

  const deps = providedDeps ?? defaultDeps();
  const uid = ctx.from.id;

  // Свободный текст наш, только если открыта форма задач.
  let form = null;
  if (isFreeText || command) {
    form = await deps.forms.get(uid);
    if (isFreeText && form?.kind !== "task.upload" && form?.kind !== "task.due") return false;
  }

  if (cb || legacy) await ctx.answerCallbackQuery().catch(() => {});
  const member = await deps.findMember(uid);
  if (!member) {
    if (command || cb || legacy) {
      await ctx.reply("Задачи доступны участникам команды. Войди через /join.");
      return true;
    }
    return false;
  }

  try {
    if (command) {
      const cmd = command[1].toLowerCase();
      // Любая команда закрывает открытую форму; /cancel ещё и говорит об этом.
      if (form) await deps.forms.clear(uid);
      if (cmd === "cancel") {
        if (!form) return false;
        await ctx.reply(form.kind === "task.upload" ? "Загрузка задач отменена." : "Отменила.");
        return true;
      }
      const args = text.slice(command[0].length).trim();
      const importing = cmd === "assign" && !!args;
      await syncTeamTaskMembers(deps, now, importing ? await deps.listTeam() : [member]);
      if (cmd === "tasks" || cmd === "assigned") return await showList(ctx, deps, uid, "me", 0, false, now);
      if (cmd === "assign" && !args) {
        await deps.forms.set(uid, openTeamForm("task.upload", {}, now), now);
        await ctx.reply(TASK_UPLOAD_PROMPT, HTML);
        return true;
      }
      if (cmd === "assign") return await importList(ctx, deps, uid, text, now);
      return await hiddenCommand(ctx, deps, uid, cmd, args, now);
    }

    if (form && isFreeText) {
      if (teamFormExpired(form, now)) {
        await deps.forms.clear(uid);
        await ctx.reply(form.kind === "task.upload"
          ? "Приём списка истёк. Набери /assign и пришли список снова."
          : "Форма устарела. Открой задачу заново.");
        return true;
      }
      if (form.kind === "task.upload") {
        await syncTeamTaskMembers(deps, now, await deps.listTeam());
        return await importList(ctx, deps, uid, text, now);
      }
      await syncTeamTaskMembers(deps, now, [member]);
      return await applyDue(ctx, deps, uid, Number(form.params.id), text, now);
    }

    await syncTeamTaskMembers(deps, now, [member]);
    if (!(await deps.store.checkRateLimit(`team:tasks:${uid}`, 30, 60))) {
      await ctx.reply("Слишком много нажатий. Попробуй через минуту.");
      return true;
    }
    if (legacy) return await pressStatus(ctx, deps, uid, legacy[1] as "take" | "done" | "decline" | "reopen", Number(legacy[2]), now);
    if (!cb) return false;
    switch (cb.kind) {
      case "list": return await showList(ctx, deps, uid, cb.tab, cb.page, true, now);
      case "open": return await openCard(ctx, deps, uid, cb.id, { tab: cb.tab, page: cb.page }, now);
      case "group": return await openGroup(ctx, deps, uid, cb.id, cb.page, now);
      case "status": return await pressStatus(ctx, deps, uid, cb.action, cb.id, now);
      case "due": return await askDue(ctx, deps, uid, cb.id, now);
      case "cancelAsk": return await askCancel(ctx, deps, uid, cb.id);
      case "cancelDo": return await doCancel(ctx, deps, uid, cb.id, now);
    }
  } catch (err) {
    const known = storeError(err);
    if (known) {
      await ctx.reply(known);
      return true;
    }
    console.error("[team-task]", err instanceof Error ? err.message : String(err));
    await ctx.reply("Не удалось открыть задачи. Попробуй ещё раз чуть позже.");
    return true;
  }
  return false;
}

/** Задачи, которые человек видит: свои, а у фаундера — все задачи команды. */
async function visibleTasks(deps: TeamTaskDeps, uid: number): Promise<AssignedTask[]> {
  return isFounder(uid) ? deps.store.listAssignedOverview(new Date(0)) : deps.store.listMyAssigned(uid);
}

async function showList(ctx: Context, deps: TeamTaskDeps, uid: number, tab: TaskTab, page: number, edit: boolean, now: Date): Promise<boolean> {
  const [tasks, names] = await Promise.all([visibleTasks(deps, uid), namesOf(deps)]);
  await show(ctx, tasksScreen(tab, tasks, uid, names, now, page, isFounder(uid)), edit);
  return true;
}

async function myTask(deps: TeamTaskDeps, uid: number, id: number): Promise<{ task: AssignedTask; all: AssignedTask[] } | null> {
  const all = await visibleTasks(deps, uid);
  const task = all.find((t) => t.id === id);
  return task ? { task, all } : null;
}

async function openCard(ctx: Context, deps: TeamTaskDeps, uid: number, id: number, back: { tab: TaskTab; page: number }, now: Date): Promise<boolean> {
  const found = await myTask(deps, uid, id);
  if (!found) {
    await ctx.reply("Задача не найдена.");
    return true;
  }
  const [names, mates] = await Promise.all([namesOf(deps), deps.store.listAssignedTeammates(found.task)]);
  await show(ctx, myTaskCard(found.task, uid, names, mates, now, back, isFounder(uid)), true);
  return true;
}

async function openGroup(ctx: Context, deps: TeamTaskDeps, uid: number, id: number, page: number, now: Date): Promise<boolean> {
  const found = await myTask(deps, uid, id);
  if (!found || found.task.assigned_by !== uid) {
    await ctx.reply("Задача не найдена.");
    return true;
  }
  await show(ctx, authorTaskCard(groupOf(found.all, found.task), now, page), true);
  return true;
}

async function pressStatus(ctx: Context, deps: TeamTaskDeps, uid: number, action: "take" | "done" | "decline" | "reopen", id: number, now: Date): Promise<boolean> {
  let result: Awaited<ReturnType<DatabotStore["setAssignedStatus"]>>;
  try {
    result = await deps.store.setAssignedStatus(id, uid, action);
  } catch (err) {
    const text = storeError(err);
    if (!text) throw err;
    await ctx.reply(text);
    return true;
  }
  const { task, previous } = result;
  const [names, mates] = await Promise.all([namesOf(deps), deps.store.listAssignedTeammates(task)]);
  await show(ctx, myTaskCard(task, uid, names, mates, now, { tab: "me", page: 0 }, isFounder(uid)), true);
  const notice = authorNoticeText(task, previous);
  if (notice && task.assigned_by !== uid) {
    await ctx.api.sendMessage(task.assigned_by, notice, {
      ...HTML,
      reply_markup: { inline_keyboard: [[{ text: "Открыть задачу", callback_data: taskCb.group(task.id, 0) }]] },
    }).catch(() => {});
  }
  return true;
}

/**
 * Чем человек может управлять (срок, отмена): автор — всей строкой списка,
 * фаундер чужую задачу — только ею самой. null — права нет.
 */
async function authoredGroup(deps: TeamTaskDeps, uid: number, id: number): Promise<AssignedTask[] | null> {
  const found = await myTask(deps, uid, id);
  if (!found) return null;
  if (found.task.assigned_by === uid) return groupOf(found.all.filter((t) => t.assigned_by === uid), found.task);
  return isFounder(uid) ? [found.task] : null;
}

/** Автору: фаундер поменял срок или отменил его задачу. */
async function tellAuthor(ctx: Context, deps: TeamTaskDeps, uid: number, task: AssignedTask, change: "due" | "cancel", now: Date): Promise<void> {
  if (task.assigned_by === uid) return;
  const name = (await namesOf(deps)).get(uid);
  const by = name ? `фаундер @${escapeHtmlTeam(name)}` : "фаундер";
  const what = `«${escapeHtmlTeam(task.what)}» для @${escapeHtmlTeam(task.username)}`;
  const text = change === "cancel"
    ? `✖️ Задача ${what} отменена (${by}).`
    : task.due_at ? `🗓 У задачи ${what} новый срок: ${shortDue(task.due_at, now)} (${by}).` : `🗓 У задачи ${what} снят срок (${by}).`;
  await ctx.api.sendMessage(task.assigned_by, text, HTML).catch(() => {});
}

async function askDue(ctx: Context, deps: TeamTaskDeps, uid: number, id: number, now: Date): Promise<boolean> {
  const group = await authoredGroup(deps, uid, id);
  if (!group) {
    await ctx.reply("Срок может поменять только автор задачи или фаундер.");
    return true;
  }
  if (!group.some(isActiveAssigned)) {
    await ctx.reply("Задача уже закрыта у всех исполнителей.");
    return true;
  }
  await deps.forms.set(uid, openTeamForm("task.due", { id: String(id) }, now), now);
  await ctx.reply(TASK_DUE_PROMPT);
  return true;
}

async function applyDue(ctx: Context, deps: TeamTaskDeps, uid: number, id: number, text: string, now: Date): Promise<boolean> {
  const group = await authoredGroup(deps, uid, id);
  if (!group) {
    await deps.forms.clear(uid);
    await ctx.reply("Срок может поменять только автор задачи или фаундер.");
    return true;
  }
  let due: string | null;
  try {
    due = /^(нет|без срока|-)$/i.test(text.trim()) ? null : parseDue(text.replace(/^до\s+/i, ""), now).toISOString();
  } catch (err) {
    if (err instanceof DueError) {
      await ctx.reply(`${err.message} Попробуй ещё раз или /cancel.`);
      return true;
    }
    throw err;
  }
  await deps.forms.clear(uid);
  for (const t of group.filter(isActiveAssigned)) {
    const updated = await deps.store.editAssignedTask(t.id, uid, { due });
    if (updated.assignee_id !== uid)
      await ctx.api.sendMessage(updated.assignee_id, assigneeChangeText(updated, "due", now),
        { ...HTML, reply_markup: openMyTasksKeyboard() }).catch(() => {});
    await tellAuthor(ctx, deps, uid, updated, "due", now);
  }
  const ids = new Set(group.map((t) => t.id));
  const fresh = (await visibleTasks(deps, uid)).filter((t) => ids.has(t.id)).sort((a, b) => a.id - b.id);
  await ctx.reply(due ? "Срок обновлён, исполнители предупреждены." : "Срок снят, исполнители предупреждены.");
  await show(ctx, authorTaskCard(fresh.length ? fresh : group, now), false);
  return true;
}

async function askCancel(ctx: Context, deps: TeamTaskDeps, uid: number, id: number): Promise<boolean> {
  const group = await authoredGroup(deps, uid, id);
  if (!group) {
    await ctx.reply("Отменить задачу может только её автор или фаундер.");
    return true;
  }
  await show(ctx, cancelConfirmScreen(group), true);
  return true;
}

async function doCancel(ctx: Context, deps: TeamTaskDeps, uid: number, id: number, now: Date): Promise<boolean> {
  const group = await authoredGroup(deps, uid, id);
  if (!group) {
    await ctx.reply("Отменить задачу может только её автор или фаундер.");
    return true;
  }
  for (const t of group.filter((x) => x.status !== "done" && x.status !== "cancelled")) {
    const { task, previous } = await deps.store.setAssignedStatus(t.id, uid, "cancel");
    if (previous !== "cancelled" && task.assignee_id !== uid)
      await ctx.api.sendMessage(task.assignee_id, assigneeChangeText(task, "cancel", now), HTML).catch(() => {});
    if (previous !== "cancelled") await tellAuthor(ctx, deps, uid, task, "cancel", now);
  }
  const founder = isFounder(uid);
  const [tasks, names] = await Promise.all([visibleTasks(deps, uid), namesOf(deps)]);
  const tab: TaskTab = group[0].assigned_by === uid ? "by" : "all";
  await show(ctx, tasksScreen(tab, tasks, uid, names, now, 0, founder), true);
  return true;
}

async function importList(ctx: Context, deps: TeamTaskDeps, uid: number, text: string, now: Date): Promise<boolean> {
  const reply = (body: string) => ctx.reply(body, HTML);
  try {
    const drafts = parseTaskList(text, now);
    const members = await deps.store.listMembers();
    for (const draft of drafts) {
      if (members.filter((m) => normalizeTaskUsername(m.username) === draft.username).length !== 1) {
        throw new TaskListError(draft.line, `Ник @${draft.username} не найден среди участников команды. Попроси человека открыть бота и набрать /start.`);
      }
    }
    const tasks = await deps.store.importAssignedTasks(uid, ctx.message!.message_id, drafts);
    await deps.forms.clear(uid);
    const names = await namesOf(deps);
    await deliverAssigned(ctx.api, deps.store, tasks.filter((t) => t.delivery_state === "pending"), names.get(uid), now);
    const fresh = (await Promise.all(tasks.map((t) => deps.store.getAssignedTask(t.id)))).filter((t): t is AssignedTask => !!t);
    await reply(assignReportText(fresh, now));
  } catch (err) {
    if (err instanceof TaskListError) await reply(`Строка ${err.line}: ${escapeHtmlTeam(err.message)} Список не сохранён.`);
    else if (err instanceof Error && err.message.includes("assigned:source_changed"))
      await reply("Это сообщение уже загружено с другим содержимым. Пришли исправленный список новым сообщением.");
    else {
      console.error("[team-task] import:", err instanceof Error ? err.message : String(err));
      await reply("Не удалось сохранить список. Проверь участников и миграции задач (040, 043, 044, 045), затем повтори сообщение.");
    }
  }
  return true;
}

/** Скрытые команды автора: /assign_edit, /assign_due, /assign_cancel, /assign_retry. */
async function hiddenCommand(ctx: Context, deps: TeamTaskDeps, uid: number, cmd: string, args: string, now: Date): Promise<boolean> {
  const usage: Record<string, string> = {
    assign_cancel: "/assign_cancel ID",
    assign_edit: "/assign_edit ID новый текст [до срок]",
    assign_due: "/assign_due ID пт 18:00 (или «нет», чтобы снять срок)",
    assign_retry: "/assign_retry ID [ID…]",
  };
  if (cmd === "assign_retry") {
    const ids = args.split(/[\s,]+/).filter((x) => /^[1-9]\d{0,15}$/.test(x)).map(Number);
    if (!ids.length) {
      await ctx.reply(`Используй ${usage[cmd]}.`);
      return true;
    }
    const tasks = (await Promise.all(ids.map((id) => deps.store.getAssignedTask(id))))
      .filter((t): t is AssignedTask => !!t && t.assigned_by === uid);
    if (tasks.some((t) => t.delivery_state === "uncertain" || t.delivery_state === "sending")) {
      await ctx.reply("Отправка могла пройти. Сначала уточни у исполнителя, иначе может прийти дубль.");
      return true;
    }
    const names = await namesOf(deps);
    await deliverAssigned(ctx.api, deps.store, tasks.filter((t) => t.delivery_state === "pending" || t.delivery_state === "failed"), names.get(uid), now);
    const fresh = (await Promise.all(tasks.map((t) => deps.store.getAssignedTask(t.id)))).filter((t): t is AssignedTask => !!t);
    await ctx.reply(fresh.length && fresh.every((t) => t.delivery_state === "sent")
      ? "Доставлено."
      : "Доставка не подтверждена. Проверь, что исполнитель открыл бота.");
    return true;
  }

  const m = /^([1-9]\d{0,15})(?:\s+([\s\S]*))?$/.exec(args);
  const rest = m?.[2]?.trim() ?? "";
  if (!m || ((cmd === "assign_edit" || cmd === "assign_due") && !rest)) {
    await ctx.reply(`Используй ${usage[cmd]}.`);
    return true;
  }
  const id = Number(m[1]);
  try {
    if (cmd === "assign_cancel") {
      const { task, previous } = await deps.store.setAssignedStatus(id, uid, "cancel");
      if (previous !== "cancelled" && task.assignee_id !== uid)
        await ctx.api.sendMessage(task.assignee_id, assigneeChangeText(task, "cancel", now), HTML).catch(() => {});
      await ctx.reply(previous !== "cancelled" ? "Задача отменена, исполнитель предупреждён." : "Задача уже была отменена.");
    } else if (cmd === "assign_edit") {
      const found = extractDue(rest, now);
      const what = found.what.replace(/[\s,;—–-]+$/u, "").trim();
      const task = await deps.store.editAssignedTask(id, uid, { what: what || undefined, due: found.due ? found.due.toISOString() : undefined });
      if (task.assignee_id !== uid)
        await ctx.api.sendMessage(task.assignee_id, `✏️ Задача изменена: «${escapeHtmlTeam(task.what)}»`, { ...HTML, reply_markup: openMyTasksKeyboard() }).catch(() => {});
      await ctx.reply("Сохранено, исполнитель предупреждён.");
    } else {
      const due = /^(нет|без срока|-)$/i.test(rest) ? null : parseDue(rest.replace(/^до\s+/i, ""), now).toISOString();
      const task = await deps.store.editAssignedTask(id, uid, { due });
      if (task.assignee_id !== uid)
        await ctx.api.sendMessage(task.assignee_id, assigneeChangeText(task, "due", now), { ...HTML, reply_markup: openMyTasksKeyboard() }).catch(() => {});
      await ctx.reply(due ? "Срок обновлён, исполнитель предупреждён." : "Срок снят.");
    }
  } catch (err) {
    if (err instanceof DueError) {
      await ctx.reply(err.message);
      return true;
    }
    throw err;
  }
  return true;
}
