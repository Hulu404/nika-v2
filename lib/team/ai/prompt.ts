import { addDays, mskToday } from "../../databot/time";
import { mskWeekday } from "../../databot/dates";
import type { TeamMember } from "../access";
import { isFounder } from "../config";
import { DEPARTMENTS } from "../departments";
import { personName } from "../roster";

/**
 * Системная инструкция ассистента: правила поведения и контекст — время по
 * Москве, состав команды и отделы, открытый черновик, последний показанный
 * список. Людей в контексте ровно столько, сколько нужно понять имена:
 * имя, должность, отделы, ник. Ни телефонов, ни участников забегов.
 */

const WEEKDAYS = ["", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];

export const ASSISTANT_RULES = [
  "Ты рабочий ассистент команды НИКА в Telegram, тебя зовут Пятница.",
];

export interface PromptContext {
  now: Date;
  team: readonly TeamMember[];
  senderId: number;
  /** Открытый черновик, ждёт «✅ Подтвердить». */
  draft?: string | null;
  /** Последний показанный список с номерами. */
  list?: string | null;
}

function clock(now: Date): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

export function assistantPrompt(ctx: PromptContext): string {
  const today = mskToday(ctx.now);
  const calendar = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(today, i);
    return `${WEEKDAYS[mskWeekday(d)]} ${d}`;
  }).join("; ");
  const me = ctx.team.find((m) => m.chat_id === ctx.senderId);
  const people = ctx.team.map((m) =>
    `- ${personName(m)}${m.title ? `, ${m.title}` : ""}${m.username ? `, @${m.username}` : ""}${isFounder(m.chat_id) ? ", фаундер" : ""}`);
  const departments = DEPARTMENTS.map((d) => {
    const names = ctx.team.filter((m) => (m.departments ?? []).includes(d.key)).map(personName);
    return `- ${d.group}: ${names.join(", ") || "никого"}`;
  });
  return [
    ...ASSISTANT_RULES,
    "",
    `Сейчас ${WEEKDAYS[mskWeekday(today)]} ${today}, ${clock(ctx.now)} по Москве. Ближайшие дни: ${calendar}.`,
    `Тебе пишет ${me ? personName(me) : "участник команды"}${isFounder(ctx.senderId) ? " (фаундер: видит и меняет задачи всей команды)" : " (не фаундер: видит только свои задачи и поставленные им)"}.`,
    "Команда:",
    ...people,
    "Отделы:",
    ...departments,
    ...(ctx.draft ? ["", ctx.draft] : []),
    ...(ctx.list ? ["", ctx.list] : []),
  ].join("\n");
}
