import type { Context } from "grammy";
import type { Message } from "grammy/types";
import { isEnvOwner } from "./access";
import { parseIntent } from "./intent";
import { cb } from "./callback";
import { escapeHtml } from "./html";
import { STRANGER_TEXT } from "./copy";
import { sendAssignedList } from "./assigned-handler";
import { databotTaskConfig } from "./config";
import type { DatabotStore } from "./data/store";
import { normalizeTaskUsername, parseTask, TaskError, taskError, validResultUrl, type TaskRow } from "./tasks";

const ERRORS: Record<string, string> = {
  format: "Нужны строки «Что: …», «Кто делает: @username», «К какому дню и часу: 2026-10-01T18:00+03:00». Если нужна ссылка: «Ссылка на результат: да».",
  identity: "Привязка исполнителя не подтверждена, ник отсутствует, изменился или неоднозначен. Владелец проверяет Telegram ID и выполняет /task_bind ID_задачи Telegram_ID в личке. Обновите профиль через /start; при совпадающих никах это нужно всем затронутым участникам.",
  member: "Доступ только действующим участникам бота. Сначала /start по приглашению.",
  missing: "Задача не найдена.", state: "Действие недоступно: задача уже взята, завершена или относится к другому чату.",
  limit: "У вас уже четыре активные задачи. Сначала завершите одну.",
  result: "Для завершения нужна корректная ссылка http:// или https:// на результат.",
  telegram_rights: "Боту нужны права администратора командного чата, публикации сообщений и закрепления. Задача не взята.",
  publication: "Публикация задачи ещё не подтверждена. Проверьте /mytasks и повторите закрепление или отправку.",
};
const id = (s?: string) => s && /^[1-9]\d*$/.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : taskError("format");
const taskCommands = new Set(["tasks", "mytasks", "task_take", "task_done", "task_bind", "task_rebind", "task_retry", "task_reset_send", "task_import", "task_ids", "task_recover"]);
const rule = "Сначала можно взять до четырёх задач. Затем новую можно взять только после завершения одной из ранее взятых, когда освободится слот. Одновременно активных задач не больше четырёх.";
const dueText = (iso: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) + " МСК";
const sourceLink = (t: TaskRow) => `https://t.me/c/${String(-t.chat_id).replace(/^100/, "")}/${t.message_id}`;

