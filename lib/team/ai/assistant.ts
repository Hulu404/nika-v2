import { Api, type Context } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import { createSupabaseStore } from "../../databot/data/supabase-store";
import type { DatabotStore } from "../../databot/data/store";
import { normalizeTaskUsername } from "../../databot/tasks";
import { isActiveAssigned, type AssignedTaskDraft } from "../../databot/task-list";
import { findMember, listTeam, type TeamMember } from "../access";
import { teamBotConfigured, teamToken } from "../config";
import { escapeHtmlTeam, menuKeyboard, taskCb } from "../copy";
import { departmentName } from "../departments";
import { supabaseEventStore, type TeamEventStore } from "../events";
import { openTeamForm, supabaseTeamForms, type TeamForm, type TeamFormStore } from "../form";
import { personName, stem } from "../roster";
import { deliverAssigned, syncTeamTaskMembers } from "../tasks";
import { missingOf, mskLocalToDate, type Intent } from "./intent";
import { DEPARTMENTS } from "../departments";
import { questionFor, renderPreview, slotsOf, spokenName, whenText } from "./preview";
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
import {
  AI_FAIL_TEXT,
  TeamAiError,
  VOICE_MAX_BYTES,
  VOICE_MAX_SECONDS,
  aiErrorText,
  defaultTeamAi,
  teamAiConfig,
  type AiTeamEntry,
  type TeamAi,
} from "./yandex";

/**
 * Голос и свободный текст в «Пятнице». Ещё один способ ввода, ничего не
 * заменяет: сюда попадает только то, что не разобрали кнопки меню, команды
 * и открытые формы (порядок — lib/team/bot.ts).
 *
 * Правила, которые держит этот модуль:
 *   • автор — всегда ctx.from.id, никогда не текст;
 *   • ничего не сохраняется без «✅ Создать» (чтение — сразу);
 *   • сохранение — теми же функциями, что у /assign и расписания;
 *   • в модель уходят только текст, время и состав команды (yandex.ts);
 *   • голосовое не сохраняется: буфер живёт в памяти до распознавания.
 */

export const AI_UNKNOWN_TEXT = "Не поняла. Я умею ставить задачи, напоминания и встречи и показывать твой день.";
export const VOICE_TOO_LONG_TEXT = "Голосовое длиннее 30 секунд, такие я пока не разбираю. Разбей на части или напиши текстом.";
export const AI_EDIT_PROMPT = "Что поменять? Напиши или надиктуй, например «не в четверг, а в среду». Отмена: /cancel.";

