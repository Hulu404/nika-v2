import { Bot, type Api, type Context } from "grammy";
import { spotName } from "../coffeerun/run";
import { isFounder, teamToken } from "./config";
import { buildDigest } from "./digest-build";
import { EVE_HOUR_MSK, MORNING_HOUR_MSK } from "./digest-schedule";
import {
  findMember,
  joinTeam,
  listTeam,
  removeMember,
  setDigestOptIn,
  touchMember,
  type TeamMember,
} from "./access";
import {
  defaultRun,
  mergeRuns,
  pickRun,
  type TeamRun,
} from "./runs";
import {
  aggregateRuns,
  dynamicsFor,
  fetchArchive,
  runKeysFrom,
  type ArchiveRow,
  type RunAggregate,
} from "./history";
import {
  fetchInviteCount,
  fetchRunSignups,
  summarizeSignups,
  viewSignups,
  type SignupView,
} from "./stats";
import {
  NOT_A_MEMBER_TEXT,
  backToRunKeyboard,
  contactsText,
  helpText,
  historyText,
  parseTeamCallback,
  remindersText,
  rosterText,
  runCardKeyboard,
  runCardText,
  runsKeyboard,
  runsOverviewText,
  teamText,
  TEAM_CALLBACK_RE,
} from "./copy";
import { faqAnswerText, faqIndexText, findFaq } from "./faq";
import { handleTeamTaskUpdate } from "./tasks";
import { handleScheduleUpdate, showSchedule, defaultScheduleDeps } from "./schedule";
import { supabaseTeamForms } from "./form";

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
  // Метка «был в боте» — для /team. Не ждём: ответ важнее метки.
  void touchMember(chatId);
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

/** Свод по забегу из уже прочитанного архива. Забег без заявок — честные нули. */
function aggFor(archive: readonly ArchiveRow[], run: TeamRun): RunAggregate {
  const found = aggregateRuns(archive).find((a) => a.spot === run.spot && a.date === run.date);
  return (
    found ?? {
      spot: run.spot,
      date: run.date,
      total: 0,
      confirmed: 0,
      reminded: 0,
      firstSignupAt: null,
      lastSignupAt: null,
    }
  );
}

/**
 * Забег по аргументу команды. Пустой аргумент — ближайший: в девяти случаях из
 * десяти спрашивают именно про него. Не найденный — не подменяем соседним, а
 * показываем список: перепутанный спот дороже лишнего нажатия.
 */
