import { Api, type Context } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import { createSupabaseStore } from "../../databot/data/supabase-store";
import type { DatabotStore } from "../../databot/data/store";
import { normalizeTaskUsername } from "../../databot/tasks";
import { isActiveAssigned, type AssignedTask, type AssignedTaskDraft } from "../../databot/task-list";
import { findMember, listTeam, type TeamMember } from "../access";
import { isFounder, teamBotConfigured, teamToken } from "../config";
import { assigneeChangeText, escapeHtmlTeam, openMyTasksKeyboard, taskCb } from "../copy";
import { DEPARTMENTS } from "../departments";
import { supabaseEventStore, type TeamEventStore } from "../events";
import { openTeamForm, supabaseTeamForms, type TeamForm, type TeamFormStore } from "../form";
import { personLabel, personName, resolveMention } from "../roster";
import { deliverAssigned, syncTeamTaskMembers } from "../tasks";
import { runAgent } from "./agent";
import { applyAnswer, clarifyMessage, expandCompact, NOT_HEARD_TEXT, parseAssigneeAnswer, parseTimeAnswer } from "./clarify";
import { missingOf, mskLocalToDate, type Intent, type Mention } from "./intent";
import { dialogMessages, shownListText, supabaseStateStore, supabaseTurnStore, type StateStore, type TurnStore } from "./memory";
import { listName, renderOpPreview, renderPreview, slotsOf, whenText, type OpData } from "./preview";
import { assistantPrompt } from "./prompt";
import {
  DRAFT_TTL_MS,
  supabaseDraftStore,
  supabaseParticipantStore,
  supabaseReminderStore,
  type Draft,
  type DraftBody,
  type DraftStore,
  type ParticipantStore,
  type ReminderStore,
} from "./stores";
import { executeTool, TOOL_SPECS, type ToolContext } from "./tools";
import { AI_FAIL_TEXT, TeamAiError, VOICE_MAX_BYTES, VOICE_MAX_SECONDS, aiErrorText, defaultTeamAi, teamAiConfig, type TeamAi } from "./yandex";

/**
 * «Пятница» как диалоговый ассистент. Сюда попадает только то, что не
 * разобрали кнопки меню, команды и формы (порядок — lib/team/bot.ts).
 *
 * Сообщение уходит в модель вместе с памятью диалога, открытым черновиком и
 * последним показанным списком; модель отвечает словами или вызывает
 * инструменты (tools.ts). Правила, которые держит код:
 *   • автор и права — по ctx.from.id, никогда по тексту;
 *   • любое изменение данных — только после «✅ Подтвердить», с повторной
 *     проверкой прав теми же функциями, что у кнопок; чтение — сразу;
 *   • модель не трогает базу: только через инструменты;
 *   • в модель не уходят телефоны, участники забегов и невидимые отправителю задачи;
 *   • голосовое не сохраняется: буфер живёт в памяти до распознавания.
 */

export const VOICE_TOO_LONG_TEXT = "Голосовое длиннее 30 секунд, такие я пока не разбираю. Разбей на части или напиши текстом.";

export interface AssistantDeps {
  /** null — голос и текст выключены (нет ключей или TEAM_AI_ENABLED ≠ true). */
  ai: TeamAi | null;
  drafts: DraftStore;
  reminders: ReminderStore;
  participants: ParticipantStore;
  events: TeamEventStore;
  tasks: DatabotStore;
  forms: TeamFormStore;
  turns: TurnStore;
  state: StateStore;
  listTeam: () => Promise<TeamMember[]>;
  findMember: (chatId: number) => Promise<TeamMember | null>;
  downloadVoice: (ctx: Context, fileId: string) => Promise<Uint8Array>;
  showSchedule: (ctx: Context, range: "today" | "tomorrow" | "week" | "next_week") => Promise<void>;
  myDay: (member: TeamMember, now: Date) => Promise<string>;
}

