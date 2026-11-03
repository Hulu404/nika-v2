import { CORE_MODULES, DEFAULT_PROJECTS, type Project } from "./projects";

/**
 * Второй проект для тестов многопроектности. Рабочий проект в боте сейчас
 * один (RESCAN закрыт, RETIRED_PROJECTS), но области проектов, метки и
 * приглашения остаются — их проверяют на этом проекте.
 */
export const LAB = "lab";
export const LAB_PROJECT: Project = { id: LAB, name: "LAB", emoji: "🧪", modules: [...CORE_MODULES], sort: 2 };
export const TEST_PROJECTS: readonly Project[] = [...DEFAULT_PROJECTS, LAB_PROJECT];
export const testProjects = (): Project[] => TEST_PROJECTS.map((p) => ({ ...p, modules: [...p.modules] }));
