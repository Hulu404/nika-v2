import type { Context } from "grammy";
import { isEnvOwner } from "./access";
import { DueError, extractDue, formatDue, parseDue } from "./assigned-due";
import {
  ASSIGN_HELP, ASSIGNED_CALLBACK, STATUS_LABEL, deliveryText, overviewMessages, ownerNotice,
  ownerShouldKnow, short, taskButtons, taskCard,
} from "./assigned-view";
import type { DatabotStore } from "./data/store";
import { escapeHtml } from "./html";
import { formExpired, openForm } from "./form";
import { parseIntent } from "./intent";
import { setChatCommands } from "./menu";
import { normalizeTaskUsername } from "./tasks";
import { isActiveAssigned, parseTaskList, TaskListError, type AssignedAction, type AssignedTask } from "./task-list";

/** Сколько дней закрытые задачи учитываются в «Моих задачах». */
const CLOSED_VISIBLE_DAYS = 7;

type Buttons = Array<Array<{ text: string; callback_data: string }>>;
const markup = (buttons?: Buttons) => buttons ? { inline_keyboard: buttons } : undefined;

/** Ошибки хранилища → человеческий текст. Неизвестное — наверх. */
function storeError(err: unknown): string | null {
  const message = err instanceof Error ? err.message : "";
  if (message.startsWith("assigned:missing")) return "Задача не найдена.";
  if (message.startsWith("assigned:actor")) return "Это действие доступно только исполнителю задачи или владельцу.";
  if (message.startsWith("assigned:state")) return "Задача уже закрыта или отменена — действие недоступно.";
  if (message.startsWith("assigned:format")) return "Текст задачи — от 1 до 3000 символов.";
  return null;
}

async function sendAssigned(ctx: Context, store: DatabotStore, task: AssignedTask, now: Date): Promise<void> {
  const locked = await store.assignedTaskDelivery(task.id, "lock");
  if (!locked) return;
  try {
    const teammates = await store.listAssignedTeammates(locked);
    const sent = await ctx.api.sendMessage(task.assignee_id, deliveryText(locked, now, teammates),
      { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: markup(taskButtons(locked)) });
    await store.assignedTaskDelivery(task.id, "sent", sent.message_id);
  } catch (err) {
    const code = err && typeof err === "object" && "error_code" in err ? Number(err.error_code) : 0;
    await store.assignedTaskDelivery(task.id, code >= 400 && code < 500 ? "failed" : "uncertain");
  }
}

/** Сообщить исполнителю об изменении: новое сообщение с карточкой, старую доставку — обновить. Не бросает. */
async function tellAssignee(ctx: Context, store: DatabotStore, task: AssignedTask, header: string, now: Date): Promise<void> {
  const teammates = await store.listAssignedTeammates(task);
  if (task.delivered_message_id) {
    await ctx.api.editMessageText(task.assignee_id, task.delivered_message_id, taskCard(task, now, undefined, teammates),
      { parse_mode: "HTML", reply_markup: markup(taskButtons(task)) }).catch(() => {});
  }
  await ctx.api.sendMessage(task.assignee_id, taskCard(task, now, header, teammates),
    { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: markup(taskButtons(task)) }).catch(() => {});
}

/** «Мои задачи» исполнителя: открытые карточками с кнопками, закрытые — одной строкой. */
export async function sendAssignedList(ctx: Context, store: DatabotStore, userId: number, now: Date): Promise<void> {
  const reply = (text: string, buttons?: Buttons) =>
    ctx.reply(text, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: markup(buttons) });
  const all = await store.listAssignedTasks(userId);
  const active = all.filter(isActiveAssigned)
    .sort((a, b) => (a.due_at ? Date.parse(a.due_at) : Infinity) - (b.due_at ? Date.parse(b.due_at) : Infinity) || a.id - b.id);
  const since = now.getTime() - CLOSED_VISIBLE_DAYS * 86_400_000;
  const done = all.filter(t => t.status === "done" && Date.parse(t.status_at) >= since);
  if (!active.length) await reply(done.length
    ? `Открытых задач нет. Сделано за ${CLOSED_VISIBLE_DAYS} дн.: ${done.length}.`
    : "Назначенных вам задач пока нет.");
  else {
    await reply(`<b>Мои задачи</b> · в работе ${active.length}${done.length ? ` · сделано за ${CLOSED_VISIBLE_DAYS} дн.: ${done.length}` : ""}`);
    for (const t of active) await reply(taskCard(t, now, undefined, await store.listAssignedTeammates(t)), taskButtons(t));
  }
  if (done.length) {
    await reply("<b>Выполнено</b>");
    for (const t of done.sort((a, b) => Date.parse(b.status_at) - Date.parse(a.status_at) || b.id - a.id).slice(0, 20))
      await reply(taskCard(t, now, undefined, await store.listAssignedTeammates(t)), taskButtons(t));
  }
}

