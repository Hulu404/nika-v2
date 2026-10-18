import type { InlineKeyboardMarkup } from "grammy/types";
import type { TeamMember } from "../access";
import { escapeHtmlTeam, eventWhen } from "../copy";
import type { Department } from "../departments";
import { personLabel, personName, personShort, resolveMention, type MentionMatch } from "../roster";
import { checkWhen, missingOf, mskLocalToDate, type Intent, type Mention } from "./intent";
import type { AssignedTask } from "../../databot/task-list";
import type { TeamEvent } from "../events";
import { taskLine } from "./tools";
import type { DraftBody, Reminder } from "./stores";
import { mskToday } from "../../databot/time";
import { STATUS_ICON, STATUS_NAME, dayLabel } from "../roadmap/copy";
import type { RoadmapItem } from "../roadmap/store";

/**
 * Предпросмотр черновика: одно сообщение, дата всегда явно с днём недели.
 * «✅ Создать» есть, только когда всё однозначно: каждый человек найден,
 * дата не в прошлом. Иначе — что не так и кнопки выбора или «✏️ Изменить».
 */

export const aiCb = {
  create: (id: number) => `ai:ok:${id}`,
  cancel: (id: number) => `ai:x:${id}`,
  pick: (id: number, slot: string, chat: number) => `ai:pk:${id}:${slot}:${chat}`,
  /** Ответ на «Кому поставить задачу?» кнопкой: человек или отдел. */
  assignPerson: (id: number, chat: number) => `ai:as:${id}:${chat}`,
  assignDept: (id: number, key: string) => `ai:ad:${id}:${key}`,
  /** Ответ кнопкой на «Во сколько?» / «Когда напомнить?»: YYYYMMDDHHmm по Москве. */
  time: (id: number, compact: string) => `ai:tm:${id}:${compact}`,
  /** «✏️ Изменить» у пакета задач: подсказка, как править словами. */
  edit: (id: number) => `ai:ed:${id}`,
};

/** «чт 15.10, 20:00». */
export const whenText = (iso: string) => {
  const w = eventWhen(iso);
  return w.charAt(0).toLowerCase() + w.slice(1);
};

export interface Slot {
  key: string;
  mention: Mention;
  match: MentionMatch;
  /** Итог: выбран кнопкой или найден однозначно. */
  member: TeamMember | null;
  /** Отдел, названный сам по себе (если человека не выбрали кнопкой вместо него). */
  department: Department | null;
  /** Кого слот означает: человека или всех участников отдела. */
  people: TeamMember[];
  /** Строка пакета задач (с нуля). */
  row?: number;
}

/**
 * Упоминания черновика по слотам: a0, a1… — исполнители, p0, p1… — участники
 * встречи, t2a0… — исполнители третьей строки пакета задач (строка без
 * исполнителя — пустой слот: «кому?»).
 */
export function slotsOf(body: DraftBody, team: readonly TeamMember[], senderId: number): Slot[] {
  const p = body.parsed;
  const list: Array<readonly [string, Mention, number?]> = p.intent === "create_task" ? p.assignees.map((m, i) => [`a${i}`, m] as const)
    : p.intent === "create_event" ? p.participants.map((m, i) => [`p${i}`, m] as const)
      : p.intent === "create_tasks" ? p.tasks.flatMap((t, r) => (t.assignees.length ? t.assignees : [{ name: "", qualifier: null }]).map((m, i) => [`t${r}a${i}`, m, r] as const))
        : [];
  return list.map(([key, mention, row]) => {
    const match: MentionMatch = mention.name ? resolveMention(team, mention, senderId) : { kind: "none", name: "" };
    const picked = body.picks[key] !== undefined ? team.find((m) => m.chat_id === body.picks[key]) ?? null : null;
    const member = picked ?? (match.kind === "one" ? match.member : null);
    const department = !picked && match.kind === "department" ? match.department : null;
    const people = member ? [member] : match.kind === "department" && !picked ? match.members : [];
    return { key, mention, match, member, department, people, ...(row !== undefined ? { row } : {}) };
  });
}

