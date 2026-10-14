import type { Context } from "grammy";
import { DueError, parseDue } from "../../databot/assigned-due";
import { createSupabaseStore } from "../../databot/data/supabase-store";
import type { DatabotStore } from "../../databot/data/store";
import { mskToday } from "../../databot/time";
import { listProjectTeam, type TeamMember } from "../access";
import { escapeHtmlTeam, type TaskScreen } from "../copy";
import { openTeamForm, supabaseTeamForms, teamFormExpired, type TeamFormStore } from "../form";
import { personLabel, personName, resolveMention } from "../roster";
import { DEFAULT_SCOPE, scopeForRecord, scopeOf, type Scope } from "../projects/scope";
import { projectLabel } from "../projects/projects";
import { ROADMAP_GROUPS } from "../projects/rescan-seed";
import { groupScreen, itemCard, milestoneScreen, overdueScreen, ownerPicker, roadmapHome } from "./copy";
import { supabaseRoadmapStore, type RoadmapItem, type RoadmapStatus, type RoadmapStore } from "./store";

/**
 * «🗺 План развития» (модуль roadmap). Смотреть могут все участники проекта;
 * менять статус, ответственного и срок — админы и ответственный пункта;
 * создавать и удалять пункты — только админы (/roadmap_add или ассистент).
 */

export interface RoadmapDeps {
  roadmap: RoadmapStore;
  tasks: DatabotStore;
  forms: TeamFormStore;
  projectId: string;
  projectLabel: string;
  modules: readonly string[];
  isAdmin: (chatId: number) => boolean;
  listTeam: () => Promise<TeamMember[]>;
  /** «📋 Сделать задачей»: черновик задачи с обычным предпросмотром, привязанный к пункту. */
  makeTask?: (ctx: Context, item: RoadmapItem) => Promise<void>;
  /** Кнопка пункта другого проекта (старое сообщение): зависимости того проекта. */
  rescope?: (projectId: string) => Promise<RoadmapDeps | null>;
}

export function defaultRoadmapDeps(scope: Scope = DEFAULT_SCOPE, ctx?: Context, makeTask?: RoadmapDeps["makeTask"]): RoadmapDeps {
  return {
    roadmap: supabaseRoadmapStore(), tasks: createSupabaseStore(), forms: supabaseTeamForms(),
    projectId: scope.project.id, projectLabel: projectLabel(scope.project), modules: scope.project.modules,
    isAdmin: scope.isAdmin, listTeam: () => listProjectTeam(scope.project.id), makeTask,
    ...(ctx ? { rescope: async (projectId: string) => {
      const s = await scopeForRecord(ctx, projectId);
      return s ? defaultRoadmapDeps(s, ctx, makeTask) : null;
    } } : {}),
  };
}

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

