import { tgAdmin } from "../../telegram/supabase";
import type { ProjectRole } from "./members";

/**
 * Приглашения в проект (project_invites, миграция 059): одноразовая ссылка
 * t.me/<bot>?start=join_<token>, 7 дней. Использованная и просроченная не
 * работают; погашение — одним UPDATE … WHERE used_by IS NULL.
 */

export const INVITE_TTL_MS = 7 * 86_400_000;

export interface ProjectInvite {
  token: string;
  project_id: string;
  role: ProjectRole;
  title: string | null;
  departments: string[];
  created_by: number;
  created_at: string;
  expires_at: string;
  used_by: number | null;
  used_at: string | null;
}

export interface InviteStore {
  create(row: { project_id: string; role?: ProjectRole; title?: string | null; departments?: string[]; created_by: number }, now: Date): Promise<ProjectInvite>;
  /** Погасить: приглашение, если оно было действующим и этот вызов его погасил; иначе null. */
  redeem(token: string, chatId: number, now: Date): Promise<ProjectInvite | null>;
}

/** Токен для ссылки: 16 случайных байт, base64url (влезает в start-параметр Telegram). */
export function newInviteToken(): string {
  // globalThis.crypto есть и в Node, и в edge-сборке instrumentation (node:crypto там нет).
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Buffer.from(bytes).toString("base64url");
}

export const inviteLink = (botUsername: string, token: string) => `https://t.me/${botUsername}?start=join_${token}`;

export function supabaseInviteStore(): InviteStore {
  const t = () => tgAdmin().from("project_invites");
  return {
    async create(row, now) {
      const { data, error } = await t().insert({
        token: newInviteToken(), project_id: row.project_id, role: row.role ?? "member", title: row.title ?? null,
        departments: row.departments ?? [], created_by: row.created_by, created_at: now.toISOString(),
        expires_at: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
      }).select("*").single();
      if (error) throw new Error(`project_invites: ${error.message}`);
      return data as ProjectInvite;
    },
    async redeem(token, chatId, now) {
      const { data, error } = await t().update({ used_by: chatId, used_at: now.toISOString() })
        .eq("token", token).is("used_by", null).gt("expires_at", now.toISOString()).select("*");
      if (error) throw new Error(`project_invites: ${error.message}`);
      return ((data ?? [])[0] as ProjectInvite | undefined) ?? null;
    },
  };
}

export class MemoryInviteStore implements InviteStore {
  invites = new Map<string, ProjectInvite>();
  async create(row: { project_id: string; role?: ProjectRole; title?: string | null; departments?: string[]; created_by: number }, now: Date) {
    const inv: ProjectInvite = {
      token: newInviteToken(), project_id: row.project_id, role: row.role ?? "member", title: row.title ?? null,
      departments: row.departments ?? [], created_by: row.created_by, created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + INVITE_TTL_MS).toISOString(), used_by: null, used_at: null,
    };
    this.invites.set(inv.token, inv);
    return { ...inv };
  }
  async redeem(token: string, chatId: number, now: Date) {
    const inv = this.invites.get(token);
    if (!inv || inv.used_by !== null || Date.parse(inv.expires_at) <= now.getTime()) return null;
    Object.assign(inv, { used_by: chatId, used_at: now.toISOString() });
    return { ...inv };
  }
}
