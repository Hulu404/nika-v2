import { sendBotMessage } from "./send";
import {
  parsePollCallback,
  parseRollcallCallback,
  pollReplyText,
  rollcallConfirmKeyboard,
  rollcallPreviewText,
  summaryText,
  voteLine,
} from "./poll-copy";
import {
  addAdminChat,
  adminChats,
  isAdminChat,
  movedStartFor,
  pollKind,
  pollRunDate,
  pollStartTime,
  pollSummary,
  recordVote,
  removeAdminChat,
  startPoll,
} from "./poll-store";
import { parseTime } from "./notice-copy";
import { cancelledWarning } from "./coffeerun-notice";
import { runByDate, nextRun } from "../coffeerun/run";
import { dispatchCoffeeRunPoll } from "../coffeerun/poll-dispatch";
import type { BotContext } from "./bot";

/**
 * Опросы участников забега целиком внутри Telegram: перекличка «придёшь
 * сегодня?» и вопрос про дождь накануне. Механика общая, отличаются словами
 * (PollKind в poll-store).
 *
 * Как это выглядит для организатора:
 *   /admin <ключ>  — один раз: бот запоминает этот чат как «мой»;
 *   /rollcall      — перекличка на сегодня (время — из последнего переноса);
 *   /pollsend      — вопрос про дождь накануне;
 *   ответы         — прилетают сюда же по одному: «Аня (@anya) — ПРИДЁТ, итого …»;
 *   /poll          — сводка со списками в любой момент;
 *   /pollstop      — перестать присылать ответы в этот чат.
 *
 * Для участника: одно сообщение с двумя кнопками, ответ можно поменять.
 *
 * Базы данных здесь нет вовсе (см. поясняющий комментарий в poll-store.ts):
 * архив ответов — сама переписка с ботом.
 */

/**
 * Сколько сообщений шлём за один /pollsend. Рассылка идёт в фоне, вебхук её не
 * ждёт, поэтому лимит куда выше, чем у HTTP-роута: 60 человек — это минута
 * работы, зато организатору не нужно жать команду дважды.
 */
const SEND_BATCH = 60;

/** Команда /admin: пускаем по ADMIN_SECRET, тому же, что охраняет /admin/*. */
export async function handlePollAdminCommand(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;

  // trim с обеих сторон: значение из панели хостинга легко скопировать с
  // хвостовым пробелом или переводом строки, и тогда совпадения не будет
  // никогда — а выглядит это как «бот меня не пускает».
  const secret = (process.env.ADMIN_SECRET ?? "").trim();
  if (!secret) {
    await ctx.reply(
      "Ключ администратора не настроен на сервере (переменная ADMIN_SECRET) — " +
        "пока она пустая, я никого не пущу.",
    );
    return;
  }

  const entered = (ctx.match ?? "").toString().trim();
  // Пустой аргумент — не попытка подобрать ключ, а непонятый формат команды.
  // Это самая частая причина «не узнала ключ», поэтому отвечаем по-человечески.
  if (!entered) {
    await ctx.reply("Пришли ключ одной строкой через пробел: /admin твой-ключ");
    return;
  }
  if (entered !== secret) {
    // Не подсказываем, что именно не так: перебирающему знать нечего.
    await ctx.reply("Не узнала ключ.");
    return;
  }

  addAdminChat(chatId);
  await ctx.reply(
    [
      "Готово — буду присылать ответы сюда.",
      "",
      "/rollcall — перекличка «кто придёт сегодня»; время беру из последнего переноса " +
        "(/rollcall 19:00 — своё время)",
      "/moved — перенести старт на 18:00 сегодня (/moved 19:00 дождь — своё время и причина)",
      "/cancel — отменить забег (/cancel гроза — с причиной)",
      "/pollsend — вопрос про дождь накануне забега",
      "/poll — сводка: кто придёт, кто нет, кто молчит",
      "/pollstop — перестать присылать ответы в этот чат",
      "",
      "Сообщение с ключом лучше удали из переписки.",
    ].join("\n"),
  );
}

/** /pollstop — отписать чат от ленты ответов. */
export async function handlePollStopCommand(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined || !isAdminChat(chatId)) return;
  removeAdminChat(chatId);
  await ctx.reply("Больше не присылаю сюда ответы. Вернуться — /admin <ключ>.");
}

/** /poll — сводка. Молчим для всех, кто не прошёл /admin. */
export async function handlePollSummaryCommand(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined || !isAdminChat(chatId)) return;

  const summary = pollSummary();
  await ctx.reply(summaryText(summary, summary.runDate ? runByDate(summary.runDate) : null));
}

