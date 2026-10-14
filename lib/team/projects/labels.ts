import { isFounder } from "../config";
import type { MembershipStore } from "./members";
import { NIKA, projectLabel, type Project, type ProjectStore } from "./projects";

/**
 * Метка проекта в уведомлениях: человеку в нескольких проектах —
 * «🔬 RESCAN · Через 3 часа срок: …», человеку в одном проекте — без метки.
 * Состав читается из базы не чаще раза в минуту.
 */

export interface LabelDeps {
  projects: ProjectStore;
  memberships: MembershipStore;
}

const TTL_MS = 60_000;
let deps: LabelDeps | null = null;
let projectsCache: { at: number; list: Project[] } | null = null;
const personCache = new Map<number, { at: number; ids: string[] }>();

/** Для тестов: свои хранилища; null — снова база. Сбрасывает кеш. */
export function configureLabels(next: LabelDeps | null): void {
  deps = next;
  projectsCache = null;
  personCache.clear();
}

async function labelDeps(): Promise<LabelDeps> {
  if (deps) return deps;
  const [{ supabaseProjectStore }, { supabaseMembershipStore }] = await Promise.all([import("./projects"), import("./members")]);
  return { projects: supabaseProjectStore(), memberships: supabaseMembershipStore() };
}

async function projects(d: LabelDeps, now: number): Promise<Project[]> {
  if (!projectsCache || now - projectsCache.at > TTL_MS) projectsCache = { at: now, list: await d.projects.list() };
  return projectsCache.list;
}

/** Проекты человека (фаундер — все). */
export async function projectIdsOf(chatId: number, now = Date.now()): Promise<string[]> {
  const d = await labelDeps();
  const all = await projects(d, now);
  if (isFounder(chatId)) return all.map((p) => p.id);
  const hit = personCache.get(chatId);
  if (hit && now - hit.at <= TTL_MS) return hit.ids;
  const mine = new Set((await d.memberships.ofPerson(chatId)).map((m) => m.project_id));
  const ids = all.filter((p) => mine.has(p.id)).map((p) => p.id);
  personCache.set(chatId, { at: now, ids });
  return ids;
}

/** «🔬 RESCAN · » — если человек в нескольких проектах; иначе пусто. Ошибка базы — без метки. */
export async function projectPrefix(chatId: number, projectId: string | null | undefined): Promise<string> {
  try {
    const now = Date.now();
    const ids = await projectIdsOf(chatId, now);
    if (ids.length < 2) return "";
    const project = (await projects(await labelDeps(), now)).find((p) => p.id === (projectId ?? NIKA));
    return project ? `${projectLabel(project)} · ` : "";
  } catch {
    return "";
  }
}

/** Поставить метку перед текстом (HTML-безопасна: в названии проекта нет разметки). */
export async function withProjectLabel(chatId: number, projectId: string | null | undefined, text: string): Promise<string> {
  return `${await projectPrefix(chatId, projectId)}${text}`;
}