/** «до вт 13.10, 12:00», «до ср 14.10» (конец дня — без времени). */
function dueShort(local: string): string {
  const w = whenText(mskLocalToDate(local).toISOString());
  return `до ${local.endsWith("T23:59") ? w.split(", ")[0] : w}`;
}

/** «Настя (Глава SMM)» — человек в строке пакета, без ника. */
const rowPerson = (m: TeamMember, senderId: number) => (m.chat_id === senderId ? "ты" : `${personName(m)}${m.title ? ` (${m.title})` : ""}`);

/**
 * Предпросмотр пакета задач: строки по номерам, проблема — у своей строки,
 * кнопки выбора человека подписаны номером задачи. «✅ Создать все» — только
 * когда все строки однозначны.
 */
export function renderBatchPreview(draftId: number, body: DraftBody, team: readonly TeamMember[], senderId: number, now: Date): Preview {
  const p = body.parsed;
  if (p.intent !== "create_tasks") throw new Error("not a batch");
  const slots = slotsOf(body, team, senderId);
  const rows: Row[] = [];
  let ready = p.tasks.length > 0;
  const lines = ["Проверь, пожалуйста:", "", `📋 Задачи (${p.tasks.length})`];
  p.tasks.forEach((t, r) => {
    const problems: string[] = [];
    const who = slots.filter((s) => s.row === r).map((s) => {
      if (s.department) {
        if (!s.people.length) problems.push(`в отделе «${escapeHtmlTeam(s.department.group)}» никого нет`);
        const noNick = s.people.filter((m) => !m.username);
        if (noNick.length) problems.push(`у ${noNick.map((m) => escapeHtmlTeam(personName(m))).join(", ")} нет ника в Telegram`);
        return `${escapeHtmlTeam(s.department.group)}: ${s.people.map((m) => escapeHtmlTeam(personName(m))).join(", ")}`;
      }
      if (s.member) {
        if (!s.member.username) problems.push(`у ${escapeHtmlTeam(personName(s.member))} нет ника в Telegram`);
        return escapeHtmlTeam(rowPerson(s.member, senderId));
      }
      const options = s.match.kind === "many" ? s.match.options : team;
      for (const m of options) rows.push([{ text: `${r + 1} · ${personLabel(m)}`, callback_data: aiCb.pick(draftId, s.key, m.chat_id) }]);
      problems.push(!s.mention.name ? "кому? Выбери ниже" : s.match.kind === "many"
        ? `«${escapeHtmlTeam(s.mention.name)}» — кто именно? Выбери ниже (кнопки «${r + 1} · …»)`
        : `не нашла «${escapeHtmlTeam(s.mention.name)}». Выбери ниже (кнопки «${r + 1} · …»)`);
      return null;
    }).filter((x): x is string => !!x);
    let due = "без срока";
    if (t.due) {
      const check = checkWhen(t.due, now);
      due = dueShort(t.due);
      if (!check.ok) problems.push(check.error === "past" ? "срок уже прошёл" : "срок дальше чем через год");
    }
    if (problems.length) ready = false;
    lines.push(`${r + 1}. ${problems.length ? "⚠️ " : ""}${escapeHtmlTeam(t.what)} · ${who.join(", ") || "—"} · ${due}`);
    for (const problem of problems) lines.push(`   ↳ ${problem}`);
  });
  lines.push("", "✍️ Автор: ты");
  rows.push([
    ...(ready ? [{ text: "✅ Создать все", callback_data: aiCb.create(draftId) }] : []),
    { text: "✏️ Изменить", callback_data: aiCb.edit(draftId) },
    { text: "✖️ Отмена", callback_data: aiCb.cancel(draftId) },
  ]);
  return { text: lines.join("\n"), keyboard: { inline_keyboard: rows }, ready };
}

