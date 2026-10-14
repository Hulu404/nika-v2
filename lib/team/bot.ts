import { Bot, InlineKeyboard, type Api, type Context } from "grammy";
import { isFounder, teamToken } from "./config";
import {
  applyRoster,
  ensurePerson,
  findMember,
  joinTeam,
  setCurrentProject,
  listTeam,
  removeMember,
  setDigestOptIn,
  type TeamMember,
} from "./access";
import { mergeRuns, pickRun, type TeamRun } from "./runs";
import { fetchArchive, runKeysFrom, type ArchiveRow } from "./history";
import { NOT_A_MEMBER_TEXT, helpText, menuCommand, menuKeyboard, menuSection } from "./copy";
import { faqAnswerText, faqIndexText, findFaq } from "./faq";
import { handleTeamTaskUpdate } from "./tasks";
import { handleScheduleUpdate, showSchedule, defaultScheduleDeps, type ScheduleDeps } from "./schedule";
import { defaultEventsDeps, handleEventsUpdate, openClubEventScreen, openCoffeeRunScreen } from "./ivents";
import { supabaseTeamForms } from "./form";
import { touchSeen } from "./seen";
import { handleSocialSectionUpdate } from "./founders/section";
import { defaultTeamScreenDeps, handleTeamScreenUpdate, showTeam } from "./team-screen";
import { defaultCoffeeWeekDeps, handleCoffeeWeekUpdate } from "./coffee-run-week";
import { closeAiDraft, defaultAssistantDeps, handleAiMessage, handleAiUpdate, startTaskDraft, type AssistantDeps } from "./ai/assistant";
import { validateIntent } from "./ai/intent";
import { handleRoadmapUpdate } from "./roadmap/screen";
import type { RoadmapItem } from "./roadmap/store";
import { personName } from "./roster";
import { supabaseDraftStore, supabaseParticipantStore } from "./ai/stores";
import { teamAiConfig } from "./ai/yandex";
import { aiCheckText, defaultCheckDeps } from "./ai/check";
import { buildMyDay } from "./my-day";
import { buildCoffeeBlock } from "./digest-build";
import { fetchRunSignups } from "./stats";
import { mskToday } from "../databot/time";
import { scopedEvents, supabaseEventStore } from "./events";
import { DEFAULT_SCOPE, isMulti, resolveScope, scopeFor, scopeOf, setScope, type Scope } from "./projects/scope";
import { hasModule, projectLabel, supabaseProjectStore, type ModuleKey, type ProjectStore } from "./projects/projects";
import { supabaseMembershipStore, type MembershipStore } from "./projects/members";
import { supabaseInviteStore, type InviteStore } from "./projects/invites";

const scopeDeps = () => ({ projects: supabaseProjectStore(), memberships: supabaseMembershipStore() });
import { createSupabaseStore } from "../databot/data/supabase-store";

/**
 * Внутренний бот команды: сколько человек записалось, кто подтвердился, кому
 * ушло напоминание, как забег набирается по сравнению с прошлыми.
 *
 * Почему отдельный бот, а не раздел в боте мероприятий:
 *   • токен основного бота — это право писать всем участникам; давать его
 *     каждому, кому нужна сводка, не стоит;
 *   • участник не должен натыкаться на служебные команды в своём боте;
 *   • меню команд в BotFather у них разное, и это первое, что человек видит.
 *
 * Чего этот бот НЕ делает — и не будет: он ничего не пишет участникам. Не из
 * осторожности, а физически: люди нажимали Start у основного бота, и написать
 * им может только он. Поэтому перенос, отмена, перекличка и приглашения
 * остались там, а здесь — только чтение.
 *
 * Доступ — таблица team_members (lib/team/access.ts), а не память процесса:
 * список админов основного бота обнуляется на каждом деплое, и повторять эту
 * ошибку в инструменте, который открывают утром в день забега, незачем.
 */
export type TeamContext = Context;

/**
 * Пускать ли дальше. Чужому отвечаем один раз и по делу: молчание тут читалось
 * бы как «бот сломан», а сказать «ты не в команде» ничего не раскрывает —
 * ключ мы, разумеется, не называем.
 */
async function requireMember(ctx: TeamContext): Promise<TeamMember | null> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return null;
  const member = await findMember(chatId);
  if (!member) {
    await ctx.reply(NOT_A_MEMBER_TEXT);
    return null;
  }
  return member;
}

