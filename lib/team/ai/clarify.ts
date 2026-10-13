import type { InlineKeyboardMarkup } from "grammy/types";
import { parseDue } from "../../databot/assigned-due";
import { addDays, mskToday } from "../../databot/time";
import { mskWeekday } from "../../databot/dates";
import type { TeamMember } from "../access";
import { DEPARTMENTS } from "../departments";
import { escapeHtmlTeam, eventWhen } from "../copy";
import { personName, personWithTitle, resolveMention } from "../roster";
import { missingOf, mskLocalToDate, type Intent, type MissingField } from "./intent";
import { aiCb, slotsOf, whenText } from "./preview";
import type { DraftBody } from "./stores";

/**
 * Уточнение черновика: не больше одного вопроса и только о том, без чего
 * действие невозможно (у задачи — кому, у встречи и напоминания — когда).
 * Ответ сначала разбирает код (время, люди, отделы), модель — только если код
 * не справился. Одинаковый вопрос дважды не задаётся: на неудачу — «Не поняла
 * …» с теми же кнопками, на третью — черновик закрывается.
 */

export const MAX_CLARIFY_MESSAGES = 3;
export const NOT_HEARD_TEXT = "Не расслышала, запиши ещё раз.";
export const GIVE_UP_TEXT = "Не получилось. Попробуй записать заново целиком.";

const pad = (n: number) => String(n).padStart(2, "0");
const localOf = (d: Date) => {
  const ymd = mskToday(d);
  const time = eventWhen(d.toISOString()).split(", ")[1];
  return `${ymd}T${time}`;
};

// ── Подстановки по умолчанию ─────────────────────────────────────────────────

const GENERIC_TITLE = /^(онлайн[- ]?)?(встреча|встречу|созвон|встреча онлайн)?$/i;

/** «Онлайн», «созвон», «в зуме» — место, если другое не сказано. */
function placeFrom(text: string): string | null {
  const t = text.toLowerCase();
  return /zoom|зум/.test(t) ? "Zoom" : /онлайн|online|созвон/.test(t) ? "Онлайн" : null;
}

/**
 * Всё, что не обязательно, подставляется, а не спрашивается: название встречи
 * («Встреча с ивент-отделом», «Созвон»), место «Онлайн», текст напоминания.
 */
export function fillDefaults(parsed: Intent, text: string): Intent {
  if (parsed.intent === "create_event") {
    const place = parsed.place ?? placeFrom(text);
    let title = parsed.title.trim();
    if (GENERIC_TITLE.test(title)) {
      const base = /созвон/i.test(text) || /созвон/i.test(title) ? "Созвон" : "Встреча";
      const who = parsed.participants.map((m) => m.name).filter((n) => !/^(со?\s+)?(мной|мне|меня|себе)$/i.test(n));
      title = who.length ? `${base} с ${who.join(" и ")}` : base;
    }
    return { ...parsed, title, place };
  }
  if (parsed.intent === "create_reminder" && !parsed.text.trim()) {
    const after = /напомни(?:те)?\s+(?:мне\s+)?(.+)/i.exec(text)?.[1]?.trim();
    return { ...parsed, text: after || "Напоминание" };
  }
  return parsed;
}

// ── Разбор ответа кодом ──────────────────────────────────────────────────────

/** «пт», «в пятницу», «в среду» → день недели 1–7. */
const WEEKDAY_ROOTS = [/(^|\s)пн(\s|$)|понедельн/, /(^|\s)вт(\s|$)|вторник/, /(^|\s)ср(\s|$)|сред[уаы]/, /(^|\s)чт(\s|$)|четверг/,
  /(^|\s)пт(\s|$)|пятниц/, /(^|\s)сб(\s|$)|суббот/, /(^|\s)вс(\s|$)|воскресен/];

const NUMBERS: Record<string, number> = {
  один: 1, одного: 1, два: 2, двух: 2, три: 3, трех: 3, четыре: 4, четырех: 4, пять: 5, пяти: 5, шесть: 6, шести: 6,
  семь: 7, семи: 7, восемь: 8, восьми: 8, девять: 9, девяти: 9, десять: 10, десяти: 10, одиннадцать: 11, одиннадцати: 11,
  двенадцать: 12, двенадцати: 12,
};

/**
 * Время из короткого ответа: «в 18», «18:00», «в 18 30», «в шесть вечера»,
 * «через час», «через 2 часа», «завтра в 10», «пт 18:00». baseYmd — день из
 * черновика (если был сказан). null — времени в ответе нет.
 */
