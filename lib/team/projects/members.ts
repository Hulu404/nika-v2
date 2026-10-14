import { tgAdmin } from "../../telegram/supabase";
import type { TeamMember } from "../access";
import { isFounder } from "../config";
import { NIKA, isMissingTable } from "./projects";

/**
 * Участники проектов (project_members, миграция 058): роль, должность и отделы
 * у человека в каждом проекте свои. team_members остаётся реестром людей.
 *
 * До миграции таблицы нет — тогда все из team_members считаются участниками
 * nika с прежними должностью и отделами, и бот работает как раньше.
 */

export type ProjectRole = "admin" | "member";

export interface ProjectMember {
  project_id: string;
  chat_id: number;
  role: ProjectRole;
  title: string | null;
  departments: string[];
  added_by: number | null;
  joined_at: string;
}

export type MemberPatch = Partial<Pick<ProjectMember, "role" | "title" | "departments">>;

export interface MembershipStore {
  ofPerson(chatId: number): Promise<ProjectMember[]>;
  ofProject(projectId: string): Promise<ProjectMember[]>;
  /** Добавить в проект; уже есть — ничего не менять. true — добавил этот вызов. */
  add(row: Pick<ProjectMember, "project_id" | "chat_id"> & Partial<ProjectMember>, now: Date): Promise<boolean>;
  update(projectId: string, chatId: number, patch: MemberPatch): Promise<void>;
  remove(projectId: string, chatId: number): Promise<boolean>;
}

/** Участник nika из старой схемы (до миграции 058). */
const legacy = (m: TeamMember): ProjectMember => ({
  project_id: NIKA, chat_id: m.chat_id, role: "member", title: m.title ?? null,
  departments: m.departments ?? [], added_by: m.added_by, joined_at: m.joined_at,
});

export function supabaseMembershipStore(): MembershipStore {
  const t = () => tgAdmin().from("project_members");
  const legacyTeam = async (): Promise<TeamMember[]> => {
    const { data } = await tgAdmin().from("team_members").select("*");
    return (data ?? []) as TeamMember[];
  };
  const fail = (e: { message: string }) => new Error(`project_members: ${e.message}`);
  return {
    async ofPerson(chatId) {
      const { data, error } = await t().select("*").eq("chat_id", chatId);
      if (error) {
        if (!isMissingTable(error.message)) throw fail(error);
        return (await legacyTeam()).filter((m) => m.chat_id === chatId).map(legacy);
      }
      return (data ?? []) as ProjectMember[];
    },
    async ofProject(projectId) {
      const { data, error } = await t().select("*").eq("project_id", projectId);
      if (error) {
        if (!isMissingTable(error.message)) throw fail(error);
        return projectId === NIKA ? (await legacyTeam()).map(legacy) : [];
      }
      return (data ?? []) as ProjectMember[];
    },
    async add(row, now) {
      const { data, error } = await t().upsert({
        project_id: row.project_id, chat_id: row.chat_id, role: row.role ?? "member", title: row.title ?? null,
        departments: row.departments ?? [], added_by: row.added_by ?? null, joined_at: now.toISOString(),
      }, { onConflict: "project_id,chat_id", ignoreDuplicates: true }).select("chat_id");
      if (error) throw fail(error);
      return (data ?? []).length === 1;
    },
    async update(projectId, chatId, patch) {
      const { error } = await t().update(patch).eq("project_id", projectId).eq("chat_id", chatId);
      if (error) throw fail(error);
    },
    async remove(projectId, chatId) {
      const { data, error } = await t().delete().eq("project_id", projectId).eq("chat_id", chatId).select("chat_id");
      if (error) throw fail(error);
      return (data ?? []).length === 1;
    },
  };
}

export class MemoryMembershipStore implements MembershipStore {
  rows: ProjectMember[] = [];
  async ofPerson(chatId: number) {
    return this.rows.filter((r) => r.chat_id === chatId).map((r) => ({ ...r, departments: [...r.departments] }));
  }
  async ofProject(projectId: string) {
    return this.rows.filter((r) => r.project_id === projectId).map((r) => ({ ...r, departments: [...r.departments] }));
  }
  async add(row: Pick<ProjectMember, "project_id" | "chat_id"> & Partial<ProjectMember>, now: Date) {
    if (this.rows.some((r) => r.project_id === row.project_id && r.chat_id === row.chat_id)) return false;
    this.rows.push({ role: "member", title: null, departments: [], added_by: null, joined_at: now.toISOString(), ...row } as ProjectMember);
    return true;
  }
  async update(projectId: string, chatId: number, patch: MemberPatch) {
    const r = this.rows.find((x) => x.project_id === projectId && x.chat_id === chatId);
    if (r) Object.assign(r, patch);
  }
  async remove(projectId: string, chatId: number) {
    const n = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.project_id === projectId && r.chat_id === chatId));
    return this.rows.length < n;
  }
}

/**
 * Команда проекта: люди из реестра с должностью и отделами из проекта.
 * Фаундеры — админы во всех проектах и видны в каждом.
 */
export function projectTeam(people: readonly TeamMember[], members: readonly ProjectMember[]): TeamMember[] {
  const byChat = new Map(members.map((m) => [m.chat_id, m] as const));
  return people
    .filter((p) => byChat.has(p.chat_id) || isFounder(p.chat_id))
    .map((p) => {
      const m = byChat.get(p.chat_id);
      return m ? { ...p, title: m.title, departments: m.departments } : p;
    });
}