export interface AssistantDeps {
  /** null — голос и текст выключены (нет ключей или TEAM_AI_ENABLED ≠ true). */
  ai: TeamAi | null;
  drafts: DraftStore;
  reminders: ReminderStore;
  participants: ParticipantStore;
  events: TeamEventStore;
  tasks: DatabotStore;
  forms: TeamFormStore;
  listTeam: () => Promise<TeamMember[]>;
  findMember: (chatId: number) => Promise<TeamMember | null>;
  downloadVoice: (ctx: Context, fileId: string) => Promise<Uint8Array>;
  showMyTasks: (ctx: Context, uid: number) => Promise<void>;
  showSchedule: (ctx: Context, range: "today" | "tomorrow" | "week") => Promise<void>;
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

/** Боевые зависимости; экраны «Мои задачи», «Расписание» и «Мой день» подставляет bot.ts. */
export function defaultAssistantDeps(screens: Pick<AssistantDeps, "showMyTasks" | "showSchedule" | "myDay">): AssistantDeps {
  return {
    ai: teamAiConfig() ? defaultTeamAi() : null,
    drafts: supabaseDraftStore(),
    reminders: supabaseReminderStore(),
    participants: supabaseParticipantStore(),
    events: supabaseEventStore(),
    tasks: createSupabaseStore(),
    forms: supabaseTeamForms(),
    listTeam,
    findMember,
    downloadVoice,
    ...screens,
  };
}

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

/** Состав команды для модели: имя, должность, отделы, ник — и больше ничего. */
export function aiTeam(team: readonly TeamMember[]): AiTeamEntry[] {
  return team.map((m) => ({
    name: personName(m),
    title: m.title ?? null,
    departments: (m.departments ?? []).map(departmentName),
    username: m.username,
  }));
}

/** Голос → текст; null — уже ответили (длинное, ошибка). */
async function utterance(ctx: Context, deps: AssistantDeps, uid: number): Promise<{ text: string; voice: boolean } | null> {
  const voice = ctx.message?.voice;
  if (!voice) return { text: (ctx.message?.text ?? "").trim(), voice: false };
  if (voice.duration > VOICE_MAX_SECONDS || (voice.file_size ?? 0) > VOICE_MAX_BYTES) {
    await ctx.reply(VOICE_TOO_LONG_TEXT);
    return null;
  }
  await ctx.replyWithChatAction("typing").catch(() => {});
  const ogg = await deps.downloadVoice(ctx, voice.file_id);
  const text = await deps.ai!.transcribe(uid, ogg, voice.duration);
  if (!text) {
    await ctx.reply(AI_FAIL_TEXT);
    return null;
  }
  return { text, voice: true };
}

/** Напоминание «про задачу»: одна моя открытая задача, в тексте которой есть все слова подсказки. */
async function linkTask(deps: AssistantDeps, uid: number, hint: string | null): Promise<{ id: number; what: string } | null> {
  if (!hint) return null;
  const words = hint.split(/\s+/).map((w) => stem(w).slice(0, 5)).filter((w) => w.length >= 4);
  if (!words.length) return null;
  const mine = (await deps.tasks.listMyAssigned(uid)).filter((t) => t.assignee_id === uid && isActiveAssigned(t));
  const hits = mine.filter((t) => {
    const text = t.what.toLowerCase().replace(/ё/g, "е");
    return words.every((w) => text.includes(w));
  });
  return hits.length === 1 ? { id: hits[0].id, what: hits[0].what } : null;
}

async function linkedTaskText(deps: AssistantDeps, body: DraftBody): Promise<string | null> {
  if (!body.taskId) return null;
  return (await deps.tasks.getAssignedTask(body.taskId))?.what ?? null;
}

async function renderDraft(deps: AssistantDeps, draft: Draft, uid: number, now: Date) {
  return renderPreview(draft.id, draft.intent, draft.source_text, await deps.listTeam(), uid, now, await linkedTaskText(deps, draft.intent));
}

/** «Онлайн», «созвон», «в зуме» — место, если модель его не заполнила, а другое не сказано. */
export function inferPlace(parsed: Intent, text: string): Intent {
  if (parsed.intent !== "create_event" || parsed.place) return parsed;
  const t = text.toLowerCase();
  const place = /zoom|зум/.test(t) ? "Zoom" : /онлайн|online|созвон/.test(t) ? "Онлайн" : null;
  return place ? { ...parsed, place } : parsed;
}

/** Понял, но не хватает поля: в лог без текста сообщения. */
function logIncomplete(parsed: Intent): void {
  const missing = missingOf(parsed);
  if (missing.length) console.warn(`[team-ai] invalid: ${parsed.intent} missing=${missing.join(",")}`);
  else if (parsed.intent === "unknown" && parsed.reason === "invalid") console.warn("[team-ai] invalid: unknown missing=-");
}

type Where = "reply" | "edit-message" | "edit-callback";

/**
 * Показать черновик: не хватает данных — один вопрос (ответ ждём через форму
 * «Изменить»), иначе предпросмотр. Предпросмотр после вопросов — новым
 * сообщением: вопрос остался выше ответа.
 */
async function present(ctx: Context, deps: AssistantDeps, draft: Draft, body: DraftBody, sourceText: string | null, team: TeamMember[], uid: number, now: Date, where: Where): Promise<void> {
  const question = questionFor(draft.id, body, team);
  const next: DraftBody = { ...body, asking: !!question };
  await deps.drafts.setBody(draft.id, next);
  const view = question ?? renderPreview(draft.id, next, sourceText, team, uid, now, await linkedTaskText(deps, next));
  const opts = { ...HTML, reply_markup: view.keyboard };
  if (question) await deps.forms.set(uid, openTeamForm("ai.edit", { draft: String(draft.id) }, now), now);
  else await deps.forms.clear(uid);
  if (where === "edit-callback") {
    await ctx.editMessageText(view.text, opts).catch(() => {});
    return;
  }
  if (where === "edit-message" && draft.message_id && !draft.intent.asking && !question) {
    const ok = await ctx.api.editMessageText(uid, draft.message_id, view.text, opts).then(() => true, () => false);
    if (ok) return;
  }
  const msg = await ctx.reply(view.text, opts);
  await deps.drafts.setMessage(draft.id, msg.message_id);
}

/** Чтение — сразу, создание — черновик с предпросмотром или вопросом. */
async function route(ctx: Context, deps: AssistantDeps, member: TeamMember, parsed: Intent, said: { text: string; voice: boolean }, now: Date): Promise<void> {
  const uid = member.chat_id;
  switch (parsed.intent) {
    case "show_my_tasks":
      return deps.showMyTasks(ctx, uid);
    case "show_schedule":
      return deps.showSchedule(ctx, parsed.range);
    case "show_my_day":
      await ctx.reply(await deps.myDay(member, now), HTML);
      return;
    case "unknown":
      await ctx.reply(AI_UNKNOWN_TEXT, { reply_markup: menuKeyboard() });
      return;
  }
  const body: DraftBody = { parsed: inferPlace(parsed, said.text), picks: {}, voice: said.voice };
  if (parsed.intent === "create_reminder") body.taskId = (await linkTask(deps, uid, parsed.task_hint))?.id ?? null;
  const draft = await deps.drafts.create({ chat_id: uid, intent: body, source_text: said.text }, now);
  await present(ctx, deps, draft, body, said.text, await deps.listTeam(), uid, now, "reply");
}

/**
 * Свободный текст или голосовое участника, когда их не разобрали ни меню, ни
 * команды, ни формы. false — голос и текст выключены, ответит старый путь.
 */
export async function handleAiMessage(ctx: Context, member: TeamMember, deps: AssistantDeps, now = new Date()): Promise<boolean> {
  if (!deps.ai) return false;
  try {
    const said = await utterance(ctx, deps, member.chat_id);
    if (!said) return true;
    if (!said.voice) await ctx.replyWithChatAction("typing").catch(() => {});
    const parsed = await deps.ai.parseIntent({ chatId: member.chat_id, text: said.text, now, team: aiTeam(await deps.listTeam()) });
    logIncomplete(parsed);
    await route(ctx, deps, member, parsed, said, now);
  } catch (err) {
    console.error("[team-ai]", err instanceof Error ? err.message : String(err));
    await ctx.reply(aiErrorText(err)).catch(() => {});
  }
  return true;
}

/** Закрыть черновик, у которого открыто «Изменить» (кнопка меню или команда посреди уточнения). */
export async function closeAiDraft(api: Pick<Api, "editMessageText">, drafts: DraftStore, uid: number, form: TeamForm): Promise<void> {
  if (form.kind !== "ai.edit") return;
  const draft = await drafts.get(Number(form.params.draft)).catch(() => null);
  if (!draft || draft.chat_id !== uid || draft.confirmed_at) return;
  await drafts.remove(draft.id).catch(() => {});
  if (draft.message_id) await api.editMessageText(uid, draft.message_id, "Черновик закрыт.").catch(() => {});
}

const CALLBACK_RE = /^ai:(ok|ed|x|pk|as|ad):(\d+)(?::([ap]\d{1,2}|-?\d+|[a-z_]+)(?::(-?\d+))?)?$/;
const expired = (d: Draft, now: Date) => Date.parse(d.created_at) + DRAFT_TTL_MS <= now.getTime();

/** Уточнение к черновику («не в четверг, а в среду»): новый разбор, предпросмотр — в том же сообщении. */
async function applyEdit(ctx: Context, deps: AssistantDeps, member: TeamMember, form: TeamForm, now: Date): Promise<void> {
  const uid = member.chat_id;
  const draft = await deps.drafts.get(Number(form.params.draft));
  await deps.forms.clear(uid);
  if (!draft || draft.chat_id !== uid || draft.confirmed_at || expired(draft, now)) {
    await ctx.reply("Черновик устарел. Напиши или надиктуй заново.");
    return;
  }
  const said = await utterance(ctx, deps, uid);
  if (!said) return;
  const team = await deps.listTeam();
  const raw = await deps.ai!.parseIntent({ chatId: uid, text: said.text, now, team: aiTeam(team), previous: draft.intent.parsed });
  logIncomplete(raw);
  const parsed = inferPlace(raw, `${draft.source_text ?? ""} ${said.text}`);
  if (!parsed.intent.startsWith("create_")) {
    await deps.forms.set(uid, openTeamForm("ai.edit", form.params, now), now);
    await ctx.reply("Не поняла уточнение. Попробуй сказать иначе или нажми «✖️ Отмена».");
    return;
  }
  // Выбор человека кнопкой сохраняется, если упоминание в слоте не поменялось.
  const before = slotsOf(draft.intent, team, uid);
  const body: DraftBody = { parsed, picks: {}, voice: said.voice || !!draft.intent.voice, taskId: draft.intent.taskId ?? null };
  for (const s of slotsOf(body, team, uid)) {
    const old = before.find((b) => b.key === s.key);
    if (old && old.mention.name === s.mention.name && draft.intent.picks[s.key] !== undefined) body.picks[s.key] = draft.intent.picks[s.key];
  }
  if (parsed.intent === "create_reminder" && draft.intent.parsed.intent === "create_reminder" && parsed.task_hint !== draft.intent.parsed.task_hint) {
    body.taskId = (await linkTask(deps, uid, parsed.task_hint))?.id ?? null;
  }
  // Для голосового сверху предпросмотра — что распознали; ответ на вопрос дописываем к исходной фразе.
  const sourceText = !said.voice ? draft.source_text
    : draft.intent.asking && draft.intent.voice && draft.source_text ? `${draft.source_text} … ${said.text}` : said.text;
  if (sourceText !== draft.source_text) await deps.drafts.setSource(draft.id, sourceText);
  await present(ctx, deps, { ...draft, source_text: sourceText }, body, sourceText, team, uid, now, "edit-message");
}

/** «✅ Создать»: те же функции и проверки, что у /assign и расписания. Возвращает текст итога. */
async function create(ctx: Context, deps: AssistantDeps, draft: Draft, uid: number, now: Date): Promise<string> {
  const p = draft.intent.parsed;
  const team = await deps.listTeam();
  const author = team.find((m) => m.chat_id === uid);

  if (p.intent === "create_task") {
    const slots = slotsOf(draft.intent, team, uid);
    await syncTeamTaskMembers({ store: deps.tasks }, now, team);
    const usernames = [...new Set(slots.flatMap((s) => s.people).map((m) => normalizeTaskUsername(m.username)!))];
    const members = await deps.tasks.listMembers();
    for (const u of usernames) {
      if (members.filter((m) => normalizeTaskUsername(m.username) === u).length !== 1) return `Не нашла @${u} среди участников задач. Попроси человека открыть бота и набрать /start.`;
    }
    const due = p.due ? mskLocalToDate(p.due).toISOString() : null;
    const drafts: AssignedTaskDraft[] = usernames.map((username) => ({ line: 1, username, what: p.what, due_at: due }));
    const tasks = await deps.tasks.importAssignedTasks(uid, draft.message_id ?? draft.id, drafts);
    await deliverAssigned(ctx.api, deps.tasks, tasks.filter((t) => t.delivery_state === "pending"), author?.username ?? undefined, now);
    const names = slots.map((s) => spokenName(s, uid));
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} и ${names.at(-1)}` : names[0];
    return `✅ Задача поставлена ${list}, ${due ? `срок ${whenText(due)}` : "без срока"}`;
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
    for (const c of others) await ctx.api.sendMessage(c, card, HTML).catch(() => {});
    return `✅ ${label} создана: ${ev.title}, ${whenText(ev.starts_at)}`.replace("Событие создана", "Событие создано");
  }
  return "Нечего создавать.";
}

/** Кнопки черновика и уточнение «✏️ Изменить». false — апдейт не наш. */
export async function handleAiUpdate(ctx: Context, providedDeps?: AssistantDeps | (() => AssistantDeps), now = new Date()): Promise<boolean> {
  if (ctx.chat?.type !== "private" || !ctx.from) return false;
  const uid = ctx.from.id;
  const data = ctx.callbackQuery?.data ?? "";
  const m = CALLBACK_RE.exec(data);
  const isUtterance = !!ctx.message?.voice || (!!ctx.message?.text && !ctx.message.text.startsWith("/"));
  if (!m && !isUtterance) return false;
  const deps = typeof providedDeps === "function" ? providedDeps() : providedDeps!;

  if (!m) {
    const form = await deps.forms.get(uid);
    if (form?.kind !== "ai.edit") return false;
    const member = await deps.findMember(uid);
    if (!member || !deps.ai) {
      await deps.forms.clear(uid);
      return false;
    }
    try {
      await applyEdit(ctx, deps, member, form, now);
    } catch (err) {
      console.error("[team-ai] edit:", err instanceof Error ? err.message : String(err));
      await ctx.reply(aiErrorText(err)).catch(() => {});
    }
    return true;
  }

  const [, op, idRaw, slot, chat] = m;
  const draft = await deps.drafts.get(Number(idRaw));
  const edit = (text: string, keyboard?: InlineKeyboardMarkup) =>
    ctx.editMessageText(text, { ...HTML, ...(keyboard ? { reply_markup: keyboard } : {}) }).catch(() => {});
  if (!draft || draft.chat_id !== uid) {
    await ctx.answerCallbackQuery({ text: "Черновик не найден." }).catch(() => {});
    await edit("Черновик не найден или устарел. Напиши или надиктуй заново.");
    return true;
  }
  if (draft.confirmed_at) {
    await ctx.answerCallbackQuery({ text: "Уже создано." }).catch(() => {});
    return true;
  }
  if (expired(draft, now)) {
    await ctx.answerCallbackQuery().catch(() => {});
    await deps.drafts.remove(draft.id);
    await edit("Черновик устарел. Напиши или надиктуй заново.");
    return true;
  }
  await ctx.answerCallbackQuery().catch(() => {});

  if (op === "x") {
    await deps.drafts.remove(draft.id);
    await edit("Отменила.");
    return true;
  }
  if (op === "ed") {
    await deps.forms.set(uid, openTeamForm("ai.edit", { draft: String(draft.id) }, now), now);
    await ctx.reply(AI_EDIT_PROMPT);
    return true;
  }
  if (op === "as" || op === "ad") {
    // Ответ кнопкой на «Кому поставить задачу?»: человек или отдел.
    const p = draft.intent.parsed;
    if (p.intent !== "create_task") return true;
    const team = await deps.listTeam();
    const person = op === "as" ? team.find((x) => x.chat_id === Number(slot)) : null;
    const dept = op === "ad" ? DEPARTMENTS.find((d) => d.key === slot) : null;
    if (!person && !dept) return true;
    const parsed: Intent = {
      ...p,
      assignees: [{ name: person ? personName(person) : dept!.group, qualifier: null }],
      missing: missingOf(p).filter((f) => f !== "assignees"),
    };
    const body: DraftBody = { ...draft.intent, parsed, picks: person ? { a0: person.chat_id } : {} };
    await present(ctx, deps, draft, body, draft.source_text, team, uid, now, "edit-callback");
    return true;
  }
  if (op === "pk") {
    const team = await deps.listTeam();
    if (!team.some((x) => x.chat_id === Number(chat))) return true;
    const body: DraftBody = { ...draft.intent, picks: { ...draft.intent.picks, [slot!]: Number(chat) } };
    await deps.drafts.setBody(draft.id, body);
    const preview = renderPreview(draft.id, body, draft.source_text, team, uid, now, await linkedTaskText(deps, body));
    await edit(preview.text, preview.keyboard);
    return true;
  }

  // ok: перепроверяем — время могло пройти, пока черновик висел.
  const preview = await renderDraft(deps, draft, uid, now);
  if (!preview.ready) {
    await edit(preview.text, preview.keyboard);
    return true;
  }
  if (!(await deps.drafts.confirm(draft.id, now))) return true;
  try {
    await edit(escapeHtmlTeam(await create(ctx, deps, draft, uid, now)));
  } catch (err) {
    console.error("[team-ai] create:", err instanceof Error ? err.message : String(err));
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