/**
 * Что бот знает о забегах прямо сейчас: все заявки за всю историю и список
 * забегов, собранный из базы и расписания.
 *
 * Читаем всё целиком на каждый запрос, без кеша. Строк тут сотни (десятки в
 * неделю), это один короткий запрос, а кеш ценой в «команда не видит заявку,
 * которая пришла минуту назад» — плохая сделка для инструмента, в который
 * смотрят за полчаса до старта. Понадобится — заведём, когда строк станет
 * десятки тысяч.
 */
interface Snapshot {
  archive: ArchiveRow[];
  runs: TeamRun[];
}

async function snapshot(now: Date = new Date()): Promise<Snapshot> {
  const archive = await fetchArchive();
  return { archive, runs: mergeRuns(runKeysFrom(archive), now) };
}

/**
 * Единая обёртка над чтением данных. Ошибку базы показываем словами: «ноль
 * записавшихся» и «база не ответила» — разные новости, и вторую нельзя подать
 * как первую, особенно в 9:20 на старте.
 */
async function withData(ctx: TeamContext, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[team-bot] data:", detail);
    await ctx.reply(`Не получилось достать данные: ${detail}`);
  }
}

/** Расписание со ссылками на экраны ивентов: кофе-ран и ивент клуба открываются в «Ивентах». */
function scheduleDeps(scope: Scope = DEFAULT_SCOPE): ScheduleDeps {
  const events = defaultEventsDeps();
  return {
    ...defaultScheduleDeps(scope),
    openClubEvent: (ctx, ev) => openClubEventScreen(ctx, events, ev, ctx.from!.id, true, new Date()),
    openCoffeeRun: (ctx, spot, date) => openCoffeeRunScreen(ctx, events, spot, date, true, new Date()),
  };
}

/** Голос и свободный текст: экраны — те же, что у кнопок. */
function assistantDeps(scope: Scope = DEFAULT_SCOPE): AssistantDeps {
  return defaultAssistantDeps({
    showSchedule: (ctx, range) => showSchedule(ctx, scheduleDeps(scope), range === "next_week" ? 1 : 0, false, new Date()),
    // То же, что утренняя сводка (в проекте запроса); фаундерам nika — с блоками про кофе-ран.
    myDay: async (member, now) => buildMyDay(
      { events: scopedEvents(supabaseEventStore(), scope.project.id), participants: supabaseParticipantStore(), tasks: createSupabaseStore(), projectId: scope.project.id },
      member, now, {
        footer: !!teamAiConfig(),
        extra: isFounder(member.chat_id) && hasModule(scope.project, "coffee_run")
          ? await buildCoffeeBlock({ events: supabaseEventStore(), fetchSignups: fetchRunSignups }, mskToday(now), now).catch(() => [])
          : [],
      },
    ),
  }, scope);
}

/** «📋 Сделать задачей» в плане развития: обычный предпросмотр, исполнитель — ответственный пункта. */
async function makeRoadmapTask(ctx: TeamContext, item: RoadmapItem): Promise<void> {
  if (!ctx.from) return;
  const deps = assistantDeps(scopeOf(ctx));
  const owner = (await deps.listTeam()).find((m) => m.chat_id === item.owner_chat_id);
  const parsed = validateIntent({
    intent: "create_task", what: `${item.code ? `${item.code} · ` : ""}${item.title}`, due: item.due_date ?? "",
    assignees: owner ? [{ name: personName(owner), qualifier: null }] : [],
  });
  await startTaskDraft(ctx, deps, ctx.from.id, parsed, { roadmapItemId: item.id, picks: owner ? { a0: owner.chat_id } : {} });
}

/** Команды разделов, которые есть не у всех проектов. */
const MODULE_COMMANDS: Record<string, ModuleKey> = { events: "events", social: "social", coffee_weekly: "coffee_run", roadmap: "roadmap", about: "about", roadmap_add: "roadmap", link: "about" };

/** Клавиатура под проект этого обновления: разделы по модулям, переключатель — если проектов несколько. */
export function keyboardFor(ctx: TeamContext) {
  const scope = scopeOf(ctx);
  return menuKeyboard(scope.project, isMulti(scope));
}

/** Закрыть открытую форму; черновик с открытым «Изменить» закрывается вместе с ней. */
async function closeForm(ctx: TeamContext, uid: number): Promise<void> {
  const forms = supabaseTeamForms();
  const form = await forms.get(uid).catch(() => null);
  if (!form) return;
  await forms.clear(uid).catch(() => {});
  await closeAiDraft(ctx.api, supabaseDraftStore(), uid, form);
}