/** Кто в итоге — в именительном, без предлогов: «Маша», «ты», «SMM». */
export function listName(slot: Slot, senderId: number): string {
  if (slot.department) return slot.department.group;
  if (slot.member) return slot.member.chat_id === senderId ? "ты" : personName(slot.member);
  return slot.mention.name;
}

export interface Preview {
  text: string;
  keyboard: InlineKeyboardMarkup;
  ready: boolean;
}

type Row = InlineKeyboardMarkup["inline_keyboard"][number];

/**
 * Предпросмотр. Расшифровку голосового не показываем: Telegram показывает её у
 * самого голосового. Люди — «Маша (Ивент-отдел) @gusarovame», отдел —
 * «Ивент-отдел: Маша @gusarovame, Сальма @salmasxsx».
 */
export function renderPreview(
  draftId: number,
  body: DraftBody,
  team: readonly TeamMember[],
  senderId: number,
  now: Date,
  linkedTask?: string | null,
): Preview {
  const p = body.parsed;
  const lines: string[] = ["Проверь, пожалуйста:", ""];
  const rows: Row[] = [];
  // Пока чего-то не хватает, создавать нечего: на это есть вопрос (clarify.ts).
  let ready = missingOf(p).length === 0;

  const when = (label: string, local: string | null, empty: string) => {
    if (!local) return `${label}: ${empty}`;
    const check = checkWhen(local, now);
    if (!check.ok) {
      ready = false;
      return check.error === "past"
        ? `⚠️ ${label}: ${whenText(mskLocalToDate(local).toISOString())} — уже прошло. Нажми «✏️ Изменить».`
        : `⚠️ ${label}: дальше чем через год. Нажми «✏️ Изменить».`;
    }
    return `${label}: ${whenText(check.at.toISOString())}`;
  };
  const choose = (s: Slot, options: readonly TeamMember[]) => {
    ready = false;
    for (const m of options) rows.push([{ text: personLabel(m), callback_data: aiCb.pick(draftId, s.key, m.chat_id) }]);
  };
  const notes: string[] = [];

  /** Слот одной записью списка; проблемы — отдельной строкой ниже с кнопками выбора. */
  const entry = (s: Slot, needUsername: boolean): string | null => {
    if (s.department) {
      if (!s.people.length) {
        choose(s, team);
        notes.push(`В отделе «${escapeHtmlTeam(s.department.group)}» никого нет. Выбери людей ниже`);
        return null;
      }
      const noNick = needUsername ? s.people.filter((m) => !m.username) : [];
      if (noNick.length) {
        ready = false;
        notes.push(`${escapeHtmlTeam(s.department.group)}: у ${noNick.map((m) => escapeHtmlTeam(personName(m))).join(", ")} нет ника в Telegram, задачу не поставить`);
      }
      return `${escapeHtmlTeam(s.department.group)}: ${s.people.map((m) => escapeHtmlTeam(personShort(m))).join(", ")}`;
    }
    if (s.member) {
      if (needUsername && !s.member.username) {
        ready = false;
        notes.push(`${escapeHtmlTeam(personName(s.member))}: нет ника в Telegram, задачу не поставить`);
      }
      return escapeHtmlTeam(personLabel(s.member, senderId));
    }
    choose(s, s.match.kind === "many" ? s.match.options : team);
    notes.push(s.match.kind === "many"
      ? `«${escapeHtmlTeam(s.mention.name)}» — кто именно? Выбери ниже`
      : `Не нашла в команде «${escapeHtmlTeam(s.mention.name)}». Выбери ниже`);
    return null;
  };

  if (p.intent === "create_task") {
    const slots = slotsOf(body, team, senderId);
    const people = slots.filter((s) => !s.department).map((s) => entry(s, true)).filter((x): x is string => !!x);
    const groups = slots.filter((s) => s.department).map((s) => entry(s, true)).filter((x): x is string => !!x);
    lines.push("📋 Задача", escapeHtmlTeam(p.what));
    if (people.length) lines.push(`👤 ${people.length > 1 ? "Исполнители" : "Исполнитель"}: ${people.join(", ")}`);
    for (const g of groups) lines.push(`👥 ${g}`);
    lines.push(...notes, when("⏰ Срок", p.due, "без срока"), "✍️ Автор: ты");
  } else if (p.intent === "create_reminder") {
    lines.push("⏰ Напоминание", escapeHtmlTeam(p.text), when("🕘 Когда", p.remind_at, "—"));
    if (linkedTask) lines.push(`🔗 К задаче: ${escapeHtmlTeam(linkedTask)}`);
    lines.push("Видишь только ты.");
  } else if (p.intent === "create_event") {
    const slots = slotsOf(body, team, senderId).filter((s) => s.member?.chat_id !== senderId);
    const who = slots.map((s) => entry(s, false)).filter((x): x is string => !!x);
    lines.push(`🗓 ${escapeHtmlTeam(p.title)}`, when("🕘 Когда", p.starts_at, "—"));
    if (p.place) lines.push(`📍 Где: ${escapeHtmlTeam(p.place)}`);
    lines.push(`👥 Участники: ${["ты", ...who].join(", ")}`, ...notes, "✍️ Автор: ты");
  }

  rows.push(confirmRow(draftId, ready));
  return { text: lines.join("\n"), keyboard: { inline_keyboard: rows }, ready };
}

