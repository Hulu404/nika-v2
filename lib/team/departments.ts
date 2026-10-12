/**
 * Отделы команды (team_members.departments). Человек может быть в нескольких.
 * Новый отдел — строка здесь; задачи кофе-рана ставятся по этим ключам
 * (lib/team/coffee-run-template.ts).
 */
export interface Department {
  key: string;
  name: string;
}

export const DEPARTMENTS: readonly Department[] = [
  { key: "smm", name: "СММ" },
  { key: "events", name: "Ивенты" },
  { key: "design", name: "Дизайн" },
  { key: "dev", name: "Разработка" },
];

export function departmentName(key: string): string {
  return DEPARTMENTS.find((d) => d.key === key)?.name ?? key;
}