export interface InviteDeps {
  invites: InviteStore;
  memberships: MembershipStore;
  projects: ProjectStore;
  ensurePerson: (chatId: number, profile: { username?: string | null; displayName?: string | null }) => Promise<TeamMember | null>;
  setCurrentProject: (chatId: number, projectId: string) => Promise<void>;
}

let inviteDepsOverride: InviteDeps | null = null;
/** Для тестов. */
export function setInviteDeps(deps: InviteDeps | null): void {
  inviteDepsOverride = deps;
}

const inviteDeps = (): InviteDeps => inviteDepsOverride ?? {
  invites: supabaseInviteStore(), memberships: supabaseMembershipStore(), projects: supabaseProjectStore(),
  ensurePerson, setCurrentProject,
};

/**
 * Переход по ссылке-приглашению: человек становится участником проекта,
 * проект — текущим; приветствие и клавиатура. Использованная или
 * просроченная ссылка не работает.
 */
async function acceptInvite(ctx: TeamContext, token: string): Promise<void> {
  if (!ctx.from) return;
  const deps = inviteDeps();
  const uid = ctx.from.id;
  const now = new Date();
  const invite = await deps.invites.redeem(token, uid, now).catch(() => null);
  if (!invite) {
    await ctx.reply("Ссылка недействительна: она уже использована или устарела. Попроси новую у админа проекта.");
    return;
  }
  const person = await deps.ensurePerson(uid, { username: ctx.from.username ?? null, displayName: ctx.from.first_name ?? null });
  if (!person) {
    await ctx.reply("Не получилось записать тебя. Попробуй ссылку ещё раз чуть позже.");
    return;
  }
  await deps.memberships.add({ project_id: invite.project_id, chat_id: uid, role: invite.role, title: invite.title,
    departments: invite.departments, added_by: invite.created_by }, now);
  await deps.setCurrentProject(uid, invite.project_id);
  const scope = await resolveScope({ projects: deps.projects, memberships: deps.memberships }, uid, invite.project_id);
  if (scope) setScope(ctx, scope);
  menuShown.add(uid);
  await ctx.reply(`Добро пожаловать в ${scope ? projectLabel(scope.project) : "проект"}!\n\n${helpText(isFounder(uid), !!teamAiConfig())}`,
    { reply_markup: keyboardFor(ctx) });
}

/** Кому клавиатура меню уже ушла в этом процессе: остальным прикрепим её к первому ответу. */
const menuShown = new Set<number>();

/** Для тестов. */
export function resetMenuShown(): void {
  menuShown.clear();
}

