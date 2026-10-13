import type { Context } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import type { DatabotStore } from "../../databot/data/store";
import { isActiveAssigned, type AssignedTask } from "../../databot/task-list";
import { addDays, mskToday } from "../../databot/time";
import { mskMidnight } from "../../databot/dates";
import type { TeamMember } from "../access";
import { isFounder } from "../config";
import { escapeHtmlTeam, shortDue } from "../copy";
import { DEPARTMENTS, matchDepartment } from "../departments";
import { canManageEvent, type TeamEvent, type TeamEventStore } from "../events";
import { faqAnswerText, findFaq } from "../faq";
import { personLabel, personName, resolveMention, stem } from "../roster";
import { fillDefaults } from "./clarify";
import { missingOf, normalizeLocal, validateIntent, type Intent, type TaskStatusChange } from "./intent";
import type { AiState, ShownList } from "./memory";
import { whenText } from "./preview";
import type { DraftBody, ReminderStore } from "./stores";
import type { ToolCall, ToolSpec } from "./yandex";

/**
 * Инструменты ассистента. Каждый выполняется от имени отправителя, права —
 * внутри, теми же правилами, что у кнопок:
 *   • чтение выполняется сразу и показывает только видимое отправителю
 *     (фаундер — всё, остальные — задачи, где они автор или исполнитель);
 *   • запись только готовит черновик с предпросмотром; меняет данные
 *     «✅ Подтвердить» (assistant.ts), ещё раз проверяя права.
 * Людей и отделы находит код (roster.ts), модель передаёт упоминание как в тексте.
 */

export const MAX_BULK = 20;
export const NOT_OWN_TASKS_TEXT = "Могу закрыть только свои задачи или поставленные тобой.";

export interface ToolContext {
  ctx: Context;
  uid: number;
  team: TeamMember[];
  now: Date;
  /** Исходная фраза — для подстановок (название встречи, «онлайн»). */
  saidText: string;
  voice: boolean;
  state: AiState;
  tasks: DatabotStore;
  events: TeamEventStore;
  reminders: ReminderStore;
  /** Показать черновик: новый или обновить открытый в том же сообщении. */
  upsertDraft: (body: DraftBody) => Promise<void>;
  /** Запомнить показанный список (номера для «удали вторую»). */
  setList: (list: ShownList) => Promise<void>;
  showSchedule: (ctx: Context, range: "today" | "tomorrow" | "week" | "next_week") => Promise<void>;
  myDay: (now: Date) => Promise<string>;
  /** Что уже показано человеку в этом сообщении. */
  shown: { preview: boolean; list: boolean };
}

// ── Описания для модели ──────────────────────────────────────────────────────

const mention = {
  type: "object",
  properties: {
    name: { type: "string", description: "Имя или отдел как в тексте: «Маше», «Сальмой», «ивент-отделу», «мне»" },
    qualifier: { type: "string", description: "Уточнение рядом с именем: «из ивента», «дизайнеру»" },
  },
  required: ["name"],
};
const refs = {
  task_ids: { type: "array", items: { type: "integer" }, description: "id задач (#id из результатов list_tasks)" },
  numbers: { type: "array", items: { type: "integer" }, description: "Номера из последнего показанного списка: «вторая» — 2" },
};
const local = "YYYY-MM-DDTHH:mm по Москве";