export function parseTimeAnswer(text: string, baseYmd: string | null, now: Date): string | null {
  const t = text.toLowerCase().replace(/ё/g, "е").replace(/[,!?«»"]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;

  const rel = /через\s+(полчаса|час|(\d+|[а-я]+)\s+(час\w*|мин\w*))/.exec(t);
  if (rel) {
    const n = rel[1] === "полчаса" ? 30 : rel[1] === "час" ? 60
      : (Number(rel[2]) || NUMBERS[rel[2]] || 0) * (rel[3].startsWith("час") ? 60 : 1);
    return n > 0 ? localOf(new Date(now.getTime() + n * 60_000)) : null;
  }

  const today = mskToday(now);
  const weekday = WEEKDAY_ROOTS.findIndex((re) => re.test(t)) + 1;
  const dayWord = /послезавтра/.test(t) ? addDays(today, 2) : /завтра/.test(t) ? addDays(today, 1) : /сегодня/.test(t) ? today
    : weekday ? addDays(today, (weekday - mskWeekday(today) + 7) % 7) : null;
  let h: number | null = null;
  let m = 0;
  if (/полдень/.test(t)) h = 12;
  else if (/полночь/.test(t)) h = 0;
  const digits = /(?:^|\s|в|к)(\d{1,2})(?:(?:[:.]|\s)(\d{2}))?(?=\s|$|ч)/.exec(t);
  if (h === null && digits) {
    h = Number(digits[1]);
    m = digits[2] ? Number(digits[2]) : 0;
  }
  if (h === null) {
    const word = t.split(" ").find((w) => NUMBERS[w] !== undefined);
    if (word) h = NUMBERS[word];
  }
  if (h === null) {
    // «пт 18:00», «03.10 18:00» — существующий разбор сроков.
    try {
      if (/\d{1,2}[:.]\d{2}/.test(t)) return localOf(parseDue(t.replace(/^в\s+/, ""), now));
    } catch {
      /* не срок */
    }
    return null;
  }
  if (/вечера|дня/.test(t) && h < 12) h += 12;
  else if (/ночи/.test(t) && h === 12) h = 0;
  else if (!/утра/.test(t) && h >= 1 && h <= 7) h += 12; // «в 6» на работе — 18:00
  if (h > 23 || m > 59) return null;
  let ymd = dayWord ?? baseYmd ?? today;
  if (dayWord === today && weekday && mskLocalToDate(`${today}T${pad(h)}:${pad(m)}`).getTime() <= now.getTime()) ymd = addDays(today, 7);
  else if (!dayWord && !baseYmd && mskLocalToDate(`${ymd}T${pad(h)}:${pad(m)}`).getTime() <= now.getTime()) ymd = addDays(ymd, 1);
  return `${ymd}T${pad(h)}:${pad(m)}`;
}

/** Кому: имя или отдел из ответа («Сальме», «ивент-отделу»). null — никого не нашли. */
export function parseAssigneeAnswer(text: string, team: readonly TeamMember[], senderId: number): { name: string; pick: number | null } | null {
  const name = text.trim().replace(/^(кому|на|для|поставь|задачу)\s+/i, "").replace(/[.!?]+$/, "").slice(0, 64);
  if (!name) return null;
  const match = resolveMention(team, { name, qualifier: null }, senderId);
  if (match.kind === "one") return { name, pick: match.member.chat_id };
  if (match.kind === "many" || (match.kind === "department" && match.members.length)) return { name, pick: null };
  return null;
}

/** Вписать ответ в черновик. */
export function applyAnswer(body: DraftBody, field: MissingField, value: string | { name: string; pick: number | null }): DraftBody {
  const p = body.parsed;
  const missing = missingOf(p).filter((f) => f !== field);
  const rest = { awaiting: undefined, failures: 0 };
  if (field === "assignees" && p.intent === "create_task" && typeof value !== "string") {
    return { ...body, ...rest, parsed: { ...p, assignees: [{ name: value.name, qualifier: null }], missing }, picks: value.pick ? { a0: value.pick } : {} };
  }
  if (field === "starts_at" && p.intent === "create_event" && typeof value === "string") {
    return { ...body, ...rest, parsed: { ...p, starts_at: value, date: null, missing } };
  }
  if (field === "remind_at" && p.intent === "create_reminder" && typeof value === "string") {
    return { ...body, ...rest, parsed: { ...p, remind_at: value, date: null, missing } };
  }
  return body;
}

// ── Вопрос ───────────────────────────────────────────────────────────────────

type Row = InlineKeyboardMarkup["inline_keyboard"][number];

const dayLabel = (ymd: string, now: Date) => {
  const day = whenText(mskLocalToDate(`${ymd}T12:00`).toISOString()).split(", ")[0];
  const today = mskToday(now);
  return ymd === today ? `сегодня, ${day}` : ymd === addDays(today, 1) ? `завтра, ${day}` : day;
};

/** «Поняла: встреча сегодня, вт 13.10 · онлайн · с ивент-отделом (Маша, Сальма)». */
export function understoodLine(body: DraftBody, team: readonly TeamMember[], senderId: number, now: Date): string {
  const p = body.parsed;
  const parts: string[] = [];
  if (p.intent === "create_event") {
    parts.push(/^(Встреча|Созвон)( с |$)/.test(p.title) ? (p.title.startsWith("Созвон") ? "созвон" : "встреча") : `встреча «${escapeHtmlTeam(p.title)}»`);
    if (p.date) parts[0] += ` ${dayLabel(p.date, now)}`;
    if (p.place) parts.push(escapeHtmlTeam(p.place === "Онлайн" ? "онлайн" : p.place));
    const who = slotsOf(body, team, senderId).filter((s) => s.member?.chat_id !== senderId).map((s) =>
      s.department ? `с ${escapeHtmlTeam(s.mention.name)} (${s.people.map((m) => escapeHtmlTeam(personName(m))).join(", ") || "никого"})`
        : `с ${escapeHtmlTeam(s.member ? personName(s.member) : s.mention.name)}`);
    if (who.length) parts.push(who.join(", "));
  } else if (p.intent === "create_reminder") {
    parts.push(`напоминание «${escapeHtmlTeam(p.text)}»`);
    if (p.date) parts.push(dayLabel(p.date, now));
  } else if (p.intent === "create_task") {
    parts.push(`задача «${escapeHtmlTeam(p.what)}»`);
    if (p.due) parts.push(`срок ${whenText(mskLocalToDate(p.due).toISOString())}`);
  }
  return `Поняла: ${parts.join(" · ")}`;
}

const QUESTION: Record<MissingField, string> = {
  starts_at: "Во сколько?",
  remind_at: "Когда напомнить?",
  assignees: "Кому поставить задачу?",
};

const RETRY: Record<MissingField, string> = {
  starts_at: "Не поняла время. Выбери кнопкой или напиши, например, «в 18:30».",
  remind_at: "Не поняла время. Выбери кнопкой или напиши, например, «в 18:30» или «через час».",
  assignees: "Не поняла, кому. Выбери кнопкой или напиши имя или отдел, например, «Сальме».",
};

const compact = (local: string) => local.replace(/[-T:]/g, "");
export const expandCompact = (c: string) => `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}T${c.slice(8, 10)}:${c.slice(10, 12)}`;

/** Кнопки быстрого ответа: ближайшие разумные часы (только будущие) или люди и отделы. */
export function answerButtons(draftId: number, body: DraftBody, field: MissingField, team: readonly TeamMember[], now: Date): Row[] {
  const p = body.parsed;
  if (field === "assignees") {
    return [
      ...DEPARTMENTS.map((d) => [{ text: `👥 ${d.group}`, callback_data: aiCb.assignDept(draftId, d.key) }]),
      ...team.map((m) => [{ text: personWithTitle(m), callback_data: aiCb.assignPerson(draftId, m.chat_id) }]),
    ];
  }
  const future = (local: string) => mskLocalToDate(local).getTime() > now.getTime();
  const button = (text: string, local: string) => ({ text, callback_data: aiCb.time(draftId, compact(local)) });
  const date = "date" in p ? p.date ?? null : null;
  if (field === "remind_at") {
    const today = date ?? mskToday(now);
    const options = [
      ...(date ? [] : [button("через 30 мин", localOf(new Date(now.getTime() + 30 * 60_000))), button("через час", localOf(new Date(now.getTime() + 3_600_000)))]),
      ...[`${today}T18:00`].filter(future).map((l) => button(date ? "18:00" : "сегодня 18:00", l)),
      ...(date ? [`${date}T10:00`, `${date}T12:00`].filter(future).map((l) => button(l.slice(11), l)) : [button("завтра 10:00", `${addDays(mskToday(now), 1)}T10:00`)]),
    ];
    return [options];
  }
  let day = date ?? mskToday(now);
  let hours = ["10:00", "12:00", "15:00", "18:00", "19:00"].map((h) => `${day}T${h}`).filter(future);
  if (!hours.length && !date) {
    day = addDays(day, 1);
    hours = ["10:00", "12:00", "15:00", "18:00", "19:00"].map((h) => `${day}T${h}`);
    return [hours.map((l) => button(`завтра ${l.slice(11)}`, l))];
  }
  return hours.length ? [hours.map((l) => button(l.slice(11), l))] : [];
}

/** Вопрос (первый раз) или «Не поняла …» (повтор) с теми же кнопками. */
export function clarifyMessage(
  draftId: number, body: DraftBody, field: MissingField, team: readonly TeamMember[], senderId: number, now: Date,
  sourceText: string | null, retry: boolean,
): { text: string; keyboard: InlineKeyboardMarkup } {
  const rows = [...answerButtons(draftId, body, field, team, now), [{ text: "✖️ Отмена", callback_data: aiCb.cancel(draftId) }]];
  if (retry) return { text: RETRY[field], keyboard: { inline_keyboard: rows } };
  const lines: string[] = [];
  if (body.voice && sourceText) lines.push(`🗣 «${escapeHtmlTeam(sourceText.length > 300 ? `${sourceText.slice(0, 299)}…` : sourceText)}»`, "");
  lines.push(understoodLine(body, team, senderId, now), QUESTION[field]);
  return { text: lines.join("\n"), keyboard: { inline_keyboard: rows } };
}