/** Runs before private report routing; never exposes report handlers to groups. */
export async function handleTaskUpdate(ctx: Context, store: DatabotStore): Promise<boolean> {
  const config = databotTaskConfig();
  const chat = ctx.chat;
  if (!chat) return false;
  const msg = ctx.message ?? ctx.editedMessage;
  const parts = (ctx.message?.text ?? "").trim().split(/\s+/);
  const commandParts = parts[0].split("@");
  const cmd = commandParts[0].replace(/^\//, "");
  const command = parts[0].startsWith("/") && taskCommands.has(cmd) &&
    (!commandParts[1] || commandParts[1].toLowerCase() === ctx.me.username.toLowerCase());
  const parsed = parseIntent({ text: ctx.message?.text ?? null, callbackData: ctx.callbackQuery?.data ?? null });
  const taskIntent = parsed.kind === "intent" && parsed.intent.section === "tsk" ? parsed.intent : null;
  const taskButton = !!taskIntent && ctx.chat?.type === "private";
  const group = chat.type === "group" || chat.type === "supergroup";
  if (group && chat.id !== config?.chatId) return false;
  if (!group && (!command && !taskButton || chat.type !== "private")) return false;
  const reply = async (text: string, buttons?: Array<Array<{ text: string; callback_data: string }>>) => {
    await ctx.reply(text, { parse_mode: "HTML", message_thread_id: group ? msg?.message_thread_id : undefined,
      reply_markup: buttons ? { inline_keyboard: buttons } : undefined, link_preview_options: { is_disabled: true } });
  };
  let auditReport: "tsk.list" | "tsk.take" | "tsk.done" = taskIntent?.report === "tsk.take" ? "tsk.take" : taskIntent?.report === "tsk.done" ? "tsk.done" :
    cmd === "task_take" ? "tsk.take" : cmd === "task_done" ? "tsk.done" : "tsk.list";
  let auditOk = false;
  let auditError: string | null = null;
  let auditZone: "council" | "events" | "smm" | null = null;
  try {
    if (!config && !group && (!ctx.from?.id || !(await store.findActiveMember(ctx.from.id)))) {
      await reply(STRANGER_TEXT);
      return true;
    }
    if (!config) {
      if (!group && (cmd === "tasks" || cmd === "mytasks" || taskIntent?.report === "tsk.list")) {
        const uid = ctx.from?.id;
        if (!uid || !(await store.findActiveMember(uid))) taskError("member");
        await sendAssignedList(ctx, store, uid, new Date());
      } else await reply("Задачи ещё не настроены: нужны DATABOT_TASK_CHAT_ID и DATABOT_TASK_SOURCE_THREAD_IDS.");
      return true;
    }
    const thread = msg?.message_thread_id;
    if (group && (!thread || (!config.sourceThreads.includes(thread) && thread !== config.workThread))) return true;
    const uid = ctx.from?.id;
    const owner = !!uid && isEnvOwner(uid) && !!(await store.findActiveMember(uid));
    if (group) {
      if (command && cmd === "task_ids" && owner) {
        await reply(`chat_id=${chat.id}; message_thread_id=${thread}; user_id=${uid}`); return true;
      }
      if (command && cmd === "task_recover" && owner) {
        const original = ctx.message?.reply_to_message;
        const taskId = id(parts[1]);
        const task = await store.getTask(taskId);
        if (!task?.claim || task.claim.work_chat_id !== chat.id || task.claim.work_thread_id !== thread) taskError("state");
        if (!original || original.from?.id !== ctx.me.id || original.message_thread_id !== thread ||
            !original.text?.startsWith(`Задача #${taskId}\n`)) taskError("state");
        const t = await store.taskDelivery(taskId, "recover", original.message_id);
        if (t) await publishTask(ctx, store, t);
        await reply("Сообщение привязано; закрепление проверено."); return true;
      }
      if (!config.sourceThreads.includes(thread!)) return true;
      let source: Message | undefined;
      let existingOnly = false;
      if (ctx.message?.pinned_message && "text" in ctx.message.pinned_message) source = ctx.message.pinned_message as Message;
      else if (command && cmd === "task_import") {
        if (!owner || ctx.message?.sender_chat) return true;
        source = ctx.message?.reply_to_message;
        if (!source) taskError("format");
      } else if (ctx.editedMessage) { source = ctx.editedMessage; existingOnly = true; }
      if (!source || source.from?.id === ctx.me.id || !source.text || source.chat.id !== config.chatId || !source.message_thread_id ||
          !config.sourceThreads.includes(source.message_thread_id)) return true;
      if (existingOnly && !(await store.findSourceTask(source.chat.id, source.message_id))) return true;
      let parsed;
      try { parsed = parseTask(source.text); }
      catch (err) {
        if (existingOnly) {
          await store.invalidateSourceTask(source.chat.id, source.message_id, source.edit_date ?? source.date, source.text);
          return true;
        }
        throw err;
      }
      const task = await store.importTask({ ...parsed, chat_id: source.chat.id, message_id: source.message_id,
        message_thread_id: source.message_thread_id, source_text: source.text,
        source_version: source.edit_date ?? source.date, source_was_pinned: !!ctx.message?.pinned_message }, existingOnly);
      if (task && !existingOnly) await reply(`Задача #${task.id} в пуле. Владелец подтверждает исполнителя: /task_bind ${task.id} Telegram_ID в личке.`);
      return true;
    }
    if (!uid || uid !== chat.id) taskError("member");
    const member = await store.findActiveMember(uid);
    if (!member) taskError("member");
    auditZone = member.zone;
    if (!(await store.checkRateLimit(`databot:tasks:${uid}`, 30, 60))) { await reply("Слишком много запросов. Попробуйте через минуту."); return true; }
    const username = normalizeTaskUsername(ctx.from?.username);
    if (cmd === "task_ids") { await reply(`user_id=${uid}`); return true; }
    if (cmd === "tasks" || cmd === "mytasks" || taskIntent?.report === "tsk.list") {
      const matches = (await store.listMembers()).filter(m => normalizeTaskUsername(m.username) === username);
      if (!username || matches.length !== 1 || matches[0].chat_id !== uid) taskError("identity");
      const available = await store.listAvailableTasks(config.chatId);
      const active = await store.listActiveTasks(uid, config.chatId);
      const free = 4 - active.length;
      await reply(`<b>Мои задачи</b> · свободных слотов: ${free}/4\n${rule}`);
      const mine = available.filter(t => t.assignee_id === uid && t.bound_username === username);
      if (!mine.length) await reply("Доступных задач для вашего подтверждённого ника нет.");
      for (const t of mine.slice(0, 20)) await reply(`#${t.id} · ${escapeHtml(t.what.slice(0, 2400))}\nСрок: ${dueText(t.due_at)}`,
        free > 0 ? [[{ text: "Взять задачу", callback_data: cb("tsk", "take", t.id) }]] : undefined);
      if (!active.length) await reply("Активных задач нет.");
      for (const t of active.filter(t => t.status === "active").slice(0, 20)) await reply(`#${t.id} · ${escapeHtml(t.what.slice(0, 2400))}\nОтправка: ${t.claim?.send_state}; закрепление: ${t.claim?.pin_state}.\nСрок: ${dueText(t.due_at)}`,
        [[t.claim?.send_state === "sent" && t.claim.pin_state === "pinned"
          ? { text: "Завершить", callback_data: cb("tsk", "done", t.id) }
          : { text: "Повторить публикацию", callback_data: cb("tsk", "retry", t.id) }]]);
      for (const t of active.filter(t => t.status === "completing").slice(0, 20)) await reply(`#${t.id} · Завершение в Telegram не подтверждено; слот занят.`,
        [[{ text: "Повторить оформление", callback_data: cb("tsk", "done", t.id) }]]);
      await reply("Задачи, назначенные владельцем: /assigned");
      auditOk = true;
      return true;
    }
    const taskId = taskIntent?.params.task ? id(taskIntent.params.task) : id(parts[1]);
    if (cmd === "task_bind" || cmd === "task_rebind") {
      if (!owner) taskError("member");
      const target = id(parts[2]);
      if (!(await store.findActiveMember(target))) taskError("member");
      // Live Telegram profile + explicit ID from admin, never resolve a username to an ID.
      const profile = await ctx.api.getChat(target);
      if (profile.type !== "private" || !profile.username) taskError("identity");
      const t = await store.getTask(taskId);
      if (!t || t.chat_id !== config.chatId) taskError("missing");
      if (cmd === "task_bind") {
        const matches = (await store.listMembers()).filter(m => normalizeTaskUsername(m.username) === t.assignee_username);
        if (normalizeTaskUsername(profile.username) !== t.assignee_username || matches.length !== 1 || matches[0].chat_id !== target) {
          await reply("Ник не совпадает точно или неоднозначен. Проверьте человека по Telegram ID, обновите профили через /start. Явное исправление владельцем: /task_rebind ID_задачи Telegram_ID."); return true;
        }
      }
      await store.bindTask(taskId, target, profile.username, uid);
      await reply("Привязка подтверждена. Исполнителю нужно обновить профиль через /start, если ник изменился.");
    } else if (cmd === "task_take" || taskIntent?.action === "take") {
      const source = await store.getTask(taskId);
      if (!source || source.chat_id !== config.chatId || !config.sourceThreads.includes(source.message_thread_id)) taskError("missing");
      const targetThread = config.workThread ?? source.message_thread_id;
      await checkPublishRights(ctx, config.chatId);
      const t = await store.takeTask(taskId, uid, username, config.chatId, targetThread);
      const sent = await publishTask(ctx, store, t);
      if (!sent || sent.claim?.pin_state !== "pinned") {
        await reply(`Задача #${taskId} записана за вами, но публикация или закрепление не завершены. Проверьте /mytasks и используйте /task_retry ${taskId}; повторное взятие не создаст копию.`);
        auditError = "telegram_pending";
      } else {
        await reply(`Задача #${taskId} взята, опубликована и закреплена. Свободные слоты: ${(4 - (await store.listActiveTasks(uid, config.chatId)).length)}/4.`);
        auditOk = true;
      }
    } else if (cmd === "task_done" || taskIntent?.report === "tsk.done") {
      const current = await store.getTask(taskId);
      if (current?.chat_id !== config.chatId) taskError("missing");
      if (current.status === "active" && (current.claim?.send_state !== "sent" || current.claim.pin_state !== "pinned")) taskError("publication");
      if (current.requires_result && !parts[2] && current.status === "active") {
        await reply(`Для завершения задачи #${taskId} пришлите ссылку командой <code>/task_done ${taskId} https://…</code>.`);
        auditError = "result_required";
        return true;
      }
      if (parts[2] && !validResultUrl(parts[2])) taskError("result");
      const done = await store.completeTask(taskId, uid, username, parts[2] ?? null);
      const finished = await finalizeTask(ctx, store, done);
      await reply(finished ? `Задача #${taskId} завершена; закрепления сняты.` :
        `Завершение задачи #${taskId} ещё не подтверждено Telegram; слот остаётся занятым. Повторите кнопку «Завершить» или /task_done ${taskId}.`);
      auditOk = finished;
      if (!finished) auditError = "telegram_pending";
    } else if (cmd === "task_retry" || taskIntent?.action === "retry") {
      const t = (await store.listActiveTasks(uid, config.chatId)).find(t => t.id === taskId);
      if (!t) taskError("missing");
      const sent = await publishTask(ctx, store, t);
      await reply(sent?.claim?.pin_state === "pinned" ? "Публикация закреплена." :
        "Отправка или закрепление не завершены. Если состояние sending/uncertain, владелец отвечает /task_recover ID на уже опубликованное сообщение в рабочем топике.");
      auditOk = sent?.claim?.pin_state === "pinned";
    } else if (cmd === "task_reset_send") {
      if (!owner || parts[2] !== "no_message") taskError("state");
      const t = await store.getTask(taskId);
      if (t?.chat_id !== config.chatId) taskError("missing");
      await store.taskDelivery(taskId, "reset_send");
      await reply(`После проверки отсутствия сообщения отправка задачи #${taskId} снова разрешена. Исполнитель повторяет /task_retry ${taskId}.`);
      auditOk = true;
    } else await reply("В группе: /task_import ответом на задачу; в личке: /tasks, /mytasks, /task_take ID, /task_done ID [ссылка].");
  } catch (err) {
    auditError = err instanceof TaskError ? err.message : "operation_failed";
    await reply(err instanceof TaskError ? (ERRORS[err.message] ?? "Действие недоступно.") : "Не удалось выполнить операцию. Проверьте /mytasks перед повтором; взятие могло сохраниться.");
  } finally {
    if (!group && ctx.from?.id && auditZone) await store.writeAudit({ chat_id: ctx.from.id, zone: auditZone,
      report: auditReport, params: {}, source: ctx.callbackQuery ? "button" : "command", ok: auditOk, error: auditError,
      raw_text: null });
  }
  return true;
}

async function checkPublishRights(ctx: Context, chatId: number): Promise<void> {
  try {
    const self = await ctx.api.getChatMember(chatId, ctx.me.id);
    if (self.status !== "administrator" && self.status !== "creator") taskError("telegram_rights");
    if (self.status === "administrator" && !self.can_pin_messages) taskError("telegram_rights");
  } catch { taskError("telegram_rights"); }
}

async function publishTask(ctx: Context, store: DatabotStore, task: TaskRow): Promise<TaskRow | null> {
  let t = task;
  if (t.claim?.send_state === "pending" || t.claim?.send_state === "rejected") {
    const locked = await store.taskDelivery(t.id, "lock");
    if (!locked?.claim) return store.getTask(t.id);
    t = locked;
    try {
      // No retry on ambiguous network errors: Telegram sendMessage has no idempotency key.
      const sent = await ctx.api.sendMessage(t.claim!.work_chat_id,
        taskMessage(t), {
          message_thread_id: t.claim!.work_thread_id,
          parse_mode: "HTML", link_preview_options: { is_disabled: true },
        });
      t = (await store.taskDelivery(t.id, "sent", sent.message_id))!;
    } catch (err) {
      const code = err && typeof err === "object" && "error_code" in err ? Number(err.error_code) : 0;
      await store.taskDelivery(t.id, code >= 400 && code < 500 ? "rejected" : "uncertain");
      return store.getTask(t.id);
    }
  }
  if (t.claim?.work_message_id && t.claim.pin_state !== "pinned") {
    try {
      await ctx.api.pinChatMessage(t.claim.work_chat_id, t.claim.work_message_id, { disable_notification: true });
      t = (await store.taskDelivery(t.id, "pinned"))!;
    } catch { t = (await store.taskDelivery(t.id, "failed"))!; }
  }
  return t;
}

function taskMessage(t: TaskRow, done = false): string {
  const what = escapeHtml(t.what);
  const body = done ? `<s>${what}</s>` : what;
  const prefix = done ? "✅ Выполнено\n" : "";
  return `${prefix}Задача #${t.id}\nЧто: ${body}\nКто делает: @${escapeHtml(t.bound_username ?? t.assignee_username)}\nСрок: ${dueText(t.due_at)}\nИсточник: <a href="${sourceLink(t)}">исходная задача</a>`;
}

async function finalizeTask(ctx: Context, store: DatabotStore, task: TaskRow): Promise<boolean> {
  if (task.status === "done") return true;
  const c = task.claim;
  if (!c?.work_message_id) return false;
  const step = async (needed: boolean, run: () => Promise<unknown>, ok: Parameters<DatabotStore["taskDelivery"]>[1], fail: Parameters<DatabotStore["taskDelivery"]>[1]) => {
    if (!needed) return;
    try { await run(); await store.taskDelivery(task.id, ok); }
    catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : "";
      if ((ok.endsWith("unpinned") && /not found|not pinned/.test(message)) ||
          (ok === "edited" && /message is not modified/.test(message))) await store.taskDelivery(task.id, ok);
      else await store.taskDelivery(task.id, fail);
    }
  };
  await step(c.work_unpin_state !== "done", () => ctx.api.unpinChatMessage(c.work_chat_id, c.work_message_id!), "work_unpinned", "work_unpin_failed");
  await step(task.source_was_pinned && c.source_unpin_state !== "done", () => ctx.api.unpinChatMessage(task.chat_id, task.message_id), "source_unpinned", "source_unpin_failed");
  await step(c.edit_state !== "done", () => ctx.api.editMessageText(c.work_chat_id, c.work_message_id!, taskMessage(task, true), { parse_mode: "HTML", link_preview_options: { is_disabled: true } }), "edited", "edit_failed");
  const updated = await store.getTask(task.id);
  if (updated?.claim?.work_unpin_state === "done" &&
    (!task.source_was_pinned || updated.claim.source_unpin_state === "done") && updated.claim.edit_state === "done") {
    return (await store.taskDelivery(task.id, "finish"))?.status === "done";
  }
  return false;
}