export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: "list_tasks",
    description: "Показать задачи. Чужие (scope person, department, team) — только фаундеру; остальным вернутся только их задачи. Список с номерами увидит и человек.",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["mine", "assigned_by_me", "person", "department", "team"], description: "mine — где я исполнитель" },
        person: { type: "string", description: "Для scope person: имя как в тексте («Али», «Маши из ивента»)" },
        department: { type: "string", description: "Для scope department: отдел как в тексте" },
        status: { type: "string", enum: ["open", "overdue", "done", "all"], description: "По умолчанию open" },
        query: { type: "string", description: "Поиск по тексту задачи: «анонс кофе-рана»" },
        purpose: { type: "string", enum: ["show", "choose"], description: "choose — человек выберет задачу кнопкой с номером" },
        exclude_people: { type: "array", items: mention, description: "«у всех, кроме Насти» — чьи задачи не брать" },
      },
      required: ["scope"],
    },
  },
  { name: "get_schedule", description: "Показать расписание.", parameters: { type: "object", properties: { range: { type: "string", enum: ["today", "tomorrow", "week", "next_week"] } }, required: ["range"] } },
  { name: "get_my_day", description: "Показать мой день: события и задачи на сегодня.", parameters: { type: "object", properties: {} } },
  { name: "get_team", description: "Кто в команде: имена, должности, ники, отделы.", parameters: { type: "object", properties: {} } },
  { name: "list_reminders", description: "Мои напоминания с номерами.", parameters: { type: "object", properties: {} } },
  { name: "answer_faq", description: "Быстрые ответы про кофе-раны для участников: место, время, дождь, темп.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  {
    name: "create_task",
    description: "Черновик задачи (сохранится после «✅ Подтвердить»). Вызови снова — черновик обновится.",
    parameters: { type: "object", properties: { assignees: { type: "array", items: mention }, what: { type: "string" }, due: { type: "string", description: `Срок ${local} или YYYY-MM-DD (конец дня); пусто — без срока` } }, required: ["assignees", "what"] },
  },
  {
    name: "update_task",
    description: "Черновик правки задач: текст, срок, исполнители. Менять может автор или фаундер.",
    parameters: { type: "object", properties: { ...refs, what: { type: "string" }, due: { type: "string", description: local }, clear_due: { type: "boolean" },
      add_assignees: { type: "array", items: mention }, remove_assignees: { type: "array", items: mention } } },
  },
  {
    name: "set_task_status",
    description: `Черновик смены статуса до ${MAX_BULK} задач: done — выполнена, taken — в работе, cancelled — отменить (так же «удалить»).`,
    parameters: { type: "object", properties: { ...refs, status: { type: "string", enum: ["done", "taken", "cancelled"] },
      exclude_people: { type: "array", items: mention, description: "«для всех, кроме Насти» — чьи задачи не трогать" } }, required: ["status"] },
  },
  {
    name: "create_event",
    description: "Черновик встречи или события. Название, если тема не сказана, не придумывай — оставь пустым.",
    parameters: { type: "object", properties: { title: { type: "string" }, starts_at: { type: "string", description: `${local}; сказан только день — YYYY-MM-DD` },
      place: { type: "string" }, participants: { type: "array", items: mention }, kind: { type: "string", enum: ["meeting", "other"] } } },
  },
  {
    name: "update_event",
    description: "Черновик правки события: время, название, место. Можно автору, ответственному, фаундеру.",
    parameters: { type: "object", properties: { event_id: { type: "integer" }, number: { type: "integer" }, title: { type: "string" }, starts_at: { type: "string", description: local }, place: { type: "string" } } },
  },
  { name: "cancel_event", description: "Черновик отмены события.", parameters: { type: "object", properties: { event_id: { type: "integer" }, number: { type: "integer" } } } },
  {
    name: "create_reminder",
    description: "Черновик личного напоминания отправителю.",
    parameters: { type: "object", properties: { text: { type: "string" }, remind_at: { type: "string", description: local }, task_hint: { type: "string", description: "Если про задачу — её суть" } }, required: ["text"] },
  },
  { name: "cancel_reminder", description: "Черновик удаления своего напоминания.", parameters: { type: "object", properties: { reminder_id: { type: "integer" }, number: { type: "integer" } } } },
];

// ── Помощники ────────────────────────────────────────────────────────────────

const json = (v: unknown) => JSON.stringify(v);
const err = (message: string) => json({ error: message });
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const ints = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x) && x > 0) : []);
const mentions = (v: unknown) => (Array.isArray(v) ? v : [])
  .filter((m): m is { name: unknown; qualifier?: unknown } => !!m && typeof m === "object" && typeof (m as { name?: unknown }).name === "string")
  .map((m) => ({ name: String(m.name).trim(), qualifier: str(m.qualifier) || null }))
  .filter((m) => m.name);

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Задачи, которые видит человек: фаундер — все, остальные — где он автор или исполнитель. */
export async function visibleTasks(store: DatabotStore, uid: number): Promise<AssignedTask[]> {
  return isFounder(uid) ? store.listAssignedOverview(new Date(0)) : store.listMyAssigned(uid);
}

const overdue = (t: AssignedTask, now: Date) => isActiveAssigned(t) && !!t.due_at && Date.parse(t.due_at) < now.getTime();