/**
 * /pollsend [YYYY-MM-DD] — разослать вопрос.
 *
 * Рассылка идёт в фоне: сообщения уходят по одному в секунду, и на полсотни
 * человек это минута — столько вебхук ждать не должен. Поэтому сразу отвечаем
 * «начала», а итог присылаем отдельным сообщением.
 */
export async function handlePollSendCommand(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined || !isAdminChat(chatId)) return;

  const arg = (ctx.match ?? "").toString().trim();
  const run = arg ? runByDate(arg) : nextRun();
  if (!run) {
    await ctx.reply(`Не знаю забега с датой ${arg}. Забеги задаются в lib/coffeerun/run.ts.`);
    return;
  }

  const preview = await dispatchCoffeeRunPoll({
    runDate: run.date,
    dryRun: true,
    limit: SEND_BATCH,
  });
  if (!preview.ok) {
    await ctx.reply(`Не получилось: ${preview.error ?? "неизвестная ошибка"}`);
    return;
  }
  if (!preview.wouldSend) {
    await ctx.reply(
      `Некому отправлять: в забеге ${run.spotName}, ${run.dateLabel} подтвердили участие ` +
        `${preview.confirmed ?? 0} чел., и все уже получили вопрос. Сводка — /poll.`,
    );
    return;
  }

  await ctx.reply(
    `Рассылаю вопрос про дождь: ${preview.wouldSend} чел. ` +
      `(${run.spotName}, ${run.dateLabel}). Ответы буду присылать сюда.`,
  );

  void dispatchCoffeeRunPoll({ runDate: run.date, limit: SEND_BATCH })
    .then((res) => {
      const tail = res.hasMore ? " Остались неотправленные — запусти /pollsend ещё раз." : "";
      return sendBotMessage(
        chatId,
        `Разослала: ${res.sent ?? 0}. Заблокировали бота: ${res.blocked ?? 0}. ` +
          `Не дошло: ${res.failed ?? 0}.${tail}`,
      );
    })
    .catch((err) => {
      console.error("[coffeerun-poll] send:", err instanceof Error ? err.message : err);
      return sendBotMessage(chatId, "Рассылка упала — смотри логи сервера.");
    });
}

/**
 * /rollcall [время] [дата] — перекличка «кто придёт сегодня».
 *
 * Время по умолчанию берём из последнего объявленного переноса: если утром
 * разослали «бежим в 18:00», спрашивать «придёшь в 9:30?» нельзя. Переносов не
 * было — берём штатное время забега.
 *
 * Как и /moved, всегда в два шага: сначала предпросмотр с числом получателей и
 * дословным текстом, рассылка — только по кнопке.
 */
export async function handleRollcallCommand(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined || !isAdminChat(chatId)) return;

  const { runDate, startTime } = parseRollcallArgs((ctx.match ?? "").toString());
  const run = runDate ? runByDate(runDate) : nextRun();
  if (!run) {
    await ctx.reply(`Не знаю забега с датой ${runDate}. Забеги задаются в lib/coffeerun/run.ts.`);
    return;
  }

  const moved = movedStartFor(run.date);
  const start = startTime ?? moved ?? run.startTime;

  const preview = await dispatchCoffeeRunPoll({
    runDate: run.date,
    kind: "rollcall",
    startTime: start,
    dryRun: true,
    limit: SEND_BATCH,
  });
  if (!preview.ok) {
    await ctx.reply(`Не получилось: ${preview.error ?? "неизвестная ошибка"}`);
    return;
  }
  if (!preview.wouldSend) {
    await ctx.reply(
      `Некому отправлять: в забеге ${run.spotName}, ${run.dateLabel} подтвердили участие ` +
        `${preview.confirmed ?? 0} чел., и все уже получили перекличку. Сводка — /poll.`,
    );
    return;
  }

  // Перекличка по отменённому забегу — почти наверняка ошибка, но решает
  // организатор: он мог отменить утренний старт и звать людей заново.
  await ctx.reply(
    cancelledWarning(run.date) +
      rollcallPreviewText(run, start, preview.wouldSend ?? 0, startTime === null && moved !== null),
    { reply_markup: rollcallConfirmKeyboard(run.date, start) },
  );
}

/** Аргументы /rollcall: время и дата в любом порядке, оба необязательны. */
export function parseRollcallArgs(raw: string): {
  runDate: string | null;
  startTime: string | null;
} {
  let runDate: string | null = null;
  let startTime: string | null = null;

  for (const part of raw.trim().split(/\s+/).filter(Boolean)) {
    if (!runDate && /^\d{4}-\d{2}-\d{2}$/.test(part)) {
      runDate = part;
      continue;
    }
    if (!startTime) startTime = parseTime(part);
  }

  return { runDate, startTime };
}

