/**
 * Отделы команды (team_members.departments). Человек может быть в нескольких.
 * Новый отдел — строка здесь; задачи кофе-рана ставятся по этим ключам
 * (lib/team/coffee-run-template.ts).
 *
 * group — как отдел называют группой людей («с ивент-отделом»); roots — корни,
 * по которым код узнаёт отдел во фразе, в том числе в кривом распознавании
 * голоса («ивента дел», «смм-щикам»).
 */
export interface Department {
  key: string;
  name: string;
  group: string;
  roots: RegExp;
}

export const DEPARTMENTS: readonly Department[] = [
  { key: "smm", name: "СММ", group: "СММ", roots: /смм|smm|эсэмэм/ },
  { key: "events", name: "Ивенты", group: "Ивент-отдел", roots: /ивент|event/ },
  { key: "design", name: "Дизайн", group: "Дизайн", roots: /дизайн|design/ },
  { key: "dev", name: "Разработка", group: "Разработка", roots: /разраб|\bdev|программист/ },
];

export function departmentName(key: string): string {
  return DEPARTMENTS.find((d) => d.key === key)?.name ?? key;
}

/** Отдел по фразе: «с ивент-отделом», «СММ», «дизайну». null — отдела в тексте нет или их несколько. */
export function matchDepartment(text: string): Department | null {
  const t = text.toLowerCase().replace(/ё/g, "е");
  const found = DEPARTMENTS.filter((d) => d.roots.test(t));
  return found.length === 1 ? found[0] : null;
}