/** «@ananas_2711 · Анонс кофе-рана · до пт 12:00 ⏰». */
export function taskLine(t: AssignedTask, now: Date): string {
  const due = t.due_at ? ` · до ${shortDue(t.due_at, now)}${overdue(t, now) ? " ⏰" : ""}` : "";
  const status = t.status === "done" ? " · ✅" : t.status === "cancelled" ? " · отменена" : "";
  return `@${t.username} · ${cut(t.what, 80)}${due}${status}`;
}

/** Задачи по #id или по номерам последнего списка — только видимые отправителю. */
async function resolveTasks(tc: ToolContext, args: Record<string, unknown>): Promise<AssignedTask[] | string> {
  const fromList = tc.state.last_list?.kind === "tasks" ? tc.state.last_list.items : [];
  const byNumber = ints(args.numbers).map((n) => fromList.find((i) => i.n === n)?.id).filter((x): x is number => !!x);
  const ids = [...new Set([...ints(args.task_ids), ...byNumber])];
  if (!ids.length) return "Не понятно, какие задачи: покажи список (list_tasks) или назови номер из списка.";
  if (ids.length > MAX_BULK) return `Слишком много задач (${ids.length}), за раз — не больше ${MAX_BULK}. Уточни.`;
  const visible = new Map((await visibleTasks(tc.tasks, tc.uid)).map((t) => [t.id, t] as const));
  const found = ids.map((id) => visible.get(id)).filter((t): t is AssignedTask => !!t);
  if (!found.length) return isFounder(tc.uid) ? "Таких задач нет." : NOT_OWN_TASKS_TEXT;
  return found;
}

/** «Настя (Глава SMM)» — кого исключили, без ника. */
const exceptLabel = (m: TeamMember) => `${personName(m)}${m.title ? ` (${m.title})` : ""}`;

/** Кого исключить («кроме Насти главы СММ»): люди или отдел; тёзки без уточнения — вопрос. */
function excluded(tc: ToolContext, v: unknown): { ids: Set<number>; labels: string[] } | string {
  const ids = new Set<number>();
  const labels: string[] = [];
  for (const m of mentions(v)) {
    const r = resolveMention(tc.team, m, tc.uid);
    if (r.kind === "many") return `Кого именно исключить: ${r.options.map((x) => personLabel(x)).join(" или ")}?`;
    if (r.kind === "none") return `В команде нет «${m.name}».`;
    const people = r.kind === "one" ? [r.member] : r.members;
    for (const p of people) ids.add(p.chat_id);
    labels.push(r.kind === "one" ? exceptLabel(r.member) : r.department.group);
  }
  return { ids, labels };
}

/** Строки с кнопками-номерами: выбор из списка нажатием. */
function numberButtons(count: number): InlineKeyboardMarkup {
  const rows: InlineKeyboardMarkup["inline_keyboard"] = [];
  for (let i = 1; i <= count; i++) {
    if ((i - 1) % 5 === 0) rows.push([]);
    rows[rows.length - 1].push({ text: String(i), callback_data: `ai:sel:${i}` });
  }
  return { inline_keyboard: rows };
}

async function sendList(tc: ToolContext, title: string, lines: string[], choose: boolean): Promise<void> {
  const text = [`<b>${escapeHtmlTeam(title)}</b>`, ...lines.map((l, i) => `${i + 1}. ${escapeHtmlTeam(l)}`)].join("\n");
  await tc.ctx.reply(text, { parse_mode: "HTML", ...(choose ? { reply_markup: numberButtons(lines.length) } : {}) });
  tc.shown.list = true;
}

/** Напоминание «про задачу»: одна моя открытая задача, в тексте которой есть все слова подсказки. */
export async function linkTask(store: DatabotStore, uid: number, hint: string | null): Promise<number | null> {
  if (!hint) return null;
  const words = hint.split(/[\s\-—]+/).map((w) => stem(w).slice(0, 5)).filter((w) => w.length >= 4);
  if (!words.length) return null;
  const mine = (await store.listMyAssigned(uid)).filter((t) => t.assignee_id === uid && isActiveAssigned(t));
  const hits = mine.filter((t) => words.every((w) => t.what.toLowerCase().replace(/ё/g, "е").includes(w)));
  return hits.length === 1 ? hits[0].id : null;
}