export function registerHandlers(bot: Bot<TeamContext>): void {
  // Область проекта на это обновление: текущий проект человека, его проекты, админы.
  bot.use(async (ctx, next) => {
    const id = ctx.chat?.type === "private" ? ctx.from?.id : undefined;
    if (id !== undefined) {
      const member = await findMember(id).catch(() => null);
      const scope = member ? await resolveScope(scopeDeps(), id, member.current_project).catch(() => null) : null;
      if (scope) setScope(ctx, scope);
    }
    await next();
  });
  // Кнопка меню — это команда. Подменяем текст на команду раздела до всех
  // обработчиков: открытая форма (явка, Instagram, список задач) закрывается
  // так же, как от любой команды, и текст кнопки никогда не станет ответом.
  bot.use(async (ctx, next) => {
    const section = menuSection(ctx.message?.text);
    if (section && ctx.message && ctx.from) {
      const command = menuCommand(section);
      await closeForm(ctx, ctx.from.id);
      ctx.message.text = command;
      ctx.message.entities = [{ type: "bot_command", offset: 0, length: command.length }];
    }
    await next();
  });
  // Клавиатура меню — с первым ответом человеку из команды, у которого её ещё не было.
  bot.use(async (ctx, next) => {
    const id = ctx.chat?.type === "private" ? ctx.chat.id : undefined;
    if (id !== undefined && !menuShown.has(id) && (await findMember(id).catch(() => null))) {
      ctx.api.config.use(async (prev, method, payload, signal) => {
        const p = payload as { chat_id?: number; reply_markup?: unknown };
        if (method === "sendMessage" && p.chat_id === id && !p.reply_markup && !menuShown.has(id)) {
          menuShown.add(id);
          return prev(method, { ...payload, reply_markup: keyboardFor(ctx) } as typeof payload, signal);
        }
        return prev(method, payload, signal);
      });
    }
    await next();
  });
  // «Был в боте» — на любое действие: команды, текст, кнопки, ответы в формах.
  // Обработчики задач, расписания и ивентов отвечают раньше команд, поэтому
  // метка ставится здесь, до них. В базу не чаще раза в 5 минут (seen.ts).
  bot.use(async (ctx, next) => {
    if (ctx.from) void touchSeen(ctx.from.id);
    await next();
  });
  // Любая команда закрывает открытую форму (кроме /cancel: её разбирает обработчик форм).
  bot.use(async (ctx, next) => {
    const text = ctx.message?.text?.trim() ?? "";
    if (ctx.from && text.startsWith("/") && !/^\/cancel(?:@\w+)?$/i.test(text) && !/^\/(assign|event)\b/i.test(text)) {
      await closeForm(ctx, ctx.from.id);
    }
    await next();
  });
  // Раздел, которого нет в проекте (ивенты, соцсети, кофе-ран), — не открываем.
  bot.use(async (ctx, next) => {
    const command = /^\/([a-z_]+)/.exec(ctx.message?.text ?? "")?.[1];
    const module = command ? MODULE_COMMANDS[command] : undefined;
    if (module && !hasModule(scopeOf(ctx).project, module)) {
      await ctx.reply("В этом проекте такого раздела нет.");
      return;
    }
    await next();
  });
  bot.use(async (ctx, next) => {
    if (await handleTeamTaskUpdate(ctx)) return;
    if (await handleScheduleUpdate(ctx, scheduleDeps(scopeOf(ctx)))) return;
    if (await handleEventsUpdate(ctx)) return;
    if (await handleSocialSectionUpdate(ctx)) return;
    if (await handleTeamScreenUpdate(ctx)) return;
    if (await handleRoadmapUpdate(ctx, undefined, new Date(), makeRoadmapTask)) return;
    if (await handleCoffeeWeekUpdate(ctx, defaultCoffeeWeekDeps())) return;
    // Кнопки черновика и «✏️ Изменить» — после всех форм: уточнение ждём, только если открыто именно оно.
    if (await handleAiUpdate(ctx, () => assistantDeps(scopeOf(ctx)))) return;
    await next();
  });

  // ── Вход ───────────────────────────────────────────────────────────────────
  bot.command("join", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const entered = (ctx.match ?? "").toString().trim();

    if (!entered && !(await findMember(chatId))) {
      await ctx.reply("Пришли ключ одной строкой через пробел: /join твой-ключ");
      return;
    }

    const res = await joinTeam(chatId, entered, {
      username: ctx.from?.username ?? null,
      displayName: ctx.from?.first_name ?? null,
    });

    switch (res.status) {
      case "joined":
        await applyRoster(res.member);
        await setTeamCommands(bot.api, res.member);
        menuShown.add(chatId);
        await ctx.reply(
          [
            "Готово, ты в команде.",
            "",
            "Сообщение с ключом лучше удали из переписки.",
            "",
            helpText(isFounder(res.member.chat_id), !!teamAiConfig()),
          ].join("\n"),
          { reply_markup: keyboardFor(ctx) },
        );
        break;
      case "already":
        await applyRoster(res.member);
        await setTeamCommands(bot.api, res.member);
        menuShown.add(chatId);
        await ctx.reply(`Ты и так в команде.\n\n${helpText(isFounder(res.member.chat_id), !!teamAiConfig())}`, { reply_markup: keyboardFor(ctx) });
        break;
      case "wrong_secret":
        // Не подсказываем, что именно не так: перебирающему знать нечего.
        await ctx.reply("Не узнала ключ.");
        break;
      case "no_secret":
        await ctx.reply(
          "Ключ команды не настроен на сервере (переменная TEAM_BOT_SECRET) — " +
            "пока она пустая, я никого не пущу.",
        );
        break;
      case "failed":
        await ctx.reply("Не смогла записать тебя в команду. Загляни в логи сервера.");
        break;
    }
  });

  bot.command(["start", "help"], async (ctx) => {
    // Приглашение в проект: /start join_<token>.
    const payload = (ctx.match ?? "").toString().trim();
    if (ctx.message?.text?.startsWith("/start") && payload.startsWith("join_")) {
      await acceptInvite(ctx, payload.slice(5));
      return;
    }
    let member = await requireMember(ctx);
    if (!member) return;
    if (ctx.message?.text?.startsWith("/start")) {
      await joinTeam(member.chat_id, "", {
        username: ctx.from?.username ?? null,
        displayName: ctx.from?.first_name ?? null,
      });
      member = await findMember(member.chat_id) ?? member;
      await applyRoster(member);
    }
    await setTeamCommands(bot.api, member);
    menuShown.add(member.chat_id);
    await ctx.reply(helpText(isFounder(member.chat_id), !!teamAiConfig()), { reply_markup: keyboardFor(ctx) });
    if (ctx.message?.text?.startsWith("/start")) {
      await withData(ctx, async () => showSchedule(ctx, defaultScheduleDeps(scopeOf(ctx)), 0, false, new Date()));
    }
  });

  // ── Быстрые ответы ─────────────────────────────────────────────────────────
  bot.command("faq", async (ctx) => {
    if (!(await requireMember(ctx))) return;
    const query = (ctx.match ?? "").toString().trim();
    if (!query) {
      await ctx.reply(faqIndexText());
      return;
    }
    await replyFaq(ctx, query);
  });

  // ── Сводка дня ─────────────────────────────────────────────────────────────
  bot.command(["mute", "unmute"], async (ctx) => {
    const member = await requireMember(ctx);
    if (!member) return;
    const on = ctx.message?.text?.startsWith("/unmute") ?? false;
    const ok = await setDigestOptIn(member.chat_id, on);
    if (!ok) {
      await ctx.reply("Не смогла сохранить настройку. Загляни в логи сервера.");
      return;
    }
    await ctx.reply(
      on
        ? "Буду снова присылать план на день в 8:00 МСК."
        : "Больше не присылаю план на день. Расписание по-прежнему в /schedule. Вернуть — /unmute.",
    );
  });

  // ── Команда ────────────────────────────────────────────────────────────────
  bot.command("team", async (ctx) => {
    const member = await requireMember(ctx);
    if (!member) return;
    await showTeam(ctx, defaultTeamScreenDeps(scopeOf(ctx)), member.chat_id, false);
  });

  bot.command("kick", async (ctx) => {
    const member = await requireMember(ctx);
    if (!member) return;
    if (!isFounder(member.chat_id)) {
      await ctx.reply("Убирать людей могут только фаундеры. Кто в команде, видно в /team.");
      return;
    }
    const target = (ctx.match ?? "").toString().trim();
    if (!target) {
      await ctx.reply("Кого убрать? /kick @ник (или /kick <chat_id> из /team)");
      return;
    }
    const res = await removeMember(target);
    if (res.status === "removed") {
      await ctx.reply(
        `Убрала: ${res.member.username ? `@${res.member.username}` : res.member.chat_id}.`,
      );
    } else if (res.status === "founder") {
      await ctx.reply("Фаундера убрать нельзя: его права заданы в настройках сервера.");
    } else {
      await ctx.reply(`Не нашла «${target}» в команде. Полный список — /team.`);
    }
  });

  // Скрытая команда фаундеров: жива ли связь с Yandex AI Studio (без логов Railway).
  bot.command("ai_check", async (ctx) => {
    const member = await requireMember(ctx);
    if (!member) return;
    if (!isFounder(member.chat_id)) {
      await ctx.reply("Это команда фаундеров.");
      return;
    }
    await ctx.replyWithChatAction("typing").catch(() => {});
    await ctx.reply(await aiCheckText(defaultCheckDeps()));
  });

  // ── Проекты ────────────────────────────────────────────────────────────────
  bot.command("project", async (ctx) => {
    const member = await requireMember(ctx);
    if (!member) return;
    const scope = scopeOf(ctx);
    if (!isMulti(scope)) {
      await ctx.reply(`Ты в проекте ${projectLabel(scope.project)}.`, { reply_markup: keyboardFor(ctx) });
      return;
    }
    const kb = new InlineKeyboard();
    for (const p of scope.projects) kb.text(`${projectLabel(p)}${p.id === scope.project.id ? " ✓" : ""}`, `pj:${p.id}`).row();
    await ctx.reply("Выбери проект:", { reply_markup: kb });
  });

  bot.callbackQuery(/^pj:([a-z0-9_-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const scope = scopeOf(ctx);
    const target = scope.projects.find((p) => p.id === ctx.match[1]);
    if (!target || !ctx.from) {
      await ctx.reply("Этого проекта нет в твоём списке.");
      return;
    }
    await setCurrentProject(ctx.from.id, target.id);
    setScope(ctx, await scopeFor(scopeDeps(), target, scope.projects));
    await ctx.editMessageText(`Проект: ${projectLabel(target)}`).catch(() => {});
    menuShown.add(ctx.from.id);
    await ctx.reply(`Переключила на ${projectLabel(target)}`, { reply_markup: keyboardFor(ctx) });
  });

  bot.command("leave", async (ctx) => {
    const member = await requireMember(ctx);
    if (!member) return;
    const res = await removeMember(String(member.chat_id), { allowFounder: true });
    if (res.status === "removed") {
      await ctx.reply("Вышла тебя из команды. Вернуться — /join <ключ>.");
    } else {
      await ctx.reply("Кажется, тебя уже нет в команде.");
    }
  });

  // ── Свободный текст ────────────────────────────────────────────────────────
  // Разговаривать бот не умеет и не притворяется. Но набранное словом «дождь»
  // или «лужники 13.09» — это почти всегда либо вопрос из FAQ, либо название
  // забега, и провести человека туда дешевле, чем отправить читать /help.
  bot.on("message:text", async (ctx) => {
    const member = await requireMember(ctx);
    if (!member) return;

    const text = ctx.message.text.trim();
    // С ассистентом любое сообщение — ему: «нет, Насте» из двух слов — тоже
    // разговор, а не поиск забега. Быстрые ответы у него есть инструментом.
    if (teamAiConfig() && (await handleAiMessage(ctx, member, assistantDeps(scopeOf(ctx))))) return;

    await withData(ctx, async () => {
      const snap = await snapshot();
      const run = pickRun(text, snap.runs);
      if (run) {
        await openCoffeeRunScreen(ctx, defaultEventsDeps(), run.spot, run.date, false, new Date());
        return;
      }
      if (await replyFaq(ctx, text, { quiet: true })) return;
      await ctx.reply(
        `Свободно говорить не умею.\n\n${helpText(isFounder(member.chat_id), !!teamAiConfig())}`,
      );
    });
  });

  bot.on("message:voice", async (ctx, next) => {
    const member = await requireMember(ctx);
    if (!member) return;
    if (teamAiConfig() && (await handleAiMessage(ctx, member, assistantDeps(scopeOf(ctx))))) return;
    await next();
  });

  bot.on("message", async (ctx) => {
    if (!(await requireMember(ctx))) return;
    await ctx.reply("Я понимаю только текст и команды. Что умею — /help.");
  });

  bot.catch((err) => {
    console.error("[team-bot] Unhandled error:", err.message);
  });
}