/** Кнопки под предпросмотром переклички. Рассылка идёт в фоне. */
export async function handleRollcallCallback(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const parsed = parseRollcallCallback(ctx.callbackQuery?.data ?? "");

  if (chatId === undefined || !parsed || !isAdminChat(chatId)) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  // Кнопки убираем в любом случае: решение принято.
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

  if (parsed.action === "cancel") {
    await ctx.answerCallbackQuery({ text: "Отменила" }).catch(() => {});
    await ctx.reply("Отменила — никому ничего не отправляла.");
    return;
  }

  await ctx.answerCallbackQuery({ text: "Рассылаю" }).catch(() => {});
  await ctx.reply(
    `Рассылаю перекличку на ${parsed.startTime}. Ответы буду присылать сюда, сводка — /poll.`,
  );

  void dispatchCoffeeRunPoll({
    runDate: parsed.runDate,
    kind: "rollcall",
    startTime: parsed.startTime,
    limit: SEND_BATCH,
  })
    .then((res) => {
      const tail = res.hasMore ? " Остались неотправленные — запусти /rollcall ещё раз." : "";
      return sendBotMessage(
        chatId,
        `Разослала перекличку: ${res.sent ?? 0}. Заблокировали бота: ${res.blocked ?? 0}. ` +
          `Не дошло: ${res.failed ?? 0}.${tail}`,
      );
    })
    .catch((err) => {
      console.error("[coffeerun-poll] rollcall:", err instanceof Error ? err.message : err);
      return sendBotMessage(chatId, "Рассылка упала — смотри логи сервера.");
    });
}

/** Разослать строку ленты во все админ-чаты. */
async function notifyAdmins(text: string): Promise<void> {
  for (const chatId of adminChats()) {
    await sendBotMessage(chatId, text);
  }
}

/**
 * Нажатие кнопки участником. Регистрируется в bot.ts на POLL_CALLBACK_RE.
 *
 * Порядок «сначала записать и отчитаться организатору, потом ответить человеку»
 * выбран сознательно: цель опроса — цифра у организатора, и терять её из-за
 * упавшего reply нельзя.
 */
export async function handleCoffeeRunPollAnswer(ctx: BotContext): Promise<void> {
  const parsed = parsePollCallback(ctx.callbackQuery?.data ?? "");
  const chatId = ctx.from?.id;

  if (!parsed || chatId === undefined) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  // Активного опроса нет — значит процесс перезапускали, а человек нажал кнопку
  // из уже разосланного сообщения. Поднимаем опрос из самой кнопки: потерять
  // ответ хуже, чем начать сводку с середины.
  if (pollRunDate() === "") startPoll(parsed.runDate, parsed.kind);

  // Идёт другой опрос (началась перекличка, а нажали старую кнопку про дождь):
  // в сводку такой ответ не кладём — он про прошлый вопрос, — но организатору
  // всё равно показываем, только с пометкой.
  const stale = pollRunDate() !== parsed.runDate || pollKind() !== parsed.kind;

  const person = {
    // Запасное имя, если карточка рассылки не пережила перезапуск: как человек
    // подписан в Telegram.
    name: [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || "участник",
    username: ctx.from?.username ?? null,
  };

  await ctx
    .answerCallbackQuery({ text: parsed.answer === "yes" ? "Ждём тебя!" : "Записала, спасибо" })
    .catch(() => {});

  if (stale) {
    const label = parsed.kind === "rollcall" ? "перекличка" : "дождь";
    const verdict = parsed.answer === "yes" ? "ДА" : "нет";
    await notifyAdmins(
      `${person.username ? `${person.name} (@${person.username})` : person.name} — ${verdict} ` +
        `(ответ на прошлый вопрос: ${label}, ${parsed.runDate}). В сводку не считаю.`,
    );
  } else {
    const vote = recordVote(chatId, parsed.answer, person);
    const summary = pollSummary();
    await notifyAdmins(
      voteLine(vote, { yes: summary.yes.length, no: summary.no.length }, summary.kind),
    );
  }

  // Кнопки убираем: вопрос закрыт, а «побегу/не побегу» под уже отвеченным
  // сообщением путает.
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

  const run = runByDate(parsed.runDate) ?? nextRun();
  await ctx
    .reply(pollReplyText(parsed.answer, run, parsed.kind, stale ? null : pollStartTime()))
    .catch((err) => {
      console.error("[coffeerun-poll] reply:", err instanceof Error ? err.message : err);
    });
}
