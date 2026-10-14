import type { Context } from "grammy";
import { findMember, listProjectTeam, markProfileEdited, updateProfile, type TeamMember } from "./access";
import { supabaseMembershipStore } from "./projects/members";
import { DEFAULT_SCOPE, scopeOf, type Scope } from "./projects/scope";
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
  /** Админ проекта (по умолчанию — фаундер): меняет всем имя, должность, отделы. */
  isAdmin?: (chatId: number) => boolean;
}

/**
 * Команда проекта: имя и варианты имени — в реестре людей (team_members),
 * должность и отделы — в проекте (project_members).
 */
export const defaultTeamScreenDeps = (scope: Scope = DEFAULT_SCOPE): TeamScreenDeps => {
  const projectId = scope.project.id;
  const memberships = supabaseMembershipStore();
  const projectTeamOf = async () => listProjectTeam(projectId, memberships);
  return {
    findMember: async (id) => (await projectTeamOf()).find((m) => m.chat_id === id) ?? null,
    listTeam: projectTeamOf,
    toggleDepartment: async (id, dept) => {
      const row = (await memberships.ofProject(projectId)).find((m) => m.chat_id === id);
      if (!row) {
        // Фаундер без строки в проекте — заводим её с этим отделом.
        if (!(await findMember(id))) return null;
        await memberships.add({ project_id: projectId, chat_id: id, role: isFounder(id) ? "admin" : "member", departments: [dept] }, new Date());
        return [dept];
      }
      const next = row.departments.includes(dept) ? row.departments.filter((d) => d !== dept) : [...row.departments, dept];
      await memberships.update(projectId, id, { departments: next });
      await markProfileEdited(id);
      return next;
    },
    updateProfile: async (id, patch) => {
      const { title, departments, ...person } = patch;
      if (Object.keys(person).length) await updateProfile(id, person);
      if (title !== undefined || departments !== undefined) {
        const exists = (await memberships.ofProject(projectId)).some((m) => m.chat_id === id);
        const rowPatch = { ...(title !== undefined ? { title } : {}), ...(departments !== undefined ? { departments } : {}) };
        if (exists) await memberships.update(projectId, id, rowPatch);
        else await memberships.add({ project_id: projectId, chat_id: id, role: isFounder(id) ? "admin" : "member", ...rowPatch }, new Date());
        await markProfileEdited(id);
      }
    },
    forms: supabaseTeamForms(),
    isAdmin: scope.isAdmin,
  };
};

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
  await show(ctx, teamScreen(await deps.listTeam(), uid, (deps.isAdmin ?? isFounder)(uid)), edit);
}

const TEAM_CALLBACK_RE = /^dp:(l|m|t|e)(?::(-?\d+))?(?::([a-z_]+))?$/;
const FIELDS: readonly ProfileField[] = ["name", "title", "aliases"];

/** Фаундер — любого и всё; участник — только свои варианты имени. */
const mayEdit = (deps: TeamScreenDeps, uid: number, target: number, field: ProfileField | "departments") =>
  (deps.isAdmin ?? isFounder)(uid) || (uid === target && field === "aliases");

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
    const deps = providedDeps ?? defaultTeamScreenDeps(scopeOf(ctx));
    const form = deps.forms ? await deps.forms.get(uid) : null;
    if (form?.kind !== "tm.edit" || !deps.forms) return false;
    await deps.forms.clear(uid);
    if (teamFormExpired(form, now)) {
      await ctx.reply("Форма устарела. Открой карточку человека в 👥 Команда заново.");
      return true;
    }
    const target = Number(form.params.id);
    const field = form.params.field as ProfileField;
    if (!mayEdit(deps, uid, target, field) || !deps.updateProfile) return true;
    const patch = patchFor(field, text);
    if (typeof patch === "string") {
      await deps.forms.set(uid, openTeamForm("tm.edit", form.params, now), now);
      await ctx.reply(`${patch} Пришли ещё раз или /cancel.`);
      return true;
    }
    await deps.updateProfile(target, patch);
    const fresh = await deps.findMember(target);
    if (fresh) await show(ctx, memberDepartmentsScreen(fresh, (deps.isAdmin ?? isFounder)(uid)), false);
    return true;
  }

  const m = TEAM_CALLBACK_RE.exec(ctx.callbackQuery?.data ?? "");
  if (!m) return false;
  await ctx.answerCallbackQuery().catch(() => {});
  const deps = providedDeps ?? defaultTeamScreenDeps(scopeOf(ctx));
  if (!(await deps.findMember(uid))) return true;
  const [, op, id, arg] = m;
  if (op === "l") {
    await showTeam(ctx, deps, uid, true);
    return true;
  }
  const targetId = Number(id);
  if (op === "t" && !mayEdit(deps, uid, targetId, "departments")) {
    await ctx.reply("Раскладывать людей по отделам могут только фаундеры.");
    return true;
  }
  if (op === "m" && !(deps.isAdmin ?? isFounder)(uid) && uid !== targetId) {
    await ctx.reply("Чужой профиль меняют только фаундеры.");
    return true;
  }
  if (op === "e") {
    const field = arg as ProfileField;
    if (!FIELDS.includes(field) || !deps.forms) return true;
    if (!mayEdit(deps, uid, targetId, field)) {
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
  await show(ctx, memberDepartmentsScreen(target, (deps.isAdmin ?? isFounder)(uid)), true);
  return true;
}
