/**
 * Отделы команды (team_members.departments). Человек может быть в нескольких.
 * Новый отдел — строка здесь; задачи кофе-рана ставятся по этим ключам
 * (lib/team/coffee-run-template.ts).
 *
 * group — отдел как группа людей в списках («Ивент-отдел: Маша, Сальма»),
 * groupInstr — готовая форма для «встреча с …» (склонения код не собирает);
 * roots — корни, по которым код узнаёт отдел во фразе, в том числе в кривом
 * распознавании голоса («ивента дел», «смм-щикам»).
 */
export interface Department {
  key: string;
  name: string;
  group: string;
  groupInstr: string;
  roots: RegExp;
}

export const DEPARTMENTS: readonly Department[] = [
  { key: "smm", name: "СММ", group: "SMM", groupInstr: "SMM-отделом", roots: /смм|smm|эсэмэм/ },
  { key: "events", name: "Ивенты", group: "Ивент-отдел", groupInstr: "ивент-отделом", roots: /ивент|event/ },
  { key: "design", name: "Дизайн", group: "Дизайн", groupInstr: "отделом дизайна", roots: /дизайн|design/ },
  { key: "dev", name: "Разработка", group: "Разработка", groupInstr: "отделом разработки", roots: /разраб|\bdev|программист/ },
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