async function handleButton(ctx: Context, store: DatabotStore, action: Exclude<AssignedAction, "cancel">, id: number, now: Date): Promise<void> {
  const uid = ctx.from!.id;
  const notify = (text: string) => ctx.reply(text, { parse_mode: "HTML" });
  if (!(await store.findActiveMember(uid))) { await notify("Доступ только действующим участникам бота."); return; }
  if (!(await store.checkRateLimit(`databot:assigned:${uid}`, 30, 60))) { await notify("Слишком много нажатий. Попробуйте через минуту."); return; }
  let result: Awaited<ReturnType<DatabotStore["setAssignedStatus"]>>;
  try { result = await store.setAssignedStatus(id, uid, action); }
  catch (err) {
    const text = storeError(err);
    if (!text) throw err;
    const current = await store.getAssignedTask(id).catch(() => null);
    if (current && current.assignee_id === uid) {
      const teammates = await store.listAssignedTeammates(current);
      await ctx.editMessageText(taskCard(current, now, undefined, teammates), { parse_mode: "HTML", reply_markup: markup(taskButtons(current)) }).catch(() => {});
      await notify(`${text} Статус сейчас: ${STATUS_LABEL[current.status]}.`);
    } else await notify(text);
    return;
  }
  const { task, previous } = result;
  const teammates = await store.listAssignedTeammates(task);
  await ctx.editMessageText(taskCard(task, now, undefined, teammates), { parse_mode: "HTML", reply_markup: markup(taskButtons(task)) }).catch(() => {});
  if (ownerShouldKnow(task, previous) && task.assigned_by !== uid) {
    await ctx.api.sendMessage(task.assigned_by, ownerNotice(task, previous), { parse_mode: "HTML" }).catch(() => {});
  }
}

/**
 * Задачи из /assign: список от владельца в личке, кнопки исполнителя, «Мои
 * задачи», обзор и правка. Командный топик не нужен. Возвращает false, если
 * апдейт не про эти задачи, — тогда его разбирает остальной конвейер.
 */
