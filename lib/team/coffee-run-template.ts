import { addDays } from "../databot/time";

/**
 * Повторяющиеся задачи кофе-рана недели. Правятся здесь, без изменения логики
 * (lib/team/coffee-run-week.ts): текст, отдел и срок. Каждая задача ставится
 * всем текущим участникам отдела одной строкой — у каждого свой статус.
 *
 * Сроки — московское время, от недели кофе-рана: weekStart — понедельник,
 * runDate — день забега (YYYY-MM-DD).
 */
export interface CoffeeRunTaskTemplate {
  department: string;
  what: string;
  due: (week: { weekStart: string; runDate: string }) => { ymd: string; time: string };
}

export const COFFEE_RUN_TASKS: readonly CoffeeRunTaskTemplate[] = [
  { department: "smm", what: "Анонс кофе-рана: пост в ТГК и Instagram",
    due: ({ weekStart }) => ({ ymd: addDays(weekStart, 1), time: "12:00" }) },
  { department: "smm", what: "Рилсы про кофе-ран на внутреннюю и внешнюю аудиторию",
    due: ({ weekStart }) => ({ ymd: addDays(weekStart, 2), time: "23:59" }) },
  { department: "smm", what: "Шорт-контент про кофе-ран в других соцсетях",
    due: ({ weekStart }) => ({ ymd: addDays(weekStart, 2), time: "23:59" }) },
  { department: "events", what: "Найти пейсеров (ведущих групп) на кофе-ран",
    due: ({ runDate }) => ({ ymd: addDays(runDate, -2), time: "20:00" }) },
  // Срок в брифе не задан: до вторника 18:00, чтобы пост вышел вместе с анонсом СММ.
  { department: "events", what: "Договориться о посте-анонсе в Surf Coffee",
    due: ({ weekStart }) => ({ ymd: addDays(weekStart, 1), time: "18:00" }) },
];
