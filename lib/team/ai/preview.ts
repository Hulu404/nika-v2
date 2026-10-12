import type { InlineKeyboardMarkup } from "grammy/types";
import type { TeamMember } from "../access";
import { escapeHtmlTeam, eventWhen } from "../copy";
import { personFull, personName, personWithTitle, resolveMention, type MentionMatch } from "../roster";
import { checkWhen, mskLocalToDate, type Mention } from "./intent";
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
}

/** Упоминания черновика по слотам: a0, a1… — исполнители, p0, p1… — участники встречи. */
export function slotsOf(body: DraftBody, team: readonly TeamMember[], senderId: number): Slot[] {
  const p = body.parsed;
  const list = p.intent === "create_task" ? p.assignees.map((m, i) => [`a${i}`, m] as const)
    : p.intent === "create_event" ? p.participants.map((m, i) => [`p${i}`, m] as const) : [];
  return list.map(([key, mention]) => {
    const match = resolveMention(team, mention, senderId);
    const picked = body.picks[key] !== undefined ? team.find((m) => m.chat_id === body.picks[key]) ?? null : null;
    return { key, mention, match, member: picked ?? (match.kind === "one" ? match.member : null) };
  });
}

/** Как назвать человека в итоге: «Маше» (как сказали), себя — «тебе». */
export function spokenName(slot: Slot, senderId: number): string {
  if (slot.member?.chat_id === senderId) return "тебе";
  const head = slot.mention.name.trim();
  return head.charAt(0).toUpperCase() + head.slice(1);
}

export interface Preview {
  text: string;
  keyboard: InlineKeyboardMarkup;
  ready: boolean;
}

type Row = InlineKeyboardMarkup["inline_keyboard"][number];

export function renderPreview(
  draftId: number,
  body: DraftBody,
  sourceText: string | null,
  team: readonly TeamMember[],
  senderId: number,
  now: Date,
  linkedTask?: string | null,
): Preview {
  const p = body.parsed;
  const lines: string[] = [];
  const rows: Row[] = [];
  let ready = true;
  if (body.voice && sourceText) lines.push(`🗣 «${escapeHtmlTeam(sourceText.length > 300 ? `${sourceText.slice(0, 299)}…` : sourceText)}»`, "");
  lines.push("Проверь, пожалуйста:", "");

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

  const people = (slots: Slot[], needUsername: boolean): string[] => slots.map((s) => {
    if (s.member) {
      if (needUsername && !s.member.username) {
        ready = false;
        return `${personName(s.member)}: нет ника в Telegram, задачу не поставить`;
      }
      return s.member.chat_id === senderId ? "ты" : escapeHtmlTeam(personFull(s.member));
    }
    ready = false;
    const options = s.match.kind === "many" ? s.match.options : team;
    for (const m of options) rows.push([{ text: personWithTitle(m), callback_data: aiCb.pick(draftId, s.key, m.chat_id) }]);
    return s.match.kind === "many"
      ? `«${escapeHtmlTeam(s.mention.name)}» — кто именно? Выбери ниже`
      : `Не нашла в команде «${escapeHtmlTeam(s.mention.name)}». Выбери ниже`;
  });

  if (p.intent === "create_task") {
    const who = people(slotsOf(body, team, senderId), true);
    lines.push("📋 Задача", escapeHtmlTeam(p.what), `👤 ${who.length > 1 ? "Исполнители" : "Исполнитель"}: ${who.join(", ")}`,
      when("⏰ Срок", p.due, "без срока"), "✍️ Автор: ты");
  } else if (p.intent === "create_reminder") {
    lines.push("⏰ Напоминание", escapeHtmlTeam(p.text), when("🕑 Когда", p.remind_at, "—"));
    if (linkedTask) lines.push(`🔗 К задаче: ${escapeHtmlTeam(linkedTask)}`);
    lines.push("Видишь только ты.");
  } else if (p.intent === "create_event") {
    const others = people(slotsOf(body, team, senderId), false).filter((x) => x !== "ты");
    lines.push(p.kind === "meeting" ? "🗓 Встреча" : "🗓 Событие", escapeHtmlTeam(p.title), when("🕑 Когда", p.starts_at, "—"));
    if (p.place) lines.push(`📍 Где: ${escapeHtmlTeam(p.place)}`);
    lines.push(`👥 Участники: ${["ты", ...others].join(", ")}`, "✍️ Автор: ты");
  }

  rows.push([
    ...(ready ? [{ text: "✅ Создать", callback_data: aiCb.create(draftId) }] : []),
    { text: "✏️ Изменить", callback_data: aiCb.edit(draftId) },
    { text: "✖️ Отмена", callback_data: aiCb.cancel(draftId) },
  ]);
  return { text: lines.join("\n"), keyboard: { inline_keyboard: rows }, ready };
}