async function draft(tc: ToolContext, parsed: Intent, extra: Partial<DraftBody> = {}): Promise<string> {
  await tc.upsertDraft({ parsed, picks: {}, voice: tc.voice, ...extra });
  tc.shown.preview = true;
  const missing = missingOf(parsed);
  return json(missing.length
    ? { ok: true, shown: "человеку задан вопрос", missing }
    : { ok: true, shown: "черновик показан человеку, он нажмёт «✅ Подтвердить»; повторять его содержание не нужно" });
}

// ── Поиск задач по тексту ────────────────────────────────────────────────────

export const FALLBACK_TASKS = 30;

/** Синонимы: и в запросе, и в тексте задачи слово приводится к одному виду. */
const SYNONYMS: Array<[RegExp, string]> = [
  [/^(инст(а|у|е|ой|ы)?|инстаграм[a-zа-я]*|insta[a-zа-я]*|instagram|ig)$/, "instagram"],
  [/^(тгк|тг|tg|телег(а|и|е|у|ой)|телеграм[a-zа-я]*|telegram)$/, "тгк"],
  [/^(рилс[a-zа-я]*|reels?)$/, "reels"],
  [/^(сторис|сториз|stories)$/, "stories"],
  [/^(шортс[a-zа-я]*|шорт|шорты|shorts?)$/, "шорт"],
  [/^(пост|посты|постом|постов|поста|посту|посте|постах)$/, "пост"],
];
const SEARCH_STOP = new Set(["в", "во", "и", "на", "по", "для", "у", "с", "со", "к", "о", "об", "от", "до", "про", "за", "из", "все", "всех", "эти", "этих", "надо", "нужно"]);

/** Значимые слова: синонимы сведены, остальное — основа из 5 букв. */
export function searchTokens(text: string): Set<string> {
  const t = text.toLowerCase().replace(/ё/g, "е")
    .replace(/кофе[\s\-—]*ран[а-я]*|кофран[а-я]*|coffee[\s\-]*run[a-z]*/g, " коферан ");
  const out = new Set<string>();
  for (const w of t.split(/[^a-zа-я0-9]+/)) {
    if (!w || SEARCH_STOP.has(w)) continue;
    const syn = SYNONYMS.find(([re]) => re.test(w))?.[1];
    if (syn) out.add(syn);
    else if (w === "коферан") out.add(w);
    else if (w.length >= 3) out.add(stem(w).slice(0, 5));
  }
  return out;
}

/**
 * Задачи по запросу: подходит, где совпало не меньше половины значимых слов
 * (минимум одно); сначала — с большим числом совпадений.
 */
export function searchTasks(tasks: readonly AssignedTask[], query: string): AssignedTask[] {
  const q = [...searchTokens(query)];
  if (!q.length) return [...tasks];
  const need = Math.max(1, Math.ceil(q.length / 2));
  return tasks
    .map((t, i) => ({ t, i, score: (() => { const tt = searchTokens(t.what); return q.filter((w) => tt.has(w)).length; })() }))
    .filter((x) => x.score >= need)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.t);
}

// ── Чтение ───────────────────────────────────────────────────────────────────