async function show(ctx: Context, screen: TaskScreen, edit: boolean): Promise<void> {
  const opts = { ...HTML, reply_markup: screen.keyboard };
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

async function namesOf(deps: RoadmapDeps): Promise<Map<number, string>> {
  return new Map((await deps.listTeam()).map((m) => [m.chat_id, personName(m)] as const));
}

export async function showRoadmap(ctx: Context, deps: RoadmapDeps, edit: boolean, now: Date): Promise<void> {
  await show(ctx, roadmapHome(deps.projectLabel, await deps.roadmap.list(deps.projectId), mskToday(now)), edit);
}

const canEdit = (deps: RoadmapDeps, uid: number, item: RoadmapItem) => deps.isAdmin(uid) || item.owner_chat_id === uid;

async function showItem(ctx: Context, deps: RoadmapDeps, uid: number, item: RoadmapItem, now: Date, edit = true): Promise<void> {
  const related = (await deps.tasks.listAssignedOverview(new Date(0))).filter((t) => t.roadmap_item_id === item.id);
  const visible = deps.isAdmin(uid) ? related : related.filter((t) => t.assignee_id === uid || t.assigned_by === uid);
  await show(ctx, itemCard(item, await namesOf(deps), visible, related.length - visible.length, canEdit(deps, uid, item), deps.isAdmin(uid), mskToday(now)), edit);
}

const STATUS_BY_KEY: Record<string, RoadmapStatus> = { w: "in_progress", d: "done", b: "blocked", p: "planned" };
const CALLBACK_RE = /^rm:(h|m|g|o|i|s|ow|due|tk|del|DEL|yes|no)(?::(-?\d+))?(?::([a-z0-9-]+))?$/;
const COMMAND_RE = /^\/(roadmap|roadmap_add)(?:@\w+)?(?=\s|$)/i;

/** /roadmap_add КОД Название / срок / @ответственный / группа — части после названия необязательны. */
export function parseRoadmapAdd(text: string, team: readonly TeamMember[], uid: number, now: Date):
  { code: string | null; title: string; due: string | null; owner: number | null; group: string | null } | string {
  const body = text.replace(COMMAND_RE, "").trim();
  if (!body) return "Формат: /roadmap_add B13 Название / 25.10 / @ответственный / Бэкенд — после названия всё необязательно.";
  const [head, ...rest] = body.split(/\s+\/\s+/);
  const m = /^([A-Za-zА-Яа-яЁё]{1,4}\d+(?:\.\d+)?)\s+(.+)$/.exec(head.trim());
  const code = m ? m[1].toUpperCase() : null;
  const title = (m ? m[2] : head).trim();
  if (!title) return "Нужно название пункта.";
  let due: string | null = null;
  let owner: number | null = null;
  let group: string | null = null;
  for (const part of rest.map((p) => p.trim()).filter(Boolean)) {
    const g = ROADMAP_GROUPS.find((x) => x.toLowerCase().startsWith(part.toLowerCase().slice(0, 4)));
    if (part.startsWith("@") || (!g && !/\d/.test(part))) {
      const r = resolveMention(team, { name: part, qualifier: null }, uid);
      if (r.kind !== "one") return `Не нашла в проекте «${part}».`;
      owner = r.member.chat_id;
    } else if (g && !/\d/.test(part)) group = g;
    else {
      try {
        due = mskToday(parseDue(part, now));
      } catch (err) {
        return err instanceof DueError ? err.message : "Не поняла срок.";
      }
    }
  }
  return { code, title, due, owner, group };
}

export async function handleRoadmapUpdate(ctx: Context, providedDeps?: RoadmapDeps, now = new Date(), makeTask?: RoadmapDeps["makeTask"]): Promise<boolean> {
  if (ctx.chat?.type !== "private" || !ctx.from) return false;
  const uid = ctx.from.id;
  const text = ctx.message?.text?.trim() ?? "";
  const command = COMMAND_RE.exec(text);
  const cb = CALLBACK_RE.exec(ctx.callbackQuery?.data ?? "");
  const isFreeText = !!text && !text.startsWith("/");
  if (!command && !cb && !isFreeText) return false;
  let deps = providedDeps ?? defaultRoadmapDeps(scopeOf(ctx), ctx, makeTask);

  // Новый срок пункта — следующим сообщением.
  if (isFreeText && !cb) {
    const form = await deps.forms.get(uid);
    if (form?.kind !== "rm.due") return false;
    await deps.forms.clear(uid);
    if (teamFormExpired(form, now)) {
      await ctx.reply("Форма устарела. Открой пункт плана заново.");
      return true;
    }
    const item = await deps.roadmap.get(Number(form.params.id));
    if (!item || !canEdit(deps, uid, item)) return true;
    let due: string | null = null;
    if (!/^(нет|без срока|-)$/i.test(text)) {
      try {
        due = mskToday(parseDue(text.replace(/^до\s+/i, ""), now));
      } catch (err) {
        await deps.forms.set(uid, openTeamForm("rm.due", form.params, now), now);
        await ctx.reply(`${err instanceof DueError ? err.message : "Не поняла срок."} Пришли ещё раз или /cancel.`);
        return true;
      }
    }
    const updated = await deps.roadmap.update(item.id, { due_date: due }, uid, now);
    if (updated) await showItem(ctx, deps, uid, updated, now, false);
    return true;
  }

  if (!deps.modules.includes("roadmap")) return false;

  if (command) {
    if (command[1].toLowerCase() === "roadmap") {
      await showRoadmap(ctx, deps, false, now);
      return true;
    }
    if (!deps.isAdmin(uid)) {
      await ctx.reply("Пункты плана добавляют только админы проекта.");
      return true;
    }
    const parsed = parseRoadmapAdd(text, await deps.listTeam(), uid, now);
    if (typeof parsed === "string") {
      await ctx.reply(parsed);
      return true;
    }
    const existing = await deps.roadmap.list(deps.projectId);
    if (parsed.code && existing.some((i) => i.code === parsed.code)) {
      await ctx.reply(`Пункт ${parsed.code} уже есть в плане.`);
      return true;
    }
    const item = await deps.roadmap.create({
      project_id: deps.projectId, kind: "item", code: parsed.code, title: parsed.title, details: null, group: parsed.group,
      start_date: null, due_date: parsed.due, status: "planned", owner_chat_id: parsed.owner,
      sort: Math.max(0, ...existing.map((i) => i.sort)) + 10,
    }, uid, now);
    await ctx.reply("Добавила в план:");
    await showItem(ctx, deps, uid, item, now, false);
    return true;
  }

  if (!cb) return false;
  await ctx.answerCallbackQuery().catch(() => {});
  const [, op, idRaw, arg] = cb;
  const today = mskToday(now);
  if (op === "h") {
    await showRoadmap(ctx, deps, true, now);
    return true;
  }
  if (op === "g") {
    const group = ROADMAP_GROUPS[Number(idRaw)];
    if (group) await show(ctx, groupScreen(group, await deps.roadmap.list(deps.projectId), await namesOf(deps), today), true);
    return true;
  }
  if (op === "o") {
    await show(ctx, overdueScreen(await deps.roadmap.list(deps.projectId), await namesOf(deps), today), true);
    return true;
  }

  let item = await deps.roadmap.get(Number(idRaw));
  if (!item) {
    await ctx.reply("Этого пункта уже нет в плане.");
    return true;
  }
  // Пункт другого проекта из старого сообщения — в его проекте и с правами в нём.
  if (item.project_id !== deps.projectId) {
    const other = deps.rescope ? await deps.rescope(item.project_id) : null;
    if (!other) {
      await ctx.reply("Этот пункт в проекте, где тебя нет.");
      return true;
    }
    deps = other;
  }

  if (op === "m") {
    await show(ctx, milestoneScreen(item, await deps.roadmap.list(deps.projectId), await namesOf(deps), today), true);
    return true;
  }
  if (op === "i") {
    await showItem(ctx, deps, uid, item, now);
    return true;
  }
  if (op === "tk") {
    if (deps.makeTask) await deps.makeTask(ctx, item);
    return true;
  }
  if (op === "del" || op === "DEL") {
    if (!deps.isAdmin(uid)) {
      await ctx.reply("Удалять пункты могут только админы проекта.");
      return true;
    }
    if (op === "del") {
      await show(ctx, { text: `Удалить ${escapeHtmlTeam(item.code ?? item.title)} из плана? Связанные задачи останутся.`,
        keyboard: { inline_keyboard: [[{ text: "Удалить", callback_data: `rm:DEL:${item.id}` }, { text: "Отмена", callback_data: `rm:i:${item.id}` }]] } as never }, true);
      return true;
    }
    await deps.roadmap.remove(item.id);
    await showRoadmap(ctx, deps, true, now);
    return true;
  }
  if (!canEdit(deps, uid, item)) {
    await ctx.reply("Менять пункт могут админы проекта и его ответственный.");
    return true;
  }
  if (op === "yes" || op === "no") {
    if (op === "yes") item = (await deps.roadmap.update(item.id, { status: "done" }, uid, now)) ?? item;
    await ctx.editMessageText(op === "yes" ? `✅ ${escapeHtmlTeam(item.code ?? item.title)} — готово.` : "Хорошо, пункт остаётся в работе.", HTML).catch(() => {});
    return true;
  }
  if (op === "s") {
    const status = STATUS_BY_KEY[arg ?? ""];
    if (status) item = (await deps.roadmap.update(item.id, { status }, uid, now)) ?? item;
    await showItem(ctx, deps, uid, item, now);
    return true;
  }
  if (op === "ow") {
    const team = await deps.listTeam();
    if (arg !== undefined && arg !== "" && /^-?\d+$/.test(arg)) {
      item = (await deps.roadmap.update(item.id, { owner_chat_id: Number(arg) }, uid, now)) ?? item;
      await showItem(ctx, deps, uid, item, now);
      return true;
    }
    await show(ctx, ownerPicker(item, team.map((m) => ({ chat_id: m.chat_id, label: personLabel(m) }))), true);
    return true;
  }
  if (op === "due") {
    await deps.forms.set(uid, openTeamForm("rm.due", { id: String(item.id) }, now), now);
    await ctx.reply(`Новый срок для ${item.code ?? item.title}: «25.10», «пт», «завтра»; «нет» — убрать. Отмена: /cancel.`);
    return true;
  }
  return true;
}
