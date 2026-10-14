import { listProjectTeam } from "../access";
import { hasModule, supabaseProjectStore } from "../projects/projects";
import { roadmapDigestLines } from "../roadmap/reminders";
import { supabaseRoadmapStore } from "../roadmap/store";
import type { FounderDigestDeps } from "./digest";

/**
 * Сводка фаундерам по проектам: список проектов, команда каждого и строки
 * модулей — у проекта с планом развития ближайшая точка и просрочки.
 */
export function founderProjectDeps(): Pick<FounderDigestDeps, "projects" | "teamOf" | "projectExtra"> {
  return {
    projects: () => supabaseProjectStore().list(),
    teamOf: (projectId) => listProjectTeam(projectId),
    projectExtra: async (project, now) => (hasModule(project, "roadmap")
      ? roadmapDigestLines(supabaseRoadmapStore(), await listProjectTeam(project.id), project.id, now).catch(() => [])
      : []),
  };
}
