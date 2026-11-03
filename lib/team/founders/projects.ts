import { listProjectTeam } from "../access";
import { supabaseProjectStore } from "../projects/projects";
import type { FounderDigestDeps } from "./digest";

/** Сводка фаундерам по проектам: список проектов и команда каждого. */
export function founderProjectDeps(): Pick<FounderDigestDeps, "projects" | "teamOf" | "projectExtra"> {
  return {
    projects: () => supabaseProjectStore().list(),
    teamOf: (projectId) => listProjectTeam(projectId),
    projectExtra: async () => [],
  };
}
