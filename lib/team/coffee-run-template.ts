import { mskWeekday } from "../databot/dates";
import { addDays } from "../databot/time";
import type { TeamMember } from "./access";
import { normUsername } from "./roster";

/**
 * Задачи кофе-рана недели. Правятся здесь, без изменения логики
 * (lib/team/coffee-run-week.ts).
 *
 * От каждого отдела — одна задача его ответственному за кофе-ран
 * (team_settings, по умолчанию — глава отдела): заголовок и чек-лист с
 * ориентирами. Внутри отдела ответственный раздаёт задачи сам — кнопка
 * «➕ Раздать задачи отделу» в сообщении с задачей.
 *
 * Сроки — московское время, от недели кофе-рана: weekStart — понедельник,
 * runDate — день забега (YYYY-MM-DD).
 */

export interface CoffeeWeek {
  weekStart: string;
  runDate: string;
}

export interface CoffeeOwnerTask {
  department: string;
  /** Ключ team_settings: chat_id ответственного. */
  setting: string;
  /** Ответственный по умолчанию (ник). */
  defaultOwner: string;
  /** «Ответственный за кофе-ран: SMM» — в «👥 Команда». */
  role: string;
  title: (label: string) => string;
  checklist: (week: CoffeeWeek) => string[];
  due: (week: CoffeeWeek) => { ymd: string; time: string };
}

const WD = ["", "пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const day = (ymd: string) => WD[mskWeekday(ymd)];

export const COFFEE_OWNER_TASKS: readonly CoffeeOwnerTask[] = [
  {
    department: "smm", setting: "coffee_run_smm_owner", defaultOwner: "zuzya_zyzya", role: "SMM",
    title: (label) => `${label}: контент и анонсы`,
    checklist: () => [
      "анонс-пост в ТГК и Instagram, до вт 12:00",
      "рилсы на внутреннюю и внешнюю аудиторию, до ср 23:59",
      "шорт-контент в других соцсетях, до ср 23:59",
      "распределить задачи внутри отдела — кнопка «➕ Раздать задачи отделу»",
    ],
    // К этому моменту анонс вышел и работа распределена.
    due: ({ weekStart }) => ({ ymd: addDays(weekStart, 1), time: "12:00" }),
  },
  {
    department: "events", setting: "coffee_run_events_owner", defaultOwner: "salmasxsx", role: "ивенты",
    title: (label) => `${label}: пейсеры и договорённости`,
    checklist: ({ runDate }) => [
      "договориться о посте-анонсе в Surf Coffee, до вт 18:00",
      `найти пейсеров (ведущих групп), до ${day(addDays(runDate, -2))} 20:00`,
      "договорённости с площадкой и партнёрами на день забега",
      "распределить задачи внутри отдела — кнопка «➕ Раздать задачи отделу»",
    ],
    // Первый ориентир — пост в Surf Coffee вместе с анонсом SMM.
    due: ({ weekStart }) => ({ ymd: addDays(weekStart, 1), time: "18:00" }),
  },
];

/** Текст задачи: заголовок и чек-лист. */
export function coffeeOwnerTaskText(t: CoffeeOwnerTask, label: string, week: CoffeeWeek): string {
  return [t.title(label), ...t.checklist(week).map((l) => `— ${l}`)].join("\n");
}

/** Кому задача отдела: из настройки (chat_id), иначе ответственный по умолчанию. */
export function coffeeOwner(t: Pick<CoffeeOwnerTask, "defaultOwner">, team: readonly TeamMember[], setting: string | null): TeamMember | null {
  const byId = setting && /^-?\d+$/.test(setting) ? team.find((m) => m.chat_id === Number(setting)) : undefined;
  return byId ?? team.find((m) => normUsername(m.username) === t.defaultOwner) ?? null;
}

/** Тексты задач кофе-рана до октября 2026 (по пять задач всем участникам отделов) — для разовой чистки. */
export const LEGACY_COFFEE_TASKS: readonly string[] = [
  "Анонс кофе-рана: пост в ТГК и Instagram",
  "Рилсы про кофе-ран на внутреннюю и внешнюю аудиторию",
  "Шорт-контент про кофе-ран в других соцсетях",
  "Найти пейсеров (ведущих групп) на кофе-ран",
  "Договориться о посте-анонсе в Surf Coffee",
];
