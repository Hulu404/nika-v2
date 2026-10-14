import { InlineKeyboard, type Context } from "grammy";
import { mskToday } from "../../databot/time";
import { listProjectTeam, type TeamMember } from "../access";
import { escapeHtmlTeam, type TaskScreen } from "../copy";
import { openTeamForm, supabaseTeamForms, teamFormExpired, type TeamFormStore } from "../form";
import { DEFAULT_SCOPE, scopeOf, type Scope } from "../projects/scope";
import { projectLabel } from "../projects/projects";
import { personName } from "../roster";
import { supabaseAboutStore, type AboutStore, type InfoSection, type ProjectQuestion } from "./store";

/**
 * «📌 О проекте» (модуль about): суть проекта и разделы — правила продукта,
 * открытые вопросы, материалы, ключевые цифры. Читают все участники;
 * разделы правят админы (следующее сообщение — новый текст, перед
 * сохранением предпросмотр); на вопрос отвечает админ или ответственный.
 */

export interface AboutDeps {
  about: AboutStore;
  forms: TeamFormStore;
  projectId: string;
  projectLabel: string;
  modules: readonly string[];
  isAdmin: (chatId: number) => boolean;
  listTeam: () => Promise<TeamMember[]>;
}

export function defaultAboutDeps(scope: Scope = DEFAULT_SCOPE): AboutDeps {
  return {
    about: supabaseAboutStore(), forms: supabaseTeamForms(), projectId: scope.project.id, projectLabel: projectLabel(scope.project),
    modules: scope.project.modules, isAdmin: scope.isAdmin, listTeam: () => listProjectTeam(scope.project.id),
  };
}

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
const SECTION_TITLE: Record<Exclude<InfoSection, "questions">, string> = {
  summary: "О проекте", rules: "🧭 Правила продукта", links: "📎 Материалы", facts: "📊 Ключевые цифры",
};
const EDITABLE: readonly InfoSection[] = ["summary", "rules", "links", "facts"];

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

export async function aboutHome(deps: AboutDeps, uid: number): Promise<TaskScreen> {
  const summary = await deps.about.getSection(deps.projectId, "summary");
  const kb = new InlineKeyboard()
    .text("🧭 Правила продукта", "pi:s:rules").text("❓ Открытые вопросы", "pi:q").row()
    .text("📎 Материалы", "pi:s:links").text("📊 Ключевые цифры", "pi:s:facts").row();
  if (deps.isAdmin(uid)) kb.text("✏️ Изменить описание", "pi:e:summary");
  return { text: [`<b>${escapeHtmlTeam(deps.projectLabel)}</b>`, "", summary ?? "Описание проекта пока не заполнено."].join("\n"), keyboard: kb };
}

async function sectionScreen(deps: AboutDeps, uid: number, section: Exclude<InfoSection, "questions">): Promise<TaskScreen> {
  const content = await deps.about.getSection(deps.projectId, section);
  const kb = new InlineKeyboard();
  if (deps.isAdmin(uid)) kb.text("✏️ Изменить", `pi:e:${section}`).row();
  kb.text("← О проекте", "pi:h");
  return { text: [`<b>${SECTION_TITLE[section]}</b>`, "", content ?? "Пока пусто."].join("\n"), keyboard: kb };
}

const owner = (q: ProjectQuestion, names: ReadonlyMap<number, string>) => (q.owner_chat_id ? names.get(q.owner_chat_id) ?? "—" : q.owner_label ?? "без ответственного");
const due = (q: ProjectQuestion, today: string) => q.due_label ?? (q.due_date ? `до ${q.due_date.slice(8, 10)}.${q.due_date.slice(5, 7)}${q.due_date < today ? " ⏰" : ""}` : "без срока");

