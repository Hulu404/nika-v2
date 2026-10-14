import type { TeamMember } from "./access";
import { departmentName, matchDepartment, type Department } from "./departments";

/**
 * Состав команды в коде: имя, должность, отделы и варианты имени по нику.
 * Опроса «как тебя зовут» нет — эти данные пишутся сами при /join, /start и
 * один раз при старте приложения (access.ts → applyRoster), но только в
 * пустые поля и только тем, чей профиль ещё не меняли в боте.
 *
 * Должность прав не даёт: фаундеры — TEAM_FOUNDER_IDS (config.ts).
 */

export interface RosterEntry {
  username: string;
  firstName: string;
  /** Творительный падеж имени — для «встреча с …». Склонения код не собирает. */
  nameInstr: string;
  title: string;
  departments: string[];
  aliases: string[];
}

export const ROSTER: readonly RosterEntry[] = [
  { username: "zuzya_zyzya", firstName: "Настя", nameInstr: "Настей", title: "Глава SMM", departments: ["smm"], aliases: [] },
  { username: "ananas_2711", firstName: "Настя", nameInstr: "Настей", title: "SMM", departments: ["smm"], aliases: [] },
  { username: "tora_co", firstName: "Вика", nameInstr: "Викой", title: "SMM", departments: ["smm"], aliases: [] },
  { username: "dissidenceandtea", firstName: "Вика", nameInstr: "Викой", title: "Разработчик", departments: ["dev"], aliases: [] },
  { username: "mouserdyuk", firstName: "Маша", nameInstr: "Машей", title: "Главный дизайнер", departments: ["design"], aliases: [] },
  { username: "gusarovame", firstName: "Маша", nameInstr: "Машей", title: "Ивент-отдел", departments: ["events"], aliases: [] },
  { username: "salmasxsx", firstName: "Сальма", nameInstr: "Сальмой", title: "Ивент-отдел", departments: ["events"], aliases: [] },
  { username: "Hulu404", firstName: "Али", nameInstr: "Али", title: "COO, фаундер", departments: [], aliases: [] },
  { username: "srbrkvss", firstName: "Дмитрий", nameInstr: "Дмитрием", title: "CEO, фаундер", departments: [], aliases: ["Дима"] },
];

/** Должность и отделы человека в проекте (project_members). */
export interface ProjectRosterEntry {
  username: string;
  title: string;
  departments: string[];
}

/**
 * Состав по проектам. nika — как в ROSTER; rescan — Вика и Маша. Фаундеры
 * (TEAM_FOUNDER_IDS) — админы во всех проектах сами, их здесь нет.
 */
export const PROJECT_ROSTER: Readonly<Record<string, readonly ProjectRosterEntry[]>> = {
  nika: ROSTER.filter((r) => !/фаундер/i.test(r.title)).map((r) => ({ username: r.username, title: r.title, departments: r.departments })),
  rescan: [
    { username: "dissidenceandtea", title: "Разработчик", departments: ["dev"] },
    { username: "mouserdyuk", title: "Дизайнер", departments: ["design"] },
  ],
};

/** Ник без «@» и регистра. */
export const normUsername = (u: string | null | undefined) => (u ?? "").trim().replace(/^@/, "").toLowerCase();

export function rosterFor(username: string | null | undefined): RosterEntry | null {
  const u = normUsername(username);
  return u ? (ROSTER.find((r) => normUsername(r.username) === u) ?? null) : null;
}

export type ProfilePatch = Partial<Pick<TeamMember, "first_name" | "title" | "departments" | "name_aliases">>;

/** Что дописать человеку из ROSTER: только пустые поля и только если профиль не меняли в боте. */
export function rosterPatch(m: TeamMember): ProfilePatch | null {
  const r = rosterFor(m.username);
  if (!r || m.profile_edited_at) return null;
  const patch: ProfilePatch = {};
  if (!m.first_name) patch.first_name = r.firstName;
  if (!m.title) patch.title = r.title;
  if (!(m.departments ?? []).length && r.departments.length) patch.departments = r.departments;
  if (!(m.name_aliases ?? []).length && r.aliases.length) patch.name_aliases = r.aliases;
  return Object.keys(patch).length ? patch : null;
}

/** Творительный по имени, если имя поменяли в боте, а ник не из ROSTER. */
const INSTR_BY_NAME: Record<string, string> = {
  Настя: "Настей", Вика: "Викой", Маша: "Машей", Сальма: "Сальмой", Али: "Али", Дмитрий: "Дмитрием", Дима: "Димой",
};

/** «Машей» — для «встреча с …»; null — готовой формы нет, тогда список без предлога. */
export function nameInstr(m: Pick<TeamMember, "first_name" | "display_name" | "username" | "chat_id">): string | null {
  const name = personName(m);
  const r = rosterFor(m.username);
  if (r && r.firstName === name) return r.nameInstr;
  return INSTR_BY_NAME[name] ?? null;
}

// ── Подписи ──────────────────────────────────────────────────────────────────

/** «Маша»; без имени — имя из Telegram или ник. */
export function personName(m: Pick<TeamMember, "first_name" | "display_name" | "username" | "chat_id">): string {
  return m.first_name || m.display_name || (m.username ? `@${m.username}` : String(m.chat_id));
}

/**
 * Человек на всех экранах: «Маша (Ивент-отдел) @gusarovame», без должности —
 * «Али @Hulu404», отправитель — «ты». Имя всегда в именительном.
 */
