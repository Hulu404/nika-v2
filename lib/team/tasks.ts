import type { Context } from "grammy";
import { handleAssignedUpdate } from "../databot/assigned-handler";
import { ASSIGNED_CALLBACK } from "../databot/assigned-view";
import { createSupabaseStore } from "../databot/data/supabase-store";
import type { DatabotStore } from "../databot/data/store";
import type { Zone } from "../databot/types";
import { findMember, listTeam, type TeamMember } from "./access";
import { isFounder } from "./config";

const TASK_COMMAND = /^\/(?:tasks|assign|tasks_add|assigned|assign_retry|assign_status|assign_cancel|assign_edit|assign_due|cancel)(?:@[a-z0-9_]+)?(?=\s|$)/i;

export interface TeamTaskDeps {
  store: DatabotStore;
  findMember: (chatId: number) => Promise<TeamMember | null>;
  listTeam: () => Promise<TeamMember[]>;
}

function defaultDeps(): TeamTaskDeps {
  return { store: createSupabaseStore(), findMember, listTeam };
}

/**
 * Assigned-task RPCs use databot_members for stable Telegram ID bindings.
 * Mirror the existing team roster before handling a task update so «Пятница»
 * can deliver to members who already joined with /join.
 */
export async function syncTeamTaskMembers(deps: TeamTaskDeps, now: Date, members: TeamMember[]): Promise<void> {
  if (!members.length) throw new Error("team task roster is empty");
  for (const member of members) {
    const founder = isFounder(member.chat_id);
    const zone: Zone = founder ? "council" : "smm";
    await deps.store.upsertMember({
      chat_id: member.chat_id,
      username: member.username,
      display_name: member.display_name,
      zone,
      is_owner: founder,
      invited_by: member.added_by,
    }, now);
  }
}

/** Task commands and buttons for the existing team bot. Other updates keep
 * flowing to its run, FAQ, and digest handlers. */
export async function handleTeamTaskUpdate(ctx: Context, providedDeps?: TeamTaskDeps, now = new Date()): Promise<boolean> {
  if (ctx.chat?.type !== "private" || !ctx.from || ctx.chat.id !== ctx.from.id) return false;
  const text = ctx.message?.text?.trim() ?? "";
  const command = TASK_COMMAND.test(text);
  const button = ASSIGNED_CALLBACK.test(ctx.callbackQuery?.data ?? "");
  if (!command && !button && (!text || text.startsWith("/"))) return false;
  if (button) await ctx.answerCallbackQuery().catch(() => {});
  const deps = providedDeps ?? defaultDeps();

  const member = await deps.findMember(ctx.from.id);
  if (!member) {
    if (command || button) {
      await ctx.reply("Задачи доступны участникам команды. Войдите через /join.");
      return true;
    }
    return false;
  }

  if (/^\/cancel(?:@[a-z0-9_]+)?$/i.test(text)) {
    const form = await deps.store.getForm(ctx.from.id);
    if (form?.kind !== "assigned.upload") return false;
    await deps.store.clearSession(ctx.from.id);
    await ctx.reply("Загрузка задач отменена.");
    return true;
  }

  if (!command && !button) {
    const form = await deps.store.getForm(ctx.from.id);
    if (form?.kind !== "assigned.upload") return false;
  }

  try {
    const importing = (!command && !button) || /^\/assign(?:@[a-z0-9_]+)?(?=\s|$)/i.test(text);
    await syncTeamTaskMembers(deps, now, importing ? await deps.listTeam() : [member]);
    return await handleAssignedUpdate(ctx, deps.store, now,
      { anyoneAssigns: true, refreshCommands: false });
  } catch (err) {
    console.error("[team-task]", err instanceof Error ? err.message : String(err));
    await ctx.reply("Не удалось открыть задачи. Попробуйте ещё раз чуть позже.");
    return true;
  }
}
