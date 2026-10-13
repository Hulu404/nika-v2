import type { InlineKeyboardMarkup } from "grammy/types";
import type { TeamMember } from "../access";
import { escapeHtmlTeam, eventWhen } from "../copy";
import type { Department } from "../departments";
import { personLabel, personName, personShort, resolveMention, type MentionMatch } from "../roster";
import { checkWhen, missingOf, mskLocalToDate, type Mention } from "./intent";
import type { DraftBody } from "./stores";

/**
 * Предпросмотр черновика: одно сообщение, дата всегда явно с днём недели.
 * «✅ Создать» есть, только когда всё однозначно: каждый человек найден,
 * дата не в прошлом. Иначе — что не так и кнопки выбора или «✏️ Изменить».
 */

export const aiCb = {
  create: (id: number) => `ai:ok:${id}`,
  edit: (id: number) => `ai:ed:${id}`,
  cancel: (id: number) => `ai:x:${id}`,
  pick: (id: number, slot: string, chat: number) => `ai:pk:${id}:${slot}:${chat}`,
  /** Ответ на «Кому поставить задачу?» кнопкой: человек или отдел. */
  assignPerson: (id: number, chat: number) => `ai:as:${id}:${chat}`,
  assignDept: (id: number, key: string) => `ai:ad:${id}:${key}`,
  /** Ответ кнопкой на «Во сколько?» / «Когда напомнить?»: YYYYMMDDHHmm по Москве. */
  time: (id: number, compact: string) => `ai:tm:${id}:${compact}`,
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
}

/** Упоминания черновика по слотам: a0, a1… — исполнители, p0, p1… — участники встречи. */
export function slotsOf(body: DraftBody, team: readonly TeamMember[], senderId: number): Slot[] {
  const p = body.parsed;
  const list = p.intent === "create_task" ? p.assignees.map((m, i) => [`a${i}`, m] as const)
    : p.intent === "create_event" ? p.participants.map((m, i) => [`p${i}`, m] as const) : [];
  return list.map(([key, mention]) => {
    const match = resolveMention(team, mention, senderId);
    const picked = body.picks[key] !== undefined ? team.find((m) => m.chat_id === body.picks[key]) ?? null : null;
    const member = picked ?? (match.kind === "one" ? match.member : null);
    const department = !picked && match.kind === "department" ? match.department : null;
    const people = member ? [member] : match.kind === "department" && !picked ? match.members : [];
    return { key, mention, match, member, department, people };
  });
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

  rows.push([
    ...(ready ? [{ text: "✅ Создать", callback_data: aiCb.create(draftId) }] : []),
    { text: "✏️ Изменить", callback_data: aiCb.edit(draftId) },
    { text: "✖️ Отмена", callback_data: aiCb.cancel(draftId) },
  ]);
  return { text: lines.join("\n"), keyboard: { inline_keyboard: rows }, ready };
}