export async function handleAssignedUpdate(
  ctx: Context,
  store: DatabotStore,
  now: Date = new Date(),
  options: { isOwner?: boolean; refreshCommands?: boolean; anyoneAssigns?: boolean } = {},
): Promise<boolean> {
  if (ctx.chat?.type !== "private" || !ctx.from || ctx.chat.id !== ctx.from.id) return false;

  const button = ASSIGNED_CALLBACK.exec(ctx.callbackQuery?.data ?? "");
  if (button) {
    await handleButton(ctx, store, button[1] as Exclude<AssignedAction, "cancel">, Number(button[2]), now);
    return true;
  }
  if (!ctx.message?.text) return false;

  const text = ctx.message.text.trim();
  const command = /^\/(tasks|assign|tasks_add|assigned|assign_retry|assign_status|assign_cancel|assign_edit|assign_due)(?:@([a-z0-9_]+))?(?=\s|$)/i.exec(text);
  if (command?.[2] && command[2].toLowerCase() !== ctx.me.username.toLowerCase()) return false;
  const parsed = !command ? parseIntent({ text, callbackData: null }) : null;
  const myTasks = parsed?.kind === "intent" && parsed.intent.report === "tsk.list";
  const owner = options.anyoneAssigns || (options.isOwner ?? isEnvOwner(ctx.from.id));
  const form = !command && !myTasks && owner ? await store.getForm(ctx.from.id) : null;
  const uploading = form?.kind === "assigned.upload" && !text.startsWith("/");
  if (!command && !myTasks && !uploading) return false;

  const member = await store.findActiveMember(ctx.from.id);
  // Чужим отвечает остальной конвейер — одной общей фразой.
  if (!member) return false;
  // Этот обработчик идёт раньше общего конвейера. При прямом /assign или
  // /tasks обновляем сохранённое в Telegram меню даже без повторного /start.
  if (options.refreshCommands !== false && command && (command[1].toLowerCase() === "assign" || command[1].toLowerCase() === "tasks"))
    await setChatCommands(ctx.api, ctx.from.id, owner ? "council" : member.zone);
  const reply = (body: string, buttons?: Buttons) =>
    ctx.reply(body, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: markup(buttons) });
  const cmd = myTasks ? "tasks" : command?.[1].toLowerCase() ?? "assign";
  const args = text.slice(command?.[0].length ?? 0).trim();

  const canAssign = owner && (options.anyoneAssigns || member.is_owner);
  if (cmd === "tasks" && canAssign && !options.anyoneAssigns) {
    await store.setForm(ctx.from.id, openForm("assigned.upload", {}, now), now);
    await reply("Пришлите список задач одним сообщением: одна строка — одно дело в формате «что делать / дедлайн / @ник + @ник». Каждому указанному исполнителю создаётся своя задача. Например:\n<code>• Подготовить макет / пт 18:00 / @alice + @bob\n• Проверить текст / 03.10 / @bob</code>\nОтмена — /cancel.");
    return true;
  }

  if (cmd === "assigned" || cmd === "tasks") {
    const username = normalizeTaskUsername(ctx.from.username);
    if (!username || normalizeTaskUsername(member.username) !== username) {
      await reply("Telegram-ник изменился или отсутствует. Напишите /start, чтобы обновить профиль, и попросите владельца проверить назначение.");
      return true;
    }
    await sendAssignedList(ctx, store, ctx.from.id, now);
    return true;
  }

  if (!canAssign) {
    await reply("Загружать и править задачи может только владелец бота. Свои задачи — /tasks.");
    return true;
  }

  if (uploading && formExpired(form!, now)) {
    await store.clearSession(ctx.from.id);
    await reply("Режим загрузки задач истёк. Откройте /tasks и пришлите список снова.");
    return true;
  }

  if (command) await store.clearSession(ctx.from.id);

  if (cmd === "assign_status") {
    const tasks = await store.listAssignedOverview(new Date(0));
    for (const message of overviewMessages(tasks, now)) await reply(message);
    return true;
  }

  if (cmd === "assign_cancel" || cmd === "assign_edit" || cmd === "assign_due" || cmd === "assign_retry") {
    const m = /^([1-9]\d{0,15})(?:\s+([\s\S]*))?$/.exec(args);
    const usage: Record<string, string> = {
      assign_cancel: "/assign_cancel ID",
      assign_edit: "/assign_edit ID новый текст [до срок]",
      assign_due: "/assign_due ID пт 18:00 — или «нет», чтобы снять срок",
      assign_retry: "/assign_retry ID",
    };
    const rest = m?.[2]?.trim() ?? "";
    if (!m || ((cmd === "assign_edit" || cmd === "assign_due") && !rest)) { await reply(`Используйте ${usage[cmd]}.`); return true; }
    const id = Number(m[1]);
    try {
      if (cmd === "assign_retry") {
        const task = await store.getAssignedTask(id);
        if (!task || task.assigned_by !== ctx.from.id) await reply("Задача не найдена.");
        else if (task.delivery_state === "uncertain" || task.delivery_state === "sending")
          await reply("Отправка могла пройти. Сначала проверьте личку исполнителя; повтор без проверки может создать дубль.");
        else {
          await sendAssigned(ctx, store, task, now);
          await reply((await store.getAssignedTask(id))?.delivery_state === "sent" ? "Задача доставлена." : "Доставка не подтверждена. Проверьте, что исполнитель открыл бота.");
        }
      } else if (cmd === "assign_cancel") {
        const { task, previous } = await store.setAssignedStatus(id, ctx.from.id, "cancel");
        if (previous !== "cancelled") await tellAssignee(ctx, store, task, `✖️ <b>Задача #${task.id} отменена</b>`, now);
        await reply(`Задача #${task.id} отменена${previous !== "cancelled" ? ", исполнитель предупреждён" : " (уже была)"}.`);
      } else if (cmd === "assign_edit") {
        const found = extractDue(rest, now);
        const what = found.what.replace(/[\s,;—–-]+$/u, "").trim();
        const task = await store.editAssignedTask(id, ctx.from.id,
          { what: what || undefined, due: found.due ? found.due.toISOString() : undefined });
        await tellAssignee(ctx, store, task, `✏️ <b>Задача #${task.id} изменена</b>`, now);
        await reply(`Сохранено, исполнитель предупреждён.\n\n${taskCard(task, now)}`);
      } else {
        const due = /^(нет|без срока|-)$/i.test(rest) ? null : parseDue(rest.replace(/^до\s+/i, ""), now).toISOString();
        const task = await store.editAssignedTask(id, ctx.from.id, { due });
        await tellAssignee(ctx, store, task, due ? `🗓 <b>Новый срок задачи #${task.id}</b>` : `🗓 <b>У задачи #${task.id} больше нет срока</b>`, now);
        await reply(due ? `Срок задачи #${task.id}: ${formatDue(due)}. Исполнитель предупреждён.` : `Срок задачи #${task.id} снят.`);
      }
    } catch (err) {
      if (err instanceof DueError) { await reply(escapeHtml(err.message)); return true; }
      const message = storeError(err);
      if (!message) throw err;
      await reply(message);
    }
    return true;
  }

  if (!args && command && options.anyoneAssigns && cmd === "assign") {
    await store.setForm(ctx.from.id, openForm("assigned.upload", {}, now), now);
    await reply("Пришли список задач одним сообщением: одна строка — одно дело в формате «что делать / дедлайн / @ник + @ник». Каждому исполнителю создаётся своя задача. Например:\n<code>Подготовить макет / пт 18:00 / @alice + @bob\nПроверить текст / 03.10 / @bob</code>\nОтмена — /cancel.");
    return true;
  }
  if (!args && command) {
    await reply(ASSIGN_HELP);
    return true;
  }
  try {
    const drafts = parseTaskList(text, now);
    const members = await store.listMembers();
    for (const draft of drafts) {
      if (members.filter(m => normalizeTaskUsername(m.username) === draft.username).length !== 1) {
        throw new TaskListError(draft.line, `Ник @${draft.username} отсутствует или неоднозначен среди участников. Попросите человека открыть бота и написать /start.`);
      }
    }
    const tasks = await store.importAssignedTasks(ctx.from.id, ctx.message.message_id, drafts);
    if (uploading) await store.clearSession(ctx.from.id);
    for (const task of tasks.filter(t => t.delivery_state === "pending")) await sendAssigned(ctx, store, task, now);
    const fresh = (await Promise.all(tasks.map(t => store.getAssignedTask(t.id)))).filter((t): t is AssignedTask => !!t);
    const sent = fresh.filter(t => t.delivery_state === "sent").length;
    const byLine = new Map<number, AssignedTask[]>();
    for (const task of fresh) byLine.set(task.line, [...(byLine.get(task.line) ?? []), task]);
    const lines = [...byLine.values()].map(group => {
      if (group.length > 1) {
        const first = group[0];
        return `${escapeHtml(short(first.what, 180))} -- ${first.due_at ? formatDue(first.due_at) : "без срока"} -- ` +
          group.map(t => `@${escapeHtml(t.username)}`).join(" + ");
      }
      const t = group[0];
      return `#${t.id} @${escapeHtml(t.username)} — ${escapeHtml(short(t.what, 60))}` +
        `${t.due_at ? ` · до ${formatDue(t.due_at)}` : ""}${t.delivery_state === "sent" ? "" : " · 📭"}`;
    });
    const pending = fresh.length - sent;
    const pendingTasks = fresh.filter(t => t.delivery_state !== "sent")
      .map(t => `#${t.id} @${escapeHtml(t.username)}`).join(", ");
    const report = [
      `Сохранено задач: ${tasks.length}. Доставлено в личку: ${sent}.`,
      ...lines,
      pending ? `\n📭 Не доставлено: ${pending} (${pendingTasks}). Человеку нужно открыть бота, затем /assign_retry ID.` : "",
      "Кто что делает — /assign_status.",
    ].filter(Boolean);
    let chunk = "";
    for (const line of report) {
      if (chunk && chunk.length + line.length + 1 > 3500) {
        await reply(chunk);
        chunk = "";
      }
      chunk += `${chunk ? "\n" : ""}${line}`;
    }
    if (chunk) await reply(chunk);
  } catch (err) {
    if (err instanceof TaskListError) await reply(`Строка ${err.line}: ${escapeHtml(err.message)} Список не сохранён.`);
    else if (err instanceof Error && err.message.includes("assigned:source_changed"))
      await reply("Это сообщение уже загружено с другим содержимым. Пришлите исправленный список новым сообщением.");
    else await reply("Не удалось сохранить список. Проверьте участников и миграции задач (040 и 043), затем повторите сообщение.");
  }
  return true;
}
