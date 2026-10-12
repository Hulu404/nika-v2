import type { Context } from "grammy";
import { findMember, listTeam, toggleDepartment, type TeamMember } from "./access";
import { isFounder } from "./config";
import { memberDepartmentsScreen, teamScreen, type TaskScreen } from "./copy";
import { DEPARTMENTS } from "./departments";

/**
 * «👥 Команда»: кто в команде и в каких отделах. Фаундер нажимает на человека
 * и кнопками включает или выключает отделы (их список — departments.ts);
 * остальные отделы видят, но не меняют.
 */

export interface TeamScreenDeps {
  findMember: (chatId: number) => Promise<TeamMember | null>;
  listTeam: () => Promise<TeamMember[]>;
  toggleDepartment: (chatId: number, department: string) => Promise<string[] | null>;
}

export const defaultTeamScreenDeps = (): TeamScreenDeps => ({ findMember, listTeam, toggleDepartment });

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

async function show(ctx: Context, screen: TaskScreen, edit: boolean): Promise<void> {
  // Без кнопок — без reply_markup: так к сообщению может прицепиться клавиатура меню.
  const hasButtons = screen.keyboard.inline_keyboard.some((row) => row.length > 0);
  const opts = { ...HTML, ...(hasButtons ? { reply_markup: screen.keyboard } : {}) };
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(screen.text, opts);
      return;
    } catch (err) {
      if ((err instanceof Error ? err.message : String(err)).includes("message is not modified")) return;
    }
  }
  await ctx.reply(screen.text, opts);
}

export async function showTeam(ctx: Context, deps: TeamScreenDeps, uid: number, edit: boolean): Promise<void> {
  await show(ctx, teamScreen(await deps.listTeam(), uid, isFounder(uid)), edit);
}

const TEAM_CALLBACK_RE = /^dp:(l|m|t)(?::(-?\d+))?(?::([a-z_]+))?$/;

export async function handleTeamScreenUpdate(ctx: Context, providedDeps?: TeamScreenDeps): Promise<boolean> {
  const m = TEAM_CALLBACK_RE.exec(ctx.callbackQuery?.data ?? "");
  if (!m || !ctx.from) return false;
  await ctx.answerCallbackQuery().catch(() => {});
  const deps = providedDeps ?? defaultTeamScreenDeps();
  const uid = ctx.from.id;
  if (!(await deps.findMember(uid))) return true;
  const [, op, id, dept] = m;
  if (op === "l") {
    await showTeam(ctx, deps, uid, true);
    return true;
  }
  if (!isFounder(uid)) {
    await ctx.reply("Раскладывать людей по отделам могут только фаундеры.");
    return true;
  }
  if (op === "t") {
    if (!DEPARTMENTS.some((d) => d.key === dept)) return true;
    await deps.toggleDepartment(Number(id), dept!);
  }
  const target = await deps.findMember(Number(id));
  if (!target) {
    await ctx.reply("Этого человека уже нет в команде.");
    return true;
  }
  await show(ctx, memberDepartmentsScreen(target), true);
  return true;
}