async function questionsScreen(deps: AboutDeps, now: Date): Promise<TaskScreen> {
  const all = await deps.about.questions(deps.projectId);
  const names = new Map((await deps.listTeam()).map((m) => [m.chat_id, personName(m)] as const));
  const today = mskToday(now);
  const open = all.filter((q) => q.status === "open");
  const answered = all.filter((q) => q.status === "answered");
  const lines = ["<b>❓ Открытые вопросы</b>", ""];
  if (!open.length) lines.push("Открытых вопросов нет.");
  open.forEach((q, i) => lines.push(`${i + 1}. ${escapeHtmlTeam(q.question)} — ${escapeHtmlTeam(owner(q, names))} · ${escapeHtmlTeam(due(q, today))}`));
  if (answered.length) lines.push("", "<b>Отвечено</b>", ...answered.map((q) => `✅ ${escapeHtmlTeam(q.question)}: ${escapeHtmlTeam(q.answer ?? "")}`));
  const kb = new InlineKeyboard();
  open.forEach((q, i) => {
    kb.text(String(i + 1), `pi:qi:${q.id}`);
    if (i % 5 === 4) kb.row();
  });
  kb.row().text("← О проекте", "pi:h");
  return { text: lines.join("\n"), keyboard: kb };
}

async function questionCard(deps: AboutDeps, uid: number, q: ProjectQuestion, now: Date): Promise<TaskScreen> {
  const names = new Map((await deps.listTeam()).map((m) => [m.chat_id, personName(m)] as const));
  const kb = new InlineKeyboard();
  if (q.status === "open" && (deps.isAdmin(uid) || q.owner_chat_id === uid)) kb.text("✅ Отвечено", `pi:qa:${q.id}`).row();
  kb.text("← К вопросам", "pi:q");
  return {
    text: [`<b>${escapeHtmlTeam(q.question)}</b>`, `Решает: ${escapeHtmlTeam(owner(q, names))}`, `Срок: ${escapeHtmlTeam(due(q, mskToday(now)))}`,
      ...(q.answer ? ["", `Ответ: ${escapeHtmlTeam(q.answer)}`] : [])].join("\n"),
    keyboard: kb,
  };
}

/** Текст из сообщения в раздел: экранированный, с переносами строк. */
const asContent = (text: string) => escapeHtmlTeam(text.trim()).slice(0, 3500);

const CALLBACK_RE = /^pi:(h|s|q|qi|qa|e|sv|x)(?::([a-z0-9]+))?$/;
const COMMAND_RE = /^\/(about|link)(?:@\w+)?(?=\s|$)/i;