/** Голосовое из Telegram — в память, никуда не пишем. */
async function downloadVoice(ctx: Context, fileId: string): Promise<Uint8Array> {
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) throw new TeamAiError("api", "telegram: no file_path");
  const res = await fetch(`https://api.telegram.org/file/bot${teamToken()}/${file.file_path}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new TeamAiError("api", `telegram file: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Боевые зависимости; экраны «Расписание» и «Мой день» подставляет bot.ts. */
export function defaultAssistantDeps(screens: Pick<AssistantDeps, "showSchedule" | "myDay">): AssistantDeps {
  return {
    ai: teamAiConfig() ? defaultTeamAi() : null,
    drafts: supabaseDraftStore(),
    reminders: supabaseReminderStore(),
    participants: supabaseParticipantStore(),
    events: supabaseEventStore(),
    tasks: createSupabaseStore(),
    forms: supabaseTeamForms(),
    turns: supabaseTurnStore(),
    state: supabaseStateStore(),
    listTeam,
    findMember,
    downloadVoice,
    ...screens,
  };
}

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
const expired = (d: Draft, now: Date) => Date.parse(d.created_at) + DRAFT_TTL_MS <= now.getTime();

/**
 * Голос → текст; null — уже ответили (длинное, пустое, ошибка). Пустое или
 * короче секунды — «Не расслышала»: черновик и вопрос не трогаем.
 */
async function utterance(ctx: Context, deps: AssistantDeps, uid: number): Promise<{ text: string; voice: boolean } | null> {
  const voice = ctx.message?.voice;
  if (!voice) return { text: (ctx.message?.text ?? "").trim(), voice: false };
  if (voice.duration > VOICE_MAX_SECONDS || (voice.file_size ?? 0) > VOICE_MAX_BYTES) {
    await ctx.reply(VOICE_TOO_LONG_TEXT);
    return null;
  }
  if (voice.duration < 1) {
    await ctx.reply(NOT_HEARD_TEXT);
    return null;
  }
  await ctx.replyWithChatAction("typing").catch(() => {});
  const ogg = await deps.downloadVoice(ctx, voice.file_id);
  const text = (await deps.ai!.transcribe(uid, ogg, voice.duration)).trim();
  if (text.length < 2) {
    await ctx.reply(NOT_HEARD_TEXT);
    return null;
  }
  return { text, voice: true };
}

async function linkedTaskText(deps: AssistantDeps, body: DraftBody): Promise<string | null> {
  if (!body.taskId) return null;
  return (await deps.tasks.getAssignedTask(body.taskId))?.what ?? null;
}

/** Данные для предпросмотра изменения: задачи, событие, напоминание. */
async function opData(deps: AssistantDeps, p: Intent, uid: number): Promise<OpData> {
  const ids = p.intent === "set_task_status" || p.intent === "update_task" ? p.task_ids : [];
  const tasks = (await Promise.all(ids.map((id) => deps.tasks.getAssignedTask(id)))).filter((t): t is AssignedTask => !!t);
  const event = p.intent === "update_event" || p.intent === "cancel_event" ? await deps.events.get(p.event_id) : null;
  const reminder = p.intent === "cancel_reminder" ? (await deps.reminders.listMine(uid)).find((r) => r.id === p.reminder_id) ?? null : null;
  return { tasks, event, reminder };
}

const isCreate = (p: Intent) => p.intent === "create_task" || p.intent === "create_event" || p.intent === "create_reminder";

async function renderView(deps: AssistantDeps, draftId: number, body: DraftBody, team: TeamMember[], uid: number, now: Date) {
  return isCreate(body.parsed)
    ? renderPreview(draftId, body, team, uid, now, await linkedTaskText(deps, body))
    : renderOpPreview(draftId, body.parsed, await opData(deps, body.parsed, uid), team, uid, now);
}

type Where = "reply" | "edit-message" | "edit-callback";

/**
 * Показать черновик: не хватает обязательного поля — один вопрос с тем, что
 * уже понято, и кнопками быстрого ответа; иначе предпросмотр. Правка открытого
 * черновика обновляет то же сообщение. Пока черновик открыт, висит форма
 * ai.edit: кнопка меню или команда его закроют.
 */
async function present(ctx: Context, deps: AssistantDeps, draft: Draft, body: DraftBody, team: TeamMember[], uid: number, now: Date, where: Where): Promise<void> {
  await deps.state.setDraft(uid, draft.id, now);
  await deps.forms.set(uid, openTeamForm("ai.edit", { draft: String(draft.id) }, now), now);
  const field = missingOf(body.parsed)[0];
  if (field) {
    const asked = (body.asked ?? 0) + 1;
    const next: DraftBody = { ...body, awaiting: field, asked, failures: 0 };
    await deps.drafts.setBody(draft.id, next);
    console.warn(`[team-ai] clarify: ${body.parsed.intent} awaiting=${field} attempt=${asked}`);
    const q = clarifyMessage(draft.id, next, field, team, uid, now, false);
    const msg = await ctx.reply(q.text, { ...HTML, reply_markup: q.keyboard });
    await deps.drafts.setMessage(draft.id, msg.message_id);
    return;
  }
  const next: DraftBody = { ...body, awaiting: undefined, failures: 0 };
  await deps.drafts.setBody(draft.id, next);
  const view = await renderView(deps, draft.id, next, team, uid, now);
  const opts = { ...HTML, reply_markup: view.keyboard };
  if (where === "edit-callback") {
    await ctx.editMessageText(view.text, opts).catch(() => {});
    return;
  }
  if (where === "edit-message" && draft.message_id && !draft.intent.awaiting) {
    const ok = await ctx.api.editMessageText(uid, draft.message_id, view.text, opts).then(() => true, (e: unknown) => String(e).includes("not modified"));
    if (ok) return;
  }
  const msg = await ctx.reply(view.text, opts);
  await deps.drafts.setMessage(draft.id, msg.message_id);
}

/** Открытый черновик для модели: что в нём, кого нашёл код, что спрашиваем. */
function draftContext(draft: Draft, team: TeamMember[], uid: number): string {
  const body = draft.intent;
  const people = slotsOf(body, team, uid).map((s) => s.department ? `${s.department.group}: ${s.people.map(personName).join(", ")}`
    : s.member ? personLabel(s.member, uid) : `«${s.mention.name}» — не найден однозначно`);
  return [
    "Открытый черновик (человек видит предпросмотр; меняет данные только кнопка «✅ Подтвердить»).",
    "Если сообщение — правка черновика, вызови тот же инструмент заново со всеми полями, исправив нужное: предпросмотр обновится.",
    `Черновик: ${JSON.stringify(body.parsed)}`,
    ...(people.length ? [`Люди в черновике: ${people.join("; ")}`] : []),
    ...(body.awaiting ? [`Сейчас бот спросил: ${body.awaiting === "assignees" ? "кому поставить задачу" : "время"}.`] : []),
  ].join("\n");
}

/** Ответ на вопрос бота кодом, без модели: время, человек, отдел. */
function codeAnswer(draft: Draft, text: string, team: TeamMember[], uid: number, now: Date): DraftBody | null {
  const field = draft.intent.awaiting;
  if (!field) return null;
  const p = draft.intent.parsed;
  if (field === "assignees") {
    const who = parseAssigneeAnswer(text, team, uid);
    return who ? applyAnswer(draft.intent, field, who) : null;
  }
  const at = parseTimeAnswer(text, "date" in p ? p.date ?? null : null, now);
  return at ? applyAnswer(draft.intent, field, at) : null;
}

const callSummary = (c: { name: string; arguments: Record<string, unknown>; result: string }) =>
  `${c.name}(${JSON.stringify(c.arguments).slice(0, 160)}) → ${c.result.slice(0, 200)}`;

/**
 * Свободный текст или голосовое участника: диалог с моделью и инструментами.
 * false — голос и текст выключены, ответит старый путь.
 */
export async function handleAiMessage(ctx: Context, member: TeamMember, deps: AssistantDeps, now = new Date(), preset?: { text: string; voice: boolean }): Promise<boolean> {
  if (!deps.ai) return false;
  const uid = member.chat_id;
  try {
    const said = preset ?? (await utterance(ctx, deps, uid));
    if (!said) return true;
    await deps.ai.checkLimit(uid);
    const team = await deps.listTeam();
    const state = await deps.state.get(uid);
    let draft = state.draft_id ? await deps.drafts.get(state.draft_id) : null;
    if (draft && (draft.chat_id !== uid || draft.confirmed_at || expired(draft, now))) draft = null;

    // Ответ на вопрос бота («в 18», «Сальме») разбирает код — модель не нужна.
    const answered = draft ? codeAnswer(draft, said.text, team, uid, now) : null;
    if (draft && answered) {
      await present(ctx, deps, draft, answered, team, uid, now, "edit-message");
      await deps.turns.add(uid, "user", said.text, now);
      await deps.turns.add(uid, "tool", "ответ на вопрос принят, черновик показан", now);
      return true;
    }

    const shown = { preview: false, list: false };
    const tctx: ToolContext = {
      ctx, uid, team, now, saidText: said.text, voice: said.voice, state,
      tasks: deps.tasks, events: deps.events, reminders: deps.reminders, shown,
      showSchedule: deps.showSchedule,
      myDay: (at) => deps.myDay(member, at),
      setList: async (list) => {
        state.last_list = list;
        await deps.state.setList(uid, list, now);
      },
      upsertDraft: async (body) => {
        if (draft) await present(ctx, deps, draft, body, team, uid, now, "edit-message");
        else {
          const created = await deps.drafts.create({ chat_id: uid, intent: body, source_text: said.text }, now);
          await present(ctx, deps, created, body, team, uid, now, "reply");
          draft = created;
        }
        draft = (await deps.drafts.get(draft!.id)) ?? draft;
      },
    };
    const system = assistantPrompt({ now, team, senderId: uid, draft: draft ? draftContext(draft, team, uid) : null, list: shownListText(state.last_list) });
    const turns = await deps.turns.recent(uid, now);
    const run = await runAgent({
      ai: deps.ai, messages: dialogMessages(system, turns, said.text), tools: TOOL_SPECS,
      execute: (call) => executeTool(tctx, call),
      onStep: () => ctx.replyWithChatAction("typing").then(() => {}, () => {}),
    });
    await deps.ai.recordLlm(uid, run.tokensIn, run.tokensOut);

    // Предпросмотр говорит сам за себя; вопрос модели после него — показываем.
    const text = run.text.trim();
    if (text && (!shown.preview || /\?\s*$/.test(text))) await ctx.reply(text);
    else if (!text && !shown.preview && !shown.list) await ctx.reply(AI_FAIL_TEXT);

    await deps.turns.add(uid, "user", said.text, now);
    if (run.calls.length) await deps.turns.add(uid, "tool", run.calls.map(callSummary).join("; "), now);
    if (text) await deps.turns.add(uid, "assistant", text, now);
  } catch (err) {
    console.error("[team-ai]", err instanceof Error ? err.message : String(err));
    await ctx.reply(aiErrorText(err)).catch(() => {});
  }
  return true;
}

/** Закрыть открытый черновик (кнопка меню или команда посреди него). */
export async function closeAiDraft(api: Pick<Api, "editMessageText">, drafts: DraftStore, uid: number, form: TeamForm): Promise<void> {
  if (form.kind !== "ai.edit") return;
  const draft = await drafts.get(Number(form.params.draft)).catch(() => null);
  if (!draft || draft.chat_id !== uid || draft.confirmed_at) return;
  await drafts.remove(draft.id).catch(() => {});
  if (draft.message_id) await api.editMessageText(uid, draft.message_id, "Черновик закрыт.").catch(() => {});
}

const CALLBACK_RE = /^ai:(ok|x|pk|as|ad|tm|sel):(\d+)(?::([ap]\d{1,2}|-?\d+|[a-z_]+)(?::(-?\d+))?)?$/;

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const tasksWord = (n: number) => `${n} ${plural(n, "задачу", "задачи", "задач")}`;

/** Люди из упоминаний (человек или все участники отдела). */
function membersOf(team: TeamMember[], ms: Mention[] | undefined, uid: number): TeamMember[] {
  return (ms ?? []).flatMap((m) => {
    const r = resolveMention(team, m, uid);
    return r.kind === "one" ? [r.member] : r.kind === "department" ? r.members : [];
  });
}

/** «✅ Подтвердить»: те же функции и проверки прав, что у кнопок и /assign. Возвращает текст итога. */
async function confirm(ctx: Context, deps: AssistantDeps, draft: Draft, uid: number, now: Date): Promise<string> {
  const p = draft.intent.parsed;
  const team = await deps.listTeam();
  const author = team.find((m) => m.chat_id === uid);
  const authorTag = author?.username ? `@${author.username}` : (author ? personName(author) : "участник команды");
  const founder = isFounder(uid);
  if (p.intent === "create_task" || p.intent === "set_task_status" || p.intent === "update_task") await syncTeamTaskMembers({ store: deps.tasks }, now, team);
  const tell = (chat: number, text: string) => (chat === uid ? Promise.resolve() : ctx.api.sendMessage(chat, text, HTML).then(() => {}, () => {}));

  if (p.intent === "create_task") {
    const slots = slotsOf(draft.intent, team, uid);
    const usernames = [...new Set(slots.flatMap((s) => s.people).map((m) => normalizeTaskUsername(m.username)!))];
    const members = await deps.tasks.listMembers();
    for (const u of usernames) {
      if (members.filter((m) => normalizeTaskUsername(m.username) === u).length !== 1) return `Не нашла @${u} среди участников задач. Попроси человека открыть бота и набрать /start.`;
    }
    const due = p.due ? mskLocalToDate(p.due).toISOString() : null;
    const drafts: AssignedTaskDraft[] = usernames.map((username) => ({ line: 1, username, what: p.what, due_at: due }));
    const tasks = await deps.tasks.importAssignedTasks(uid, draft.message_id ?? draft.id, drafts);
    await deliverAssigned(ctx.api, deps.tasks, tasks.filter((t) => t.delivery_state === "pending"), author?.username ?? undefined, now);
    // Кто — в именительном, без собранных кодом склонений: «Маша», «SMM», «ты».
    return `✅ Задача поставлена: ${slots.map((s) => listName(s, uid)).join(", ")}, ${due ? `срок ${whenText(due)}` : "без срока"}`;
  }

  if (p.intent === "create_reminder") {
    const at = mskLocalToDate(p.remind_at).toISOString();
    await deps.reminders.create({ chat_id: uid, text: p.text, remind_at: at, task_id: draft.intent.taskId ?? null }, now);
    return `✅ Напомню ${whenText(at)}: ${p.text}`;
  }

  if (p.intent === "create_event") {
    const slots = slotsOf(draft.intent, team, uid);
    const ev = await deps.events.create({
      // Клуб модель не называет: ивент клуба создаётся кнопками в «Расписании», отсюда — встреча или событие.
      kind: p.kind === "meeting" ? "meeting" : "other",
      club: null, title: p.title, starts_at: mskLocalToDate(p.starts_at).toISOString(), place: p.place,
      responsible_chat_id: null, created_by: uid,
    }, now);
    const others = [...new Set(slots.flatMap((s) => s.people).map((m) => m.chat_id))].filter((c) => c !== uid);
    await deps.participants.add(ev.id, [uid, ...others]);
    const label = ev.kind === "meeting" ? "Встреча" : "Событие";
    const names = [author, ...others.map((c) => team.find((m) => m.chat_id === c))].filter((m): m is TeamMember => !!m).map(personName);
    const card = [
      `🗓 ${label}: <b>${escapeHtmlTeam(ev.title)}</b>`,
      `${whenText(ev.starts_at)}${ev.place ? ` · ${escapeHtmlTeam(ev.place)}` : ""}`,
      `От: ${escapeHtmlTeam(author ? personName(author) : "участник команды")}`,
      `Участники: ${escapeHtmlTeam(names.join(", "))}`,
    ].join("\n");
    for (const c of others) await tell(c, card);
    return `✅ ${label} создана: ${ev.title}, ${whenText(ev.starts_at)}`.replace("Событие создана", "Событие создано");
  }

  if (p.intent === "set_task_status") {
    let n = 0;
    for (const id of p.task_ids) {
      const t = await deps.tasks.getAssignedTask(id);
      if (!t) continue;
      const what = `«${escapeHtmlTeam(t.what)}»`;
      if (p.status === "cancelled") {
        if ((t.assigned_by !== uid && !founder) || t.status === "done" || t.status === "cancelled") continue;
        const { task, previous } = await deps.tasks.setAssignedStatus(id, uid, "cancel");
        if (previous === "cancelled") continue;
        await tell(task.assignee_id, assigneeChangeText(task, "cancel", now));
        if (task.assigned_by !== task.assignee_id) await tell(task.assigned_by, `✖️ Задача ${what} для @${escapeHtmlTeam(task.username)} отменена (${escapeHtmlTeam(authorTag)}).`);
      } else if (p.status === "done") {
        if (!isActiveAssigned(t) && t.status !== "declined") continue;
        if (t.assignee_id === uid) await deps.tasks.setAssignedStatus(id, uid, "done");
        else if (founder) {
          // Фаундер отмечает за исполнителя: статус ставится от его имени, кто отметил — в status_by.
          await deps.tasks.setAssignedStatus(id, t.assignee_id, t.status === "declined" ? "reopen" : "done");
          if (t.status === "declined") await deps.tasks.setAssignedStatus(id, t.assignee_id, "done");
          await deps.tasks.markAssignedStatusBy(id, uid);
          await tell(t.assignee_id, `✅ Задача ${what} отмечена выполненной (отметил ${escapeHtmlTeam(authorTag)}).`);
        } else continue;
        if (t.assigned_by !== uid && t.assigned_by !== t.assignee_id) await tell(t.assigned_by, `✅ @${escapeHtmlTeam(t.username)}: ${what} — выполнено.`);
      } else {
        if (t.assignee_id !== uid || !isActiveAssigned(t)) continue;
        await deps.tasks.setAssignedStatus(id, uid, "take");
      }
      n++;
    }
    if (!n) return "Ничего не поменялось: задачи уже закрыты или прав на них нет.";
    return p.status === "cancelled" ? `✅ Отменила ${tasksWord(n)}.` : p.status === "done" ? `✅ Отметила выполненными: ${tasksWord(n)}.` : `✅ Взяла в работу: ${tasksWord(n)}.`;
  }

  if (p.intent === "update_task") {
    let n = 0;
    const tasks = (await Promise.all(p.task_ids.map((id) => deps.tasks.getAssignedTask(id)))).filter((t): t is AssignedTask => !!t && isActiveAssigned(t));
    for (const t of tasks) {
      if (t.assigned_by !== uid && !founder) continue;
      const patch = { ...(p.what ? { what: p.what } : {}), ...(p.due ? { due: mskLocalToDate(p.due).toISOString() } : p.clear_due ? { due: null } : {}) };
      if (Object.keys(patch).length) {
        const updated = await deps.tasks.editAssignedTask(t.id, uid, patch);
        if ("due" in patch) await tell(updated.assignee_id, assigneeChangeText(updated, "due", now));
        if (p.what) await tell(updated.assignee_id, `✏️ Задача изменена: «${escapeHtmlTeam(updated.what)}»`);
      }
      n++;
    }
    const removed = new Set(membersOf(team, p.remove_assignees, uid).map((m) => m.chat_id));
    for (const t of tasks.filter((x) => removed.has(x.assignee_id))) {
      const { task } = await deps.tasks.setAssignedStatus(t.id, uid, "cancel");
      await tell(task.assignee_id, assigneeChangeText(task, "cancel", now));
    }
    const template = tasks[0];
    const have = new Set(tasks.map((t) => normalizeTaskUsername(t.username)));
    const add = [...new Set(membersOf(team, p.add_assignees, uid).map((m) => normalizeTaskUsername(m.username)).filter((u): u is string => !!u && !have.has(u)))];
    if (template && add.length) {
      const created = await deps.tasks.importAssignedTasks(uid, 1_500_000_000 + draft.id, add.map((username) => ({
        line: 1, username, what: p.what ?? template.what, due_at: p.due ? mskLocalToDate(p.due).toISOString() : p.clear_due ? null : template.due_at,
      })));
      await deliverAssigned(ctx.api, deps.tasks, created.filter((t) => t.delivery_state === "pending"), author?.username ?? undefined, now);
    }
    if (!n && !add.length && !removed.size) return "Ничего не поменялось: менять может автор задачи или фаундер.";
    return n > 1 ? `✅ Изменила ${tasksWord(n)}.` : "✅ Изменила задачу.";
  }

  if (p.intent === "update_event" || p.intent === "cancel_event") {
    const ev = await deps.events.get(p.event_id);
    if (!ev || ev.cancelled_at) return "Этого события уже нет.";
    const people = ((await deps.participants.forEvents([ev.id])).get(ev.id) ?? []).filter((c) => c !== uid);
    if (p.intent === "cancel_event") {
      const done = await deps.events.cancel(ev.id, now);
      if (!done) return "Этого события уже нет.";
      for (const c of people) await tell(c, `❌ Отменено: ${escapeHtmlTeam(ev.title)}, ${whenText(ev.starts_at)}`);
      return `✅ Отменила: ${ev.title}, ${whenText(ev.starts_at)}`;
    }
    let updated = ev;
    if (p.starts_at) updated = (await deps.events.setTime(ev.id, mskLocalToDate(p.starts_at).toISOString(), now)) ?? updated;
    if (p.title || p.place) updated = (await deps.events.update(ev.id, { ...(p.title ? { title: p.title } : {}), ...(p.place ? { place: p.place } : {}) }, now)) ?? updated;
    for (const c of people) await tell(c, `✏️ Изменено: ${escapeHtmlTeam(updated.title)}, ${whenText(updated.starts_at)}${updated.place ? ` · ${escapeHtmlTeam(updated.place)}` : ""}`);
    return `✅ Изменила: ${updated.title}, ${whenText(updated.starts_at)}`;
  }

  if (p.intent === "cancel_reminder") {
    return (await deps.reminders.cancel(p.reminder_id, uid)) ? "✅ Удалила напоминание." : "Это напоминание уже ушло или удалено.";
  }
  return "Нечего делать.";
}

/** Кнопки черновика, выбор из списка и ответ в открытом черновике. false — апдейт не наш. */
export async function handleAiUpdate(ctx: Context, providedDeps?: AssistantDeps | (() => AssistantDeps), now = new Date()): Promise<boolean> {
  if (ctx.chat?.type !== "private" || !ctx.from) return false;
  const uid = ctx.from.id;
  const data = ctx.callbackQuery?.data ?? "";
  const m = CALLBACK_RE.exec(data);
  const isUtterance = !!ctx.message?.voice || (!!ctx.message?.text && !ctx.message.text.startsWith("/"));
  if (!m && !isUtterance) return false;
  const deps = typeof providedDeps === "function" ? providedDeps() : providedDeps!;

  if (!m) {
    // Сообщение при открытом черновике — в диалог (правка черновика или новая просьба решит модель).
    const form = await deps.forms.get(uid);
    if (form?.kind !== "ai.edit") return false;
    const member = await deps.findMember(uid);
    if (!member || !deps.ai) {
      await deps.forms.clear(uid);
      return false;
    }
    return handleAiMessage(ctx, member, deps, now);
  }

  const [, op, idRaw, slot, chat] = m;
  if (op === "sel") {
    // Выбор из показанного списка кнопкой — как если бы человек написал номер.
    await ctx.answerCallbackQuery().catch(() => {});
    const member = await deps.findMember(uid);
    if (member) await handleAiMessage(ctx, member, deps, now, { text: `№${idRaw}`, voice: false });
    return true;
  }
  const draft = await deps.drafts.get(Number(idRaw));
  const edit = (text: string, keyboard?: InlineKeyboardMarkup) =>
    ctx.editMessageText(text, { ...HTML, ...(keyboard ? { reply_markup: keyboard } : {}) }).catch(() => {});
  if (!draft || draft.chat_id !== uid) {
    await ctx.answerCallbackQuery({ text: "Черновик не найден." }).catch(() => {});
    await edit("Черновик не найден или устарел. Напиши или надиктуй заново.");
    return true;
  }
  if (draft.confirmed_at) {
    await ctx.answerCallbackQuery({ text: "Уже сделано." }).catch(() => {});
    return true;
  }
  const close = async () => {
    await deps.state.setDraft(uid, null, now);
    await deps.forms.clear(uid);
  };
  if (expired(draft, now)) {
    await ctx.answerCallbackQuery().catch(() => {});
    await deps.drafts.remove(draft.id);
    await close();
    await edit("Черновик устарел. Напиши или надиктуй заново.");
    return true;
  }
  await ctx.answerCallbackQuery().catch(() => {});
  const team = await deps.listTeam();

  if (op === "x") {
    await deps.drafts.remove(draft.id);
    await close();
    await deps.turns.add(uid, "tool", "человек отменил черновик", now);
    await edit("Отменила.");
    return true;
  }
  if (op === "as" || op === "ad" || op === "tm") {
    // Ответ кнопкой на вопрос: сразу заполняет поле, дальше — предпросмотр.
    const field = draft.intent.awaiting;
    let body: DraftBody | null = null;
    if (field === "assignees" && op === "as") {
      const person = team.find((x) => x.chat_id === Number(slot));
      if (person) body = applyAnswer(draft.intent, field, { name: personName(person), pick: person.chat_id });
    } else if (field === "assignees" && op === "ad") {
      const dept = DEPARTMENTS.find((d) => d.key === slot);
      if (dept) body = applyAnswer(draft.intent, field, { name: dept.group, pick: null });
    } else if ((field === "starts_at" || field === "remind_at") && op === "tm" && /^\d{12}$/.test(slot ?? "")) {
      body = applyAnswer(draft.intent, field, expandCompact(slot!));
    }
    if (body) await present(ctx, deps, draft, body, team, uid, now, "edit-callback");
    return true;
  }
  if (op === "pk") {
    if (!team.some((x) => x.chat_id === Number(chat))) return true;
    const body: DraftBody = { ...draft.intent, picks: { ...draft.intent.picks, [slot!]: Number(chat) } };
    await present(ctx, deps, draft, body, team, uid, now, "edit-callback");
    return true;
  }

  // ok: перепроверяем — время могло пройти, пока черновик висел.
  const view = await renderView(deps, draft.id, draft.intent, team, uid, now);
  if (!view.ready || draft.intent.awaiting) {
    await edit(view.text, view.keyboard);
    return true;
  }
  if (!(await deps.drafts.confirm(draft.id, now))) return true;
  await close();
  try {
    const result = await confirm(ctx, deps, draft, uid, now);
    await deps.turns.add(uid, "tool", `подтверждено: ${result}`, now);
    await edit(escapeHtmlTeam(result));
  } catch (err) {
    console.error("[team-ai] confirm:", err instanceof Error ? err.message : String(err));
    await edit("Не получилось сохранить. Напиши или надиктуй заново.");
  }
  return true;
}

// ── Напоминания и очистка (поминутный тикер) ─────────────────────────────────

export interface MinuteDeps {
  reminders: ReminderStore;
  drafts: DraftStore;
  tasks: Pick<DatabotStore, "getAssignedTask">;
}

/** Напоминания, чьё время пришло, — их авторам; черновики старше часа — удалить. */
export async function dispatchTeamMinute(deps: MinuteDeps, api: Pick<Api, "sendMessage">, now: Date): Promise<string[]> {
  const done: string[] = [];
  for (const r of await deps.reminders.listDue(now)) {
    if (!(await deps.reminders.markSent(r.id, now))) continue;
    const task = r.task_id ? await deps.tasks.getAssignedTask(r.task_id).catch(() => null) : null;
    const button = task && task.assignee_id === r.chat_id && isActiveAssigned(task)
      ? { reply_markup: { inline_keyboard: [[{ text: "✅ Выполнено", callback_data: taskCb.status("done", task.id) }]] } }
      : {};
    await api.sendMessage(r.chat_id, `⏰ Напоминание: ${escapeHtmlTeam(r.text)}`, { ...HTML, ...button }).catch(() => {});
    done.push(`reminder ${r.id}`);
  }
  const purged = await deps.drafts.purge(new Date(now.getTime() - DRAFT_TTL_MS));
  if (purged) done.push(`drafts -${purged}`);
  return done;
}


/** Проход поминутного тикера (instrumentation.ts). */
export async function tickTeamMinute(now = new Date()): Promise<string[]> {
  if (!teamBotConfigured()) return [];
  return dispatchTeamMinute(
    { reminders: supabaseReminderStore(), drafts: supabaseDraftStore(), tasks: createSupabaseStore() },
    new Api(teamToken()), now,
  );
}
