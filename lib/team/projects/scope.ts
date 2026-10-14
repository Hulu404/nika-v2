import type { Context } from "grammy";
import { isFounder } from "../config";
import type { MembershipStore, ProjectMember } from "./members";
import { DEFAULT_PROJECTS, NIKA, type Project, type ProjectStore } from "./projects";

/**
 * Область проекта на одно обновление: в каком проекте человек работает,
 * какие проекты у него есть, кто в этом проекте админ. Права, которые раньше
 * назывались «фаундер», теперь «админ проекта»: фаундеры — админы везде.
 *
 * Без области (тесты, старые вызовы) — nika, где админы = фаундеры: всё
 * работает ровно как до проектов.
 */

export interface Scope {
  project: Project;
  /** Проекты человека (у фаундера — все). */
  projects: Project[];
  /** Участники этого проекта. */
  members: ProjectMember[];
  isAdmin: (chatId: number) => boolean;
}

/** Человек в нескольких проектах: видит переключатель и метки проектов. */
export const isMulti = (scope: Scope) => scope.projects.length > 1;

export const DEFAULT_SCOPE: Scope = {
  project: DEFAULT_PROJECTS[0],
  projects: [DEFAULT_PROJECTS[0]],
  members: [],
  isAdmin: isFounder,
};

export interface ScopeDeps {
  projects: ProjectStore;
  memberships: MembershipStore;
}

/** Проекты человека: фаундер — все, остальные — где он участник. */
export async function projectsOf(deps: ScopeDeps, chatId: number): Promise<Project[]> {
  const all = await deps.projects.list();
  if (isFounder(chatId)) return all;
  const mine = new Set((await deps.memberships.ofPerson(chatId)).map((m) => m.project_id));
  return all.filter((p) => mine.has(p.id));
}

/** Область проекта для projectId (без проверки, что человек в нём состоит). */
export async function scopeFor(deps: ScopeDeps, project: Project, projects: Project[]): Promise<Scope> {
  const members = await deps.memberships.ofProject(project.id);
  const admins = new Set(members.filter((m) => m.role === "admin").map((m) => m.chat_id));
  return { project, projects, members, isAdmin: (id) => isFounder(id) || admins.has(id) };
}

/**
 * Область для человека: его текущий проект (current_project), если он в нём
 * состоит, иначе первый из его проектов. preferred — проект записи из старой
 * кнопки или названный в речи. null — человек ни в одном проекте.
 */
export async function resolveScope(deps: ScopeDeps, chatId: number, current: string | null | undefined, preferred?: string): Promise<Scope | null> {
  const mine = await projectsOf(deps, chatId);
  if (!mine.length) return null;
  const project = mine.find((p) => p.id === preferred) ?? mine.find((p) => p.id === current) ?? mine[0];
  return scopeFor(deps, project, mine);
}

const scopes = new WeakMap<object, Scope>();

export function setScope(ctx: Context, scope: Scope): void {
  scopes.set(ctx, scope);
}

/** Область этого обновления; не задана — nika (как до проектов). */
export function scopeOf(ctx: Context | object | undefined): Scope {
  return (ctx && scopes.get(ctx)) || DEFAULT_SCOPE;
}

export const projectIdOf = (ctx: Context | object | undefined) => scopeOf(ctx).project.id;

const defaultDeps = async (): Promise<ScopeDeps> => {
  const [{ supabaseProjectStore }, { supabaseMembershipStore }] = await Promise.all([import("./projects"), import("./members")]);
  return { projects: supabaseProjectStore(), memberships: supabaseMembershipStore() };
};

/**
 * Область проекта записи из старой кнопки: действие выполняется в проекте
 * задачи или события, а не в current_project, — с правами в нём. null —
 * человек в этом проекте не состоит.
 */
export async function scopeForRecord(ctx: Context, projectId: string, deps?: ScopeDeps): Promise<Scope | null> {
  const base = scopeOf(ctx);
  if (base.project.id === projectId) return base;
  const project = base.projects.find((p) => p.id === projectId);
  if (!project) return null;
  return scopeFor(deps ?? (await defaultDeps()), project, base.projects);
}

/** Запись (задача, событие) из старой кнопки — в каком она проекте. */
export const recordProject = (r: { project_id?: string | null } | null | undefined) => r?.project_id ?? NIKA;