export async function handleAboutUpdate(ctx: Context, providedDeps?: AboutDeps, now = new Date()): Promise<boolean> {
  if (ctx.chat?.type !== "private" || !ctx.from) return false;
  const uid = ctx.from.id;
  const text = ctx.message?.text?.trim() ?? "";
  const command = COMMAND_RE.exec(text);
  const cb = CALLBACK_RE.exec(ctx.callbackQuery?.data ?? "");
  const isFreeText = !!text && !text.startsWith("/");
  if (!command && !cb && !isFreeText) return false;
  const deps = providedDeps ?? defaultAboutDeps(scopeOf(ctx));

  if (isFreeText && !cb) {
    const form = await deps.forms.get(uid);
    if (form?.kind !== "pi.edit") return false;
    if (teamFormExpired(form, now)) {
      await deps.forms.clear(uid);
      await ctx.reply("Форма устарела. Открой раздел заново.");
      return true;
    }
    if (form.params.mode === "answer") {
      await deps.forms.clear(uid);
      const q = await deps.about.question(Number(form.params.id));
      if (!q || (!deps.isAdmin(uid) && q.owner_chat_id !== uid)) return true;
      await deps.about.answer(q.id, text.slice(0, 1000), uid, now);
      await ctx.reply("Записала ответ.");
      await show(ctx, await questionsScreen(deps, now), false);
      return true;
    }
    // Новый текст раздела — сначала предпросмотр.
    if (!deps.isAdmin(uid)) return true;
    const section = form.params.section as InfoSection;
    await deps.forms.set(uid, openTeamForm("pi.edit", { mode: "confirm", section, text: asContent(text) }, now), now);
    await ctx.reply([`Так будет выглядеть раздел «${SECTION_TITLE[section as Exclude<InfoSection, "questions">] ?? section}»:`, "", asContent(text)].join("\n"),
      { ...HTML, reply_markup: new InlineKeyboard().text("✅ Сохранить", `pi:sv:${section}`).text("✖️ Отмена", "pi:x") });
    return true;
  }

  if (!deps.modules.includes("about")) return false;

  if (command) {
    if (command[1].toLowerCase() === "about") {
      await show(ctx, await aboutHome(deps, uid), false);
      return true;
    }
    if (!deps.isAdmin(uid)) {
      await ctx.reply("Материалы добавляют только админы проекта.");
      return true;
    }
    const m = /^\/link(?:@\w+)?\s+(.+?)\s+(https?:\/\/\S+)\s*$/i.exec(text);
    if (!m) {
      await ctx.reply("Формат: /link Название https://ссылка");
      return true;
    }
    const current = (await deps.about.getSection(deps.projectId, "links")) ?? "";
    const line = `• <a href="${escapeHtmlTeam(m[2])}">${escapeHtmlTeam(m[1])}</a>`;
    await deps.about.setSection(deps.projectId, "links", current ? `${current}\n${line}` : line, uid, now);
    await ctx.reply("Добавила в материалы.");
    await show(ctx, await sectionScreen(deps, uid, "links"), false);
    return true;
  }

  if (!cb) return false;
  await ctx.answerCallbackQuery().catch(() => {});
  const [, op, arg] = cb;
  if (op === "h") {
    await show(ctx, await aboutHome(deps, uid), true);
    return true;
  }
  if (op === "s" && EDITABLE.includes(arg as InfoSection)) {
    await show(ctx, await sectionScreen(deps, uid, arg as Exclude<InfoSection, "questions">), true);
    return true;
  }
  if (op === "q") {
    await show(ctx, await questionsScreen(deps, now), true);
    return true;
  }
  if (op === "qi" || op === "qa") {
    const q = await deps.about.question(Number(arg));
    if (!q || q.project_id !== deps.projectId) return true;
    if (op === "qi") {
      await show(ctx, await questionCard(deps, uid, q, now), true);
      return true;
    }
    if (!deps.isAdmin(uid) && q.owner_chat_id !== uid) {
      await ctx.reply("Отвечает админ проекта или ответственный за вопрос.");
      return true;
    }
    await deps.forms.set(uid, openTeamForm("pi.edit", { mode: "answer", id: String(q.id) }, now), now);
    await ctx.reply("Напиши ответ одним сообщением. Отмена: /cancel.");
    return true;
  }
  if (!deps.isAdmin(uid)) {
    await ctx.reply("Разделы меняют только админы проекта.");
    return true;
  }
  if (op === "e" && EDITABLE.includes(arg as InfoSection)) {
    await deps.forms.set(uid, openTeamForm("pi.edit", { mode: "section", section: arg! }, now), now);
    await ctx.reply(`Пришли новый текст раздела «${SECTION_TITLE[arg as Exclude<InfoSection, "questions">]}» одним сообщением. Перед сохранением покажу. Отмена: /cancel.`);
    return true;
  }
  if (op === "sv") {
    const form = await deps.forms.get(uid);
    await deps.forms.clear(uid);
    if (form?.kind !== "pi.edit" || form.params.mode !== "confirm" || form.params.section !== arg) {
      await ctx.editMessageText("Черновик раздела устарел. Нажми «✏️ Изменить» ещё раз.").catch(() => {});
      return true;
    }
    await deps.about.setSection(deps.projectId, arg as InfoSection, form.params.text ?? "", uid, now);
    await ctx.editMessageText("✅ Раздел обновлён.").catch(() => {});
    await show(ctx, arg === "summary" ? await aboutHome(deps, uid) : await sectionScreen(deps, uid, arg as Exclude<InfoSection, "questions">), false);
    return true;
  }
  if (op === "x") {
    await deps.forms.clear(uid);
    await ctx.editMessageText("Отменила.").catch(() => {});
    return true;
  }
  return true;
}