/** «✅ Подтвердить» (если всё однозначно) и «✖️ Отмена». Правки — словами в чат. */
export function confirmRow(draftId: number, ready: boolean): Row {
  return [
    ...(ready ? [{ text: "✅ Подтвердить", callback_data: aiCb.create(draftId) }] : []),
    { text: "✖️ Отмена", callback_data: aiCb.cancel(draftId) },
  ];
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const tasksWord = (n: number) => `${n} ${plural(n, "задачу", "задачи", "задач")}`;

export interface OpData {
  tasks: AssignedTask[];
  event?: TeamEvent | null;
  reminder?: Reminder | null;
  roadmapItem?: RoadmapItem | null;
}

/**
 * Предпросмотр изменения существующего: что именно поменяется, каждая задача
 * строкой («Отменю 6 задач: 1. @ananas_2711 · Анонс кофе-рана…»).
 */
export function renderOpPreview(draftId: number, p: Intent, data: OpData, team: readonly TeamMember[], senderId: number, now: Date): Preview {
  const lines: string[] = ["Проверь, пожалуйста:", ""];
  const rows: Row[] = [];
  let ready = true;
  const list = (tasks: AssignedTask[]) => tasks.map((t, i) => `${i + 1}. ${escapeHtmlTeam(taskLine(t, now))}`);
  const missing = (what: string) => {
    ready = false;
    lines.push(`Не нашла: ${what}. Напиши, что поменять, или нажми «✖️ Отмена».`);
  };

  if (p.intent === "set_task_status") {
    const n = data.tasks.length;
    if (!n) missing("задачи");
    const head = p.status === "cancelled" ? (n === 1 ? "❌ Отменю задачу:" : `❌ Отменю ${tasksWord(n)}:`)
      : p.status === "done" ? (n === 1 ? "✅ Отмечу выполненной:" : `✅ Отмечу выполненными ${tasksWord(n)}:`)
        : (n === 1 ? "🔄 Возьму в работу:" : `🔄 Возьму в работу ${tasksWord(n)}:`);
    lines.push(head, ...list(data.tasks));
    if (p.except?.length) lines.push(`Кроме: ${escapeHtmlTeam(p.except.join(", "))}`);
    if (p.status === "done" && data.tasks.some((t) => t.assignee_id !== senderId)) lines.push("", "За исполнителя: в задаче останется, что отметил ты.");
  } else if (p.intent === "update_task") {
    const n = data.tasks.length;
    if (!n) missing("задачи");
    lines.push(n === 1 ? "✏️ Изменю задачу:" : `✏️ Изменю ${tasksWord(n)}:`, ...list(data.tasks), "");
    if (p.what) lines.push(`Текст: ${escapeHtmlTeam(p.what)}`);
    if (p.due) {
      const check = checkWhen(p.due, now);
      if (!check.ok) ready = false;
      lines.push(check.ok ? `⏰ Новый срок: ${whenText(check.at.toISOString())}` : `⚠️ Срок ${whenText(mskLocalToDate(p.due).toISOString())} — ${check.error === "past" ? "уже прошло" : "дальше года"}. Напиши другой.`);
    }
    if (p.clear_due) lines.push("⏰ Срок: убрать");
    const people = (ms: Mention[] | undefined) => (ms ?? []).map((m) => {
      const r = resolveMention(team, m, senderId);
      if (r.kind === "one") return escapeHtmlTeam(personLabel(r.member, senderId));
      if (r.kind === "department" && r.members.length) return `${escapeHtmlTeam(r.department.group)}: ${r.members.map((x) => escapeHtmlTeam(personShort(x))).join(", ")}`;
      ready = false;
      return `«${escapeHtmlTeam(m.name)}» — не поняла, кто именно; назови точнее`;
    });
    const add = people(p.add_assignees);
    const remove = people(p.remove_assignees);
    if (add.length) lines.push(`👤 Добавлю: ${add.join(", ")}`);
    if (remove.length) lines.push(`👤 Уберу: ${remove.join(", ")}`);
  } else if (p.intent === "update_event" || p.intent === "cancel_event") {
    const ev = data.event;
    if (!ev || ev.cancelled_at) missing("событие");
    else {
      const head = `${escapeHtmlTeam(ev.title)}, ${whenText(ev.starts_at)}`;
      if (p.intent === "cancel_event") lines.push(`❌ Отменю событие: ${head}`);
      else {
        lines.push(`✏️ Изменю событие: ${head}`);
        if (p.starts_at) {
          const check = checkWhen(p.starts_at, now);
          if (!check.ok) ready = false;
          lines.push(check.ok ? `🕘 Новое время: ${whenText(check.at.toISOString())}` : `⚠️ Время ${whenText(mskLocalToDate(p.starts_at).toISOString())} — ${check.error === "past" ? "уже прошло" : "дальше года"}. Напиши другое.`);
        }
        if (p.title) lines.push(`Название: ${escapeHtmlTeam(p.title)}`);
        if (p.place) lines.push(`📍 Место: ${escapeHtmlTeam(p.place)}`);
      }
    }
  } else if (p.intent === "cancel_reminder") {
    if (!data.reminder) missing("напоминание");
    else lines.push(`❌ Удалю напоминание: ${whenText(data.reminder.remind_at)} — ${escapeHtmlTeam(data.reminder.text)}`);
  } else if (p.intent === "update_roadmap_item") {
    const item = data.roadmapItem;
    if (!item) missing("пункт плана");
    else {
      const today = mskToday(now);
      lines.push(`🗺 Изменю пункт плана: ${escapeHtmlTeam(item.code ? `${item.code} · ${item.title}` : item.title)}`);
      if (p.status) lines.push(`Статус: ${STATUS_ICON[p.status]} ${STATUS_NAME[p.status]} (было: ${STATUS_NAME[item.status]})`);
      if (p.owner_chat_id) {
        const owner = team.find((m) => m.chat_id === p.owner_chat_id);
        lines.push(`👤 Ответственный: ${escapeHtmlTeam(owner ? personLabel(owner, senderId) : "—")}`);
      }
      if (p.due) lines.push(`⏰ Срок: ${dayLabel(p.due, today)}${item.due_date ? ` (было: ${dayLabel(item.due_date, today)})` : ""}`);
      if (p.clear_due) lines.push("⏰ Срок: убрать");
    }
  }
  rows.push(confirmRow(draftId, ready));
  return { text: lines.join("\n").replace(/\n\n$/, ""), keyboard: { inline_keyboard: rows }, ready };
}
