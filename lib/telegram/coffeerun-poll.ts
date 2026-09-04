import { sendBotMessage } from "./send";
import {
  parsePollCallback,
  pollReplyText,
  summaryText,
  voteLine,
} from "./poll-copy";
import {
  addAdminChat,
  adminChats,
  isAdminChat,
  pollSummary,
  recordVote,
  removeAdminChat,
} from "./poll-store";
import { runByDate, nextRun } from "../coffeerun/run";
import { dispatchCoffeeRunPoll } from "../coffeerun/poll-dispatch";
import type { BotContext } from "./bot";

/**
 * Опрос «завтра дождь — побежишь?» целиком внутри Telegram.
 *
 * Как это выглядит для организатора:
 *   /admin <ключ>  — один раз: бот запоминает этот чат как «мой»;
 *   /pollsend      — разослать вопрос подтвердившим участникам ближайшего забега
 *                    (/pollsend 2026-09-06 — по конкретной дате);
 *   ответы         — прилетают сюда же по одному: «Аня (@anya) — ПОБЕЖИТ, итого …»;
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

  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    await ctx.reply(
      "Ключ администратора не настроен на сервере (переменная ADMIN_SECRET) — " +
        "пока она пустая, я никого не пущу.",
    );
    return;
  }

  const entered = (ctx.match ?? "").toString().trim();
  if (entered !== secret) {
    // Не подсказываем, что именно не так: перебирающему знать нечего.
    await ctx.reply("Не узнала ключ.");
    return;
  }

  addAdminChat(chatId);
  await ctx.reply(
    [
      "Готово — буду присылать ответы на опрос сюда.",
      "",
      "/pollsend — разослать вопрос про дождь участникам ближайшего забега",
      "/pollsend 2026-09-06 — то же по конкретной дате",
      "/poll — сводка: кто побежит, кто нет, кто молчит",
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

  const vote = recordVote(chatId, parsed.answer, {
    // Запасное имя, если карточка рассылки не пережила перезапуск: как человек
    // подписан в Telegram.
    name: [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || "участник",
    username: ctx.from?.username ?? null,
  });

  await ctx
    .answerCallbackQuery({ text: parsed.answer === "yes" ? "Ждём тебя!" : "Записала, спасибо" })
    .catch(() => {});

  const summary = pollSummary();
  await notifyAdmins(voteLine(vote, { yes: summary.yes.length, no: summary.no.length }));

  // Кнопки убираем: вопрос закрыт, а «побегу/не побегу» под уже отвеченным
  // сообщением путает.
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

  const run = runByDate(parsed.runDate) ?? nextRun();
  await ctx.reply(pollReplyText(parsed.answer, run)).catch((err) => {
    console.error("[coffeerun-poll] reply:", err instanceof Error ? err.message : err);
  });
}