async function resolveRun(
  ctx: TeamContext,
  arg: string,
  snap: Snapshot,
): Promise<TeamRun | null> {
  const found = arg.trim() ? pickRun(arg, snap.runs) : defaultRun(snap.runs);
  if (found) return found;

  if (!arg.trim()) {
    await ctx.reply("Забегов пока нет ни в расписании, ни в заявках.");
    return null;
  }
  await ctx.reply(`Не нашла забег «${arg.trim()}». Вот что есть:`, {
    reply_markup: runsKeyboard(snap.runs),
  });
  return null;
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

// ── Экраны ───────────────────────────────────────────────────────────────────
// Каждый экран доступен и командой, и кнопкой, поэтому тело вынесено в функцию,
// а хендлеры — тонкие.

/** /runs — забеги, которые ещё в работе. Прошедшие живут в /history. */
async function showRuns(ctx: TeamContext, snap: Snapshot): Promise<void> {
  const active = snap.runs.filter((r) => !r.past);
  const items = active.map((run) => ({ run, agg: aggFor(snap.archive, run) }));
  await ctx.reply(runsOverviewText(items), { reply_markup: runsKeyboard(active) });
}

/** /history — весь архив, сгруппированный по спотам. */
async function showHistory(ctx: TeamContext, snap: Snapshot, filter: string): Promise<void> {
  let runs = snap.runs;
  if (filter.trim()) {
    const picked = pickRun(filter, snap.runs);
    if (!picked) {
      await ctx.reply(`Не нашла спот «${filter.trim()}». Показываю всё.`);
    } else {
      runs = snap.runs.filter((r) => r.spot === picked.spot);
    }
  }
  const items = runs.map((run) => ({ run, agg: aggFor(snap.archive, run) }));
  await ctx.reply(historyText(items, spotName));
}

async function showRunCard(ctx: TeamContext, run: TeamRun, snap: Snapshot): Promise<void> {
  const now = new Date();
  const [rows, invites] = await Promise.all([fetchRunSignups(run), fetchInviteCount(run)]);
  const dyn = dynamicsFor(run, snap.archive, now);
  await ctx.reply(runCardText(run, summarizeSignups(rows, now), invites, dyn, now), {
    reply_markup: runCardKeyboard(run),
  });
}

async function people(run: TeamRun): Promise<SignupView[]> {
  return viewSignups(await fetchRunSignups(run));
}

async function showRoster(ctx: TeamContext, run: TeamRun): Promise<void> {
  await ctx.reply(rosterText(run, await people(run)), { reply_markup: backToRunKeyboard(run) });
}

async function showReminders(ctx: TeamContext, run: TeamRun): Promise<void> {
  const rows = await fetchRunSignups(run);
  await ctx.reply(remindersText(run, viewSignups(rows), summarizeSignups(rows)), {
    reply_markup: backToRunKeyboard(run),
  });
}

async function showContacts(ctx: TeamContext, run: TeamRun): Promise<void> {
  await ctx.reply(contactsText(run, await people(run)), { reply_markup: backToRunKeyboard(run) });
}

export function registerHandlers(bot: Bot<TeamContext>): void {
  // Любая команда закрывает открытую форму (кроме /cancel: её разбирает обработчик форм).
  bot.use(async (ctx, next) => {
    const text = ctx.message?.text?.trim() ?? "";
    if (ctx.from && text.startsWith("/") && !/^\/cancel(?:@\w+)?$/i.test(text) && !/^\/(assign|event)\b/i.test(text)) {
      await supabaseTeamForms().clear(ctx.from.id).catch(() => {});
    }
    await next();
  });
  bot.use(async (ctx, next) => {
    if (await handleTeamTaskUpdate(ctx)) return;
    if (await handleScheduleUpdate(ctx)) return;
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
        await setTeamCommands(bot.api, res.member);
        await ctx.reply(
          [
            "Готово, ты в команде.",
            "",
            "Сообщение с ключом лучше удали из переписки.",
            "",
            helpText(isFounder(res.member.chat_id)),
          ].join("\n"),
        );
        break;
      case "already":
        await setTeamCommands(bot.api, res.member);
        await ctx.reply(`Ты и так в команде.\n\n${helpText(isFounder(res.member.chat_id))}`);
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
    let member = await requireMember(ctx);
    if (!member) return;
    if (ctx.message?.text?.startsWith("/start")) {
      await joinTeam(member.chat_id, "", {
        username: ctx.from?.username ?? null,
        displayName: ctx.from?.first_name ?? null,
      });
      member = await findMember(member.chat_id) ?? member;
    }
    await setTeamCommands(bot.api, member);
    await ctx.reply(helpText(isFounder(member.chat_id)));
    await withData(ctx, async () => showSchedule(ctx, defaultScheduleDeps(), 0, false, new Date()));
  });

  // ── Цифры ──────────────────────────────────────────────────────────────────
  bot.command("runs", async (ctx) => {
    if (!(await requireMember(ctx))) return;
    await withData(ctx, async () => showRuns(ctx, await snapshot()));
  });

  bot.command(["history", "hist"], async (ctx) => {
    if (!(await requireMember(ctx))) return;
    await withData(ctx, async () =>
      showHistory(ctx, await snapshot(), (ctx.match ?? "").toString()),
    );
  });

  bot.command("run", async (ctx) => {
    if (!(await requireMember(ctx))) return;
    await withData(ctx, async () => {
      const snap = await snapshot();
      const run = await resolveRun(ctx, (ctx.match ?? "").toString(), snap);
      if (run) await showRunCard(ctx, run, snap);
    });
  });

  bot.command("who", async (ctx) => {
    if (!(await requireMember(ctx))) return;
    await withData(ctx, async () => {
      const snap = await snapshot();
      const run = await resolveRun(ctx, (ctx.match ?? "").toString(), snap);
      if (run) await showRoster(ctx, run);
    });
  });

  // /notif и /notify — одно и то же: команда набирает по памяти, и промах по
  // окончанию не должен выглядеть как «бот не понял».
  bot.command(["notif", "notify"], async (ctx) => {
    if (!(await requireMember(ctx))) return;
    await withData(ctx, async () => {
      const snap = await snapshot();
      const run = await resolveRun(ctx, (ctx.match ?? "").toString(), snap);
      if (run) await showReminders(ctx, run);
    });
  });

  bot.command(["contacts", "contact"], async (ctx) => {
    if (!(await requireMember(ctx))) return;
    await withData(ctx, async () => {
      const snap = await snapshot();
      const run = await resolveRun(ctx, (ctx.match ?? "").toString(), snap);
      if (run) await showContacts(ctx, run);
    });
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

  // ── Автоматические сводки ──────────────────────────────────────────────────
  // Предпросмотр, а не отправка: сообщение, которое приходит команде само в
  // семь утра, должно быть можно прочитать заранее — иначе единственный способ
  // увидеть в нём опечатку это получить его в семь утра.
  bot.command("digest", async (ctx) => {
    if (!(await requireMember(ctx))) return;
    await withData(ctx, async () => {
      const snap = await snapshot();
      const run = await resolveRun(ctx, (ctx.match ?? "").toString(), snap);
      if (!run) return;
      const now = new Date();
      const [eve, morning] = await Promise.all([
        buildDigest("eve", run, now),
        buildDigest("morning", run, now),
      ]);
      await ctx.reply(
        [
          `Предпросмотр сводок — ${run.label}. Никому не уходит.`,
          "",
          `Накануне, ${EVE_HOUR_MSK}:00 МСК:`,
          "———",
          eve,
          "———",
          "",
          `В день забега, ${MORNING_HOUR_MSK}:00 МСК:`,
          "———",
          morning,
        ].join("\n"),
      );
    });
  });

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
        ? "Буду снова присылать сводки: накануне забега и утром в день старта."
        : "Больше не присылаю автоматические сводки. Расписание по-прежнему в /schedule. " +
            "Вернуть — /unmute.",
    );
  });

  // ── Команда ────────────────────────────────────────────────────────────────
  bot.command("team", async (ctx) => {
    const member = await requireMember(ctx);
    if (!member) return;
    await ctx.reply(teamText(await listTeam(), member.chat_id));
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

  // ── Кнопки ─────────────────────────────────────────────────────────────────
  bot.callbackQuery(TEAM_CALLBACK_RE, async (ctx) => {
    // «Часик» гасим сразу: иначе Telegram крутит его все те секунды, пока мы
    // ходим в базу, и человек жмёт кнопку второй раз.
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireMember(ctx))) return;

    await withData(ctx, async () => {
      const snap = await snapshot();
      const parsed = parseTeamCallback(ctx.callbackQuery.data ?? "", snap.runs);
      if (!parsed) return;

      if (parsed.kind === "all") return showRuns(ctx, snap);
      if (parsed.kind === "his") return showHistory(ctx, snap, "");

      if (!parsed.run) {
        // Кнопка из старого сообщения: забега нет ни в расписании, ни в базе.
        await ctx.reply("Про этот забег я больше ничего не знаю. Вот что есть сейчас:", {
          reply_markup: runsKeyboard(snap.runs),
        });
        return;
      }

      const run = parsed.run;
      if (parsed.kind === "run") return showRunCard(ctx, run, snap);
      if (parsed.kind === "who") return showRoster(ctx, run);
      if (parsed.kind === "rem") return showReminders(ctx, run);
      if (parsed.kind === "con") return showContacts(ctx, run);
    });
  });

  // ── Свободный текст ────────────────────────────────────────────────────────
  // Разговаривать бот не умеет и не притворяется. Но набранное словом «дождь»
  // или «лужники 13.09» — это почти всегда либо вопрос из FAQ, либо название
  // забега, и провести человека туда дешевле, чем отправить читать /help.
  bot.on("message:text", async (ctx) => {
    const member = await requireMember(ctx);
    if (!member) return;

    const text = ctx.message.text.trim();

    await withData(ctx, async () => {
      const snap = await snapshot();
      const run = pickRun(text, snap.runs);
      if (run) {
        await showRunCard(ctx, run, snap);
        return;
      }
      if (await replyFaq(ctx, text, { quiet: true })) return;
      await ctx.reply(
        `Я про цифры забегов, свободно говорить не умею.\n\n${helpText(isFounder(member.chat_id))}`,
      );
    });
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
 * Меню команд в интерфейсе Telegram — чтобы синтаксис не держали в голове.
 * Одно на всех: права у участников равные, фаундерские действия в меню не
 * выносим.
 */
export const TEAM_COMMANDS = [
  { command: "tasks", description: "Задачи" },
  { command: "assign", description: "Поставить задачу" },
  { command: "schedule", description: "Расписание" },
  { command: "runs", description: "Забеги в работе и цифры" },
  { command: "run", description: "Карточка забега" },
  { command: "history", description: "Все прошедшие забеги" },
  { command: "who", description: "Кто записался" },
  { command: "notif", description: "Кому ушло напоминание" },
  { command: "contacts", description: "Контакты участников" },
  { command: "faq", description: "Быстрые ответы" },
  { command: "digest", description: "Предпросмотр автосводок" },
  { command: "team", description: "Кто в команде" },
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
