import { listProjectTeam } from "../access";
import { supabaseProjectStore, type Project } from "../projects/projects";
import type { FounderDigestDeps } from "./digest";

/**
 * Сводка фаундерам по проектам: список проектов, команда каждого и строки
 * модулей (план развития — lib/team/roadmap). Модуль, у которого есть что
 * сказать в сводке, регистрирует себя здесь.
 */

type ExtraFn = (project: Project, now: Date) => Promise<string[]>;
const extras: ExtraFn[] = [];

export function registerFounderDigestExtra(fn: ExtraFn): void {
  if (!extras.includes(fn)) extras.push(fn);
}

export function founderProjectDeps(): Pick<FounderDigestDeps, "projects" | "teamOf" | "projectExtra"> {
  return {
    projects: () => supabaseProjectStore().list(),
    teamOf: (projectId) => listProjectTeam(projectId),
    projectExtra: async (project, now) => (await Promise.all(extras.map((fn) => fn(project, now).catch(() => [])))).flat(),
  };
}