/**
 * Ответ из FAQ. Одно совпадение — ответ, несколько — список уточнений.
 * `quiet` для свободного текста: там «не нашла» скажет сам вызывающий, вместе
 * с подсказкой про команды.
 */
async function replyFaq(
  ctx: TeamContext,
  query: string,
  opts: { quiet?: boolean } = {},
): Promise<boolean> {
  const found = findFaq(query);
  if (found.length === 1) {
    await ctx.reply(faqAnswerText(found[0]));
    return true;
  }
  if (found.length > 1) {
    await ctx.reply(
      ["Нашла несколько — уточни:", "", ...found.map((e) => `• /faq ${e.key} — ${e.question}`)].join(
        "\n",
      ),
    );
    return true;
  }
  if (!opts.quiet) {
    await ctx.reply(`Такого в быстрых ответах нет.\n\n${faqIndexText()}`);
    return true;
  }
  return false;
}

/**
 * Меню слэш-команд: только /start и /help. Разделы открываются кнопками
 * постоянной клавиатуры (menuKeyboard в copy.ts); остальные команды
 * (/tasks, /faq, /mute…) работают, но в меню не выносятся.
 */
export const TEAM_COMMANDS = [
  { command: "start", description: "Меню" },
  { command: "help", description: "Что я умею" },
];

/** Telegram сохраняет меню чата между релизами: обновляем на /start и /join. */
export async function setTeamCommands(api: Api, member: TeamMember): Promise<void> {
  try {
    await api.setMyCommands(TEAM_COMMANDS, { scope: { type: "chat", chat_id: member.chat_id } });
  } catch (err) {
    console.error("[team] setMyCommands:", err instanceof Error ? err.message : String(err));
  }
}

// ── Ленивый синглтон ──────────────────────────────────────────────────────────
// Bot не создаём на уровне модуля: grammY бросает на пустом токене, а это
// сломало бы `next build` там, где модуль импортируется до появления env.
let _bot: Bot<TeamContext> | null = null;

export function getTeamBot(): Bot<TeamContext> {
  if (_bot) return _bot;
  const bot = new Bot<TeamContext>(teamToken());
  registerHandlers(bot);
  _bot = bot;
  return bot;
}