async function listTasks(tc: ToolContext, a: Record<string, unknown>): Promise<string> {
  const founder = isFounder(tc.uid);
  const scope = ["mine", "assigned_by_me", "person", "department", "team"].includes(str(a.scope)) ? str(a.scope) : "mine";
  const status = ["open", "overdue", "done", "all"].includes(str(a.status)) ? str(a.status) : "open";
  let tasks = await visibleTasks(tc.tasks, tc.uid);
  let title = "Твои задачи";
  const onlyOwn = !founder && (scope === "team" || scope === "person" || scope === "department");

  if (scope === "mine") tasks = tasks.filter((t) => t.assignee_id === tc.uid);
  else if (scope === "assigned_by_me") {
    tasks = tasks.filter((t) => t.assigned_by === tc.uid);
    title = "Поставлены тобой";
  } else if (scope === "person" || scope === "department") {
    const said = str(a.person) || str(a.department);
    const dept = scope === "department" ? (DEPARTMENTS.find((d) => d.key === said) ?? matchDepartment(said)) : null;
    const match = dept ? null : resolveMention(tc.team, { name: said, qualifier: null }, tc.uid);
    if (match?.kind === "many") return json({ ambiguous_person: match.options.map((m) => personLabel(m)), hint: "спроси, кого именно" });
    if (match?.kind === "none") return err(`В команде нет «${said}».`);
    const people = dept ? tc.team.filter((m) => (m.departments ?? []).includes(dept.key))
      : match?.kind === "department" ? [...match.members, ...tc.team.filter((m) => m.chat_id === tc.uid && (m.departments ?? []).includes(match.department.key))]
        : match?.kind === "one" ? [match.member] : [];
    const ids = new Set(people.map((m) => m.chat_id));
    tasks = tasks.filter((t) => ids.has(t.assignee_id));
    title = dept ? `Задачи · ${dept.group}` : match?.kind === "department" ? `Задачи · ${match.department.group}` : `Задачи · ${personName(people[0])}`;
  } else title = founder ? "Задачи команды" : "Твои задачи";

  tasks = tasks.filter((t) => status === "all" ? true : status === "done" ? t.status === "done"
    : status === "overdue" ? overdue(t, tc.now) : isActiveAssigned(t));
  const except = excluded(tc, a.exclude_people);
  if (typeof except === "string") return err(except);
  if (except.ids.size) {
    tasks = tasks.filter((t) => !except.ids.has(t.assignee_id));
    title += ` · кроме ${except.labels.join(", ")}`;
  }
  tasks.sort((x, y) => (overdue(x, tc.now) ? 0 : 1) - (overdue(y, tc.now) ? 0 : 1)
    || (x.due_at ? Date.parse(x.due_at) : Infinity) - (y.due_at ? Date.parse(y.due_at) : Infinity) || x.id - y.id);
  const query = str(a.query);
  if (query) {
    const area = tasks;
    tasks = searchTasks(area, query);
    title += ` · «${query}»`;
    if (!tasks.length) {
      // По запросу пусто — модели все открытые задачи этой области, пусть выберет сама.
      return json({
        found: 0, hint: "по запросу ничего, вот все открытые задачи в этой области",
        ...(onlyOwn ? { only_own: true, note: `Не фаундер: чужие задачи не видны. Если подходящих нет — ответь «${NOT_OWN_TASKS_TEXT}»` } : {}),
        tasks: area.filter(isActiveAssigned).slice(0, FALLBACK_TASKS).map((t) => ({
          id: t.id, what: t.what, assignee: `@${t.username}`, due: t.due_at ? whenText(t.due_at) : null, overdue: overdue(t, tc.now),
        })),
      });
    }
  }

  const total = tasks.length;
  const shown = tasks.slice(0, MAX_BULK);
  if (shown.length) {
    await tc.setList({ kind: "tasks", items: shown.map((t, i) => ({ n: i + 1, id: t.id, label: taskLine(t, tc.now) })) });
    await sendList(tc, `${title} (${total})`, shown.map((t) => taskLine(t, tc.now)), str(a.purpose) === "choose" && shown.length > 1);
  }
  return json({
    count: total,
    ...(onlyOwn ? { only_own: true, note: `Не фаундер: чужие задачи не видны. Если подходящих нет — ответь «${NOT_OWN_TASKS_TEXT}»` } : {}),
    ...(total > MAX_BULK ? { too_many: true, note: `Показаны первые ${MAX_BULK}; для действий уточни` } : {}),
    shown_to_user: shown.length > 0,
    items: shown.map((t, i) => ({
      n: i + 1, id: t.id, what: t.what, assignee: `@${t.username}`, author_is_me: t.assigned_by === tc.uid,
      due: t.due_at ? whenText(t.due_at) : null, overdue: overdue(t, tc.now), status: t.status,
    })),
  });
}

async function getSchedule(tc: ToolContext, a: Record<string, unknown>): Promise<string> {
  const range = (["today", "tomorrow", "week", "next_week"] as const).find((r) => r === a.range) ?? "week";
  const today = mskToday(tc.now);
  const [from, to] = range === "today" ? [today, addDays(today, 1)] : range === "tomorrow" ? [addDays(today, 1), addDays(today, 2)]
    : range === "next_week" ? [addDays(today, 7), addDays(today, 14)] : [today, addDays(today, 7)];
  const events = await tc.events.listBetween(mskMidnight(from), mskMidnight(to));
  await tc.showSchedule(tc.ctx, range);
  tc.shown.list = true;
  if (events.length) await tc.setList({ kind: "events", items: events.map((e, i) => ({ n: i + 1, id: e.id, label: `${e.title} · ${whenText(e.starts_at)}` })) });
  return json({ shown_to_user: true, items: events.map((e, i) => ({ n: i + 1, id: e.id, title: e.title, when: whenText(e.starts_at), place: e.place })) });
}

