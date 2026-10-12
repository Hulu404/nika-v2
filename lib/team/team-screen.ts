import type { Context } from "grammy";
import { findMember, listTeam, toggleDepartment, updateProfile, type TeamMember } from "./access";
import { isFounder } from "./config";
import { PROFILE_PROMPT, memberDepartmentsScreen, teamScreen, type ProfileField, type TaskScreen } from "./copy";
import { DEPARTMENTS } from "./departments";
import { openTeamForm, supabaseTeamForms, teamFormExpired, type TeamFormStore } from "./form";
import type { ProfilePatch } from "./roster";

/**
 * «👥 Команда»: кто в команде, должности и отделы. Фаундер нажимает на
 * человека и меняет имя, должность, отделы (их список — departments.ts) и
 * варианты имени; участник — только свои варианты имени. Любая правка ставит
 * profile_edited_at, и roster.ts этот профиль больше не трогает.
 */

export interface TeamScreenDeps {
  findMember: (chatId: number) => Promise<TeamMember | null>;
  listTeam: () => Promise<TeamMember[]>;
  toggleDepartment: (chatId: number, department: string) => Promise<string[] | null>;
  updateProfile?: (chatId: number, patch: ProfilePatch) => Promise<void>;
  forms?: TeamFormStore;
}

export const defaultTeamScreenDeps = (): TeamScreenDeps => ({
  findMember, listTeam, toggleDepartment, updateProfile: (id, patch) => updateProfile(id, patch), forms: supabaseTeamForms(),
});

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

const TEAM_CALLBACK_RE = /^dp:(l|m|t|e)(?::(-?\d+))?(?::([a-z_]+))?$/;
const FIELDS: readonly ProfileField[] = ["name", "title", "aliases"];

/** Фаундер — любого и всё; участник — только свои варианты имени. */
const mayEdit = (uid: number, target: number, field: ProfileField | "departments") =>
  isFounder(uid) || (uid === target && field === "aliases");

function patchFor(field: ProfileField, text: string): ProfilePatch | string {
  const clear = text === "-" || text === "—";
  if (field === "name") return clear || text.length > 40 ? "Имя — от 1 до 40 символов." : { first_name: text };
  if (field === "title") return text.length > 80 ? "Должность — до 80 символов." : { title: clear ? null : text };
  const list = clear ? [] : [...new Set(text.split(",").map((a) => a.trim()).filter(Boolean))];
  if (list.length > 10 || list.some((a) => a.length > 40)) return "До 10 вариантов, каждый до 40 символов.";
  return { name_aliases: list };
}

export async function handleTeamScreenUpdate(ctx: Context, providedDeps?: TeamScreenDeps, now = new Date()): Promise<boolean> {
  if (!ctx.from) return false;
  const uid = ctx.from.id;
  const text = ctx.message?.text?.trim() ?? "";

  // Новое значение поля профиля — следующим сообщением.
  if (text && !text.startsWith("/") && !ctx.callbackQuery) {
    const deps = providedDeps ?? defaultTeamScreenDeps();
    const form = deps.forms ? await deps.forms.get(uid) : null;
    if (form?.kind !== "tm.edit" || !deps.forms) return false;
    await deps.forms.clear(uid);
    if (teamFormExpired(form, now)) {
      await ctx.reply("Форма устарела. Открой карточку человека в 👥 Команда заново.");
      return true;
    }
    const target = Number(form.params.id);
    const field = form.params.field as ProfileField;
    if (!mayEdit(uid, target, field) || !deps.updateProfile) return true;
    const patch = patchFor(field, text);
    if (typeof patch === "string") {
      await deps.forms.set(uid, openTeamForm("tm.edit", form.params, now), now);
      await ctx.reply(`${patch} Пришли ещё раз или /cancel.`);
      return true;
    }
    await deps.updateProfile(target, patch);
    const fresh = await deps.findMember(target);
    if (fresh) await show(ctx, memberDepartmentsScreen(fresh, isFounder(uid)), false);
    return true;
  }

  const m = TEAM_CALLBACK_RE.exec(ctx.callbackQuery?.data ?? "");
  if (!m) return false;
  await ctx.answerCallbackQuery().catch(() => {});
  const deps = providedDeps ?? defaultTeamScreenDeps();
  if (!(await deps.findMember(uid))) return true;
  const [, op, id, arg] = m;
  if (op === "l") {
    await showTeam(ctx, deps, uid, true);
    return true;
  }
  const targetId = Number(id);
  if (op === "t" && !mayEdit(uid, targetId, "departments")) {
    await ctx.reply("Раскладывать людей по отделам могут только фаундеры.");
    return true;
  }
  if (op === "m" && !isFounder(uid) && uid !== targetId) {
    await ctx.reply("Чужой профиль меняют только фаундеры.");
    return true;
  }
  if (op === "e") {
    const field = arg as ProfileField;
    if (!FIELDS.includes(field) || !deps.forms) return true;
    if (!mayEdit(uid, targetId, field)) {
      await ctx.reply("Имя и должность меняют фаундеры; свои варианты имени — сам участник.");
      return true;
    }
    await deps.forms.set(uid, openTeamForm("tm.edit", { id: String(targetId), field }, now), now);
    await ctx.reply(PROFILE_PROMPT[field]);
    return true;
  }
  if (op === "t") {
    if (!DEPARTMENTS.some((d) => d.key === arg)) return true;
    await deps.toggleDepartment(targetId, arg!);
  }
  const target = await deps.findMember(targetId);
  if (!target) {
    await ctx.reply("Этого человека уже нет в команде.");
    return true;
  }
  await show(ctx, memberDepartmentsScreen(target, isFounder(uid)), true);
  return true;
}