export function personLabel(m: TeamMember, senderId?: number): string {
  if (senderId !== undefined && m.chat_id === senderId) return "ты";
  return `${personName(m)}${m.title ? ` (${m.title})` : ""}${m.username ? ` @${m.username}` : ""}`;
}

/** Внутри отдела должность не повторяем: «Ивент-отдел: Маша @gusarovame, Сальма @salmasxsx». */
export function personShort(m: TeamMember): string {
  return `${personName(m)}${m.username ? ` @${m.username}` : ""}`;
}

// ── Поиск человека по фразе ──────────────────────────────────────────────────
// Делает код, не модель: модель отдаёт упоминание как в тексте («Маше»,
// уточнение «из ивента»), здесь — падеж, уточнение и выбор.

const ENDINGS = ["ями", "ами", "ой", "ей", "ою", "ею", "ям", "ам", "ах", "ях", "ия", "ию", "ий", "ие", "а", "я", "е", "у", "ю", "ы", "и", "о", "ь", "й"];

/** Грубая основа слова: Маше, Машу, Маши, Машей → маш; Дмитрию → дмитр. */
export function stem(word: string): string {
  const w = word.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9_]/g, "");
  for (const e of ENDINGS) if (w.endsWith(e) && w.length - e.length >= 2) return w.slice(0, -e.length);
  return w;
}

const SELF = new Set(["я", "мне", "меня", "мной", "мною", "себе", "себя", "собой", "сам", "сама", "самой", "самому"]);
const STOP = new Set(["из", "с", "со", "от", "по", "для", "в", "во", "на", "и", "к", "ко", "у"]);

/** Слова, по которым узнаётся должность и отдел. */
function profileText(m: TeamMember): string {
  const deps = (m.departments ?? []).flatMap((d) => [d, departmentName(d)]);
  return `${m.title ?? ""} ${deps.join(" ")}`.toLowerCase().replace(/ё/g, "е")
    .replace(/smm/g, "smm смм").replace(/events?/g, "ивент").replace(/design/g, "дизайн").replace(/\bdev\b/g, "разработ");
}

function qualifierScore(m: TeamMember, words: readonly string[]): number {
  const text = profileText(m);
  return words.filter((w) => text.includes(w)).length;
}

/** Строки отличаются не больше чем на одну правку (замена, вставка, удаление). */
function oneEditApart(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i);
}

export type MentionMatch =
  | { kind: "one"; member: TeamMember }
  | { kind: "many"; options: TeamMember[] }
  | { kind: "none"; name: string }
  /** Отдел, названный сам по себе: все его участники, кроме отправителя (может быть пусто). */
  | { kind: "department"; department: Department; members: TeamMember[] };

/**
 * Упоминание → человек. Совпадение по имени, вариантам имени и нику; если
 * совпало несколько — сужение по уточнению (должность, отдел); не сузилось —
 * выбор кнопками, первого попавшегося не берём никогда.
 *
 * Отдел — только когда назван сам по себе («с ивент-отделом», «СММ»): «Маше
 * из ивента» — это человек с уточнением. Отправитель в раскрытие отдела не
 * входит: себя он добавляет сам («и мне»).
 */
export function resolveMention(team: readonly TeamMember[], mention: { name: string; qualifier: string | null }, senderId: number): MentionMatch {
  // «Маше-дизайнеру», «Маше из ивента» в одном поле — имя первое слово, остальное к уточнению.
  const tokens = mention.name.toLowerCase().split(/[\s\-—,]+/).filter(Boolean);
  const rest = tokens.filter((t) => !SELF.has(t) && !STOP.has(t) && t !== "со");
  if (tokens.some((t) => SELF.has(t)) && !rest.length) {
    const me = team.find((m) => m.chat_id === senderId);
    return me ? { kind: "one", member: me } : { kind: "none", name: mention.name };
  }
  const [head, ...tail] = rest;
  if (!head) return { kind: "none", name: mention.name };
  const user = normUsername(head);
  const key = stem(head);
  let found = team.filter((m) =>
    normUsername(m.username) === user ||
    [m.first_name, ...(m.name_aliases ?? [])].some((n) => n && stem(n) === key));
  if (!found.length) {
    const department = matchDepartment(`${mention.name} ${mention.qualifier ?? ""}`);
    if (department) {
      return { kind: "department", department, members: team.filter((m) => m.chat_id !== senderId && (m.departments ?? []).includes(department.key)) };
    }
    // Кривое распознавание голоса («сальва» вместо «Сальма»): одна буква разницы в основе имени.
    if (key.length >= 4) {
      found = team.filter((m) => [m.first_name, ...(m.name_aliases ?? [])].some((n) => n && stem(n).length >= 4 && oneEditApart(stem(n), key)));
    }
    if (!found.length) return { kind: "none", name: mention.name };
  }
  if (found.length > 1) {
    const words = [...tail, ...(mention.qualifier ?? "").toLowerCase().split(/[\s\-—,]+/)]
      .filter((w) => w && !STOP.has(w)).map((w) => stem(w).slice(0, 5)).filter((w) => w.length >= 3);
    if (words.length) {
      const scores = found.map((m) => qualifierScore(m, words));
      const best = Math.max(...scores);
      if (best > 0) found = found.filter((_, i) => scores[i] === best);
    }
  }
  return found.length === 1 ? { kind: "one", member: found[0] } : { kind: "many", options: found };
}