async function listReminders(tc: ToolContext): Promise<string> {
  const mine = await tc.reminders.listMine(tc.uid);
  if (mine.length) {
    await tc.setList({ kind: "reminders", items: mine.map((r, i) => ({ n: i + 1, id: r.id, label: `${whenText(r.remind_at)} — ${r.text}` })) });
    await sendList(tc, "Твои напоминания", mine.map((r) => `${whenText(r.remind_at)} — ${r.text}`), false);
  }
  return json({ count: mine.length, items: mine.map((r, i) => ({ n: i + 1, id: r.id, text: r.text, when: whenText(r.remind_at) })) });
}

function getTeam(tc: ToolContext): string {
  return json({
    people: tc.team.map((m) => ({ name: personName(m), title: m.title ?? null, username: m.username, founder: isFounder(m.chat_id) })),
    departments: DEPARTMENTS.map((d) => ({ name: d.group, people: tc.team.filter((m) => (m.departments ?? []).includes(d.key)).map(personName) })),
  });
}

// ── Запись (черновики) ───────────────────────────────────────────────────────

async function setTaskStatus(tc: ToolContext, a: Record<string, unknown>): Promise<string> {
  const status = (["done", "taken", "cancelled"] as const).find((s) => s === a.status) as TaskStatusChange | undefined;
  if (!status) return err("Статус: done, taken или cancelled.");
  const found = await resolveTasks(tc, a);
  if (typeof found === "string") return err(found);
  const except = excluded(tc, a.exclude_people);
  if (typeof except === "string") return err(except);
  const tasks = found.filter((t) => !except.ids.has(t.assignee_id));
  if (!tasks.length) return err("После исключений задач не осталось.");
  const founder = isFounder(tc.uid);
  const allowed = tasks.filter((t) => isActiveAssigned(t) || (status !== "cancelled" && t.status === "declined"))
    .filter((t) => status === "cancelled" ? t.assigned_by === tc.uid || founder
      : status === "done" ? t.assignee_id === tc.uid || founder : t.assignee_id === tc.uid);
  if (!allowed.length) {
    return err(status === "taken" ? "В работу берёт только сам исполнитель."
      : founder ? "Эти задачи уже закрыты." : NOT_OWN_TASKS_TEXT);
  }
  return draft(tc, { intent: "set_task_status", task_ids: allowed.map((t) => t.id), status, ...(except.labels.length ? { except: except.labels } : {}) });
}

async function updateTask(tc: ToolContext, a: Record<string, unknown>): Promise<string> {
  const tasks = await resolveTasks(tc, a);
  if (typeof tasks === "string") return err(tasks);
  const founder = isFounder(tc.uid);
  const mine = tasks.filter((t) => (t.assigned_by === tc.uid || founder) && isActiveAssigned(t));
  if (!mine.length) return err("Менять текст, срок и исполнителей может автор задачи или фаундер; закрытые задачи не меняются.");
  const what = str(a.what);
  const due = str(a.due) ? normalizeLocal(a.due) : null;
  if (str(a.due) && !due) return err(`Срок — ${local}.`);
  const add = mentions(a.add_assignees);
  const remove = mentions(a.remove_assignees);
  if (!what && !due && a.clear_due !== true && !add.length && !remove.length) return err("Что поменять: текст, срок или исполнителей?");
  return draft(tc, {
    intent: "update_task", task_ids: mine.map((t) => t.id),
    ...(what ? { what } : {}), ...(due ? { due } : {}), ...(a.clear_due === true && !due ? { clear_due: true } : {}),
    ...(add.length ? { add_assignees: add } : {}), ...(remove.length ? { remove_assignees: remove } : {}),
  });
}

