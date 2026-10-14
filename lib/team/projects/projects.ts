import { tgAdmin } from "../../telegram/supabase";

/**
 * Проекты компании JBD в «Пятнице» (миграция 058). Человек может быть в одном
 * проекте или в нескольких; для человека из одного проекта бот выглядит как
 * раньше — без переключателя и упоминаний других проектов.
 *
 * Модули: ядро у всех (tasks, schedule, team, my_day, assistant), остальное —
 * по проекту. Кнопки, команды, тикеры и инструменты ассистента появляются
 * только у проектов с нужным модулем.
 */

export type ModuleKey =
  | "tasks" | "schedule" | "team" | "my_day" | "assistant"
  | "events" | "coffee_run" | "attendance" | "founders_digest" | "social"
  | "roadmap" | "about";

export interface Project {
  id: string;
  name: string;
  emoji: string;
  modules: string[];
  sort: number;
}

export const CORE_MODULES: readonly ModuleKey[] = ["tasks", "schedule", "team", "my_day", "assistant"];
export const NIKA = "nika";
export const RESCAN = "rescan";

/** Проекты по умолчанию — те же, что создаёт миграция 058. До миграции бот работает на них. */
export const DEFAULT_PROJECTS: readonly Project[] = [
  { id: NIKA, name: "NIKA", emoji: "🏃", modules: [...CORE_MODULES, "events", "coffee_run", "attendance", "founders_digest", "social"], sort: 1 },
  { id: RESCAN, name: "RESCAN", emoji: "🔬", modules: [...CORE_MODULES, "roadmap", "about"], sort: 2 },
];

export const hasModule = (p: Pick<Project, "modules">, m: ModuleKey) => p.modules.includes(m);

/** «🔬 RESCAN». */
export const projectLabel = (p: Pick<Project, "emoji" | "name">) => `${p.emoji ? `${p.emoji} ` : ""}${p.name}`;

export interface ProjectStore {
  list(): Promise<Project[]>;
}

/** Нет таблицы (миграция ещё не применена) — проекты по умолчанию. */
export const isMissingTable = (message: string) => /does not exist|could not find the table|relation .* does not exist|schema cache/i.test(message);

export function supabaseProjectStore(): ProjectStore {
  return {
    async list() {
      const { data, error } = await tgAdmin().from("projects").select("*").order("sort");
      if (error) {
        if (!isMissingTable(error.message)) console.error("[projects] list:", error.message);
        return DEFAULT_PROJECTS.map((p) => ({ ...p, modules: [...p.modules] }));
      }
      return ((data ?? []) as Project[]).map((p) => ({ ...p, modules: p.modules ?? [] }));
    },
  };
}

export class MemoryProjectStore implements ProjectStore {
  constructor(public projects: Project[] = DEFAULT_PROJECTS.map((p) => ({ ...p, modules: [...p.modules] }))) {}
  async list() {
    return [...this.projects].sort((a, b) => a.sort - b.sort);
  }
}

/** Как проект называют по-русски, в том числе в распознанном голосе. */
const SPOKEN: Record<string, RegExp> = {
  // «Ника» бывает и именем — проект только со словом «проект»: «в проекте Ника».
  nika: /проект\S*\s+«?ник(а|е|и|у|ой)(?![а-яё])/i,
  rescan: /р[еи]скан/i,
};

/**
 * Проект, явно названный во фразе («в рескане поставь Вике…», «в NIKA») —
 * из проектов человека. Названо несколько или ни одного — null.
 */
export function projectInText(text: string, projects: readonly Project[]): Project | null {
  const found = projects.filter((p) => {
    const latin = p.name.replace(/[^a-z0-9]/gi, "");
    return (latin && new RegExp(`(^|[^a-z0-9])${latin}([^a-z0-9]|$)`, "i").test(text)) || (SPOKEN[p.id]?.test(text) ?? false);
  });
  return found.length === 1 ? found[0] : null;
}