async function resolveEvent(tc: ToolContext, a: Record<string, unknown>): Promise<TeamEvent | string> {
  const fromList = tc.state.last_list?.kind === "events" ? tc.state.last_list.items : [];
  const id = Number.isInteger(a.event_id) ? Number(a.event_id) : fromList.find((i) => i.n === a.number)?.id;
  const ev = id ? await tc.events.get(id) : null;
  if (!ev || ev.cancelled_at) return "Не нашла такое событие: покажи расписание (get_schedule) и назови номер.";
  if (!canManageEvent(ev, tc.uid)) return "Менять и отменять событие может автор, ответственный или фаундер.";
  return ev;
}

async function cancelReminder(tc: ToolContext, a: Record<string, unknown>): Promise<string> {
  const fromList = tc.state.last_list?.kind === "reminders" ? tc.state.last_list.items : [];
  const id = Number.isInteger(a.reminder_id) ? Number(a.reminder_id) : fromList.find((i) => i.n === a.number)?.id;
  const mine = await tc.reminders.listMine(tc.uid);
  if (!id || !mine.some((r) => r.id === id)) return err("Не нашла такое напоминание: покажи список (list_reminders).");
  return draft(tc, { intent: "cancel_reminder", reminder_id: id });
}

// ── Исполнитель ──────────────────────────────────────────────────────────────

export async function executeTool(tc: ToolContext, call: ToolCall): Promise<string> {
  const a = call.arguments ?? {};
  switch (call.name) {
    case "list_tasks":
      return listTasks(tc, a);
    case "get_schedule":
      return getSchedule(tc, a);
    case "get_my_day":
      await tc.ctx.reply(await tc.myDay(tc.now), { parse_mode: "HTML" });
      tc.shown.list = true;
      return json({ shown_to_user: true });
    case "get_team":
      return getTeam(tc);
    case "list_reminders":
      return listReminders(tc);
    case "answer_faq": {
      const found = findFaq(str(a.query)).slice(0, 3);
      return json(found.length ? { answers: found.map((e) => faqAnswerText(e, tc.now)) } : { answers: [], note: "Ответа в быстрых ответах нет" });
    }
    case "create_task": {
      const parsed = validateIntent({ intent: "create_task", what: str(a.what), due: str(a.due), assignees: mentions(a.assignees) });
      if (parsed.intent === "unknown") return err("Нужен текст задачи: что сделать.");
      return draft(tc, fillDefaults(parsed, tc.saidText, tc.team, tc.uid));
    }
    case "create_event": {
      const parsed = validateIntent({ intent: "create_event", title: str(a.title), starts_at: str(a.starts_at), place: str(a.place),
        participants: mentions(a.participants), kind: a.kind === "other" ? "other" : "meeting" });
      if (parsed.intent === "unknown") return err("Не получилось собрать встречу.");
      return draft(tc, fillDefaults(parsed, tc.saidText, tc.team, tc.uid));
    }
    case "create_reminder": {
      const parsed = validateIntent({ intent: "create_reminder", text: str(a.text), remind_at: str(a.remind_at), task_hint: str(a.task_hint) });
      if (parsed.intent !== "create_reminder") return err("Не получилось собрать напоминание.");
      return draft(tc, fillDefaults(parsed, tc.saidText), { taskId: await linkTask(tc.tasks, tc.uid, parsed.task_hint) });
    }
    case "update_task":
      return updateTask(tc, a);
    case "set_task_status":
      return setTaskStatus(tc, a);
    case "update_event": {
      const ev = await resolveEvent(tc, a);
      if (typeof ev === "string") return err(ev);
      const starts = str(a.starts_at) ? normalizeLocal(a.starts_at) : null;
      if (str(a.starts_at) && !starts) return err(`Время — ${local}.`);
      if (!starts && !str(a.title) && !str(a.place)) return err("Что поменять: время, название или место?");
      return draft(tc, { intent: "update_event", event_id: ev.id, ...(starts ? { starts_at: starts } : {}),
        ...(str(a.title) ? { title: str(a.title) } : {}), ...(str(a.place) ? { place: str(a.place) } : {}) });
    }
    case "cancel_event": {
      const ev = await resolveEvent(tc, a);
      if (typeof ev === "string") return err(ev);
      return draft(tc, { intent: "cancel_event", event_id: ev.id });
    }
    case "cancel_reminder":
      return cancelReminder(tc, a);
    default:
      return err(`Нет инструмента ${call.name}.`);
  }
}
