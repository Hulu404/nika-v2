import type { BotContext } from "./bot";
import { sendBotMessage } from "./send";
import { isAdminChat } from "./poll-store";
import {
  TEXT,
  parseSurveyResultCommand,
  resultConfirmKeyboard,
  resultPreviewText,
  resultRetryKeyboard,
  surveyReportText,
  surveyResultErrorText,
  surveySendConfirmKeyboard,
  surveySendPreviewText,
  surveySendRetryKeyboard,
  surveySummaryText,
  type AdminAction,
} from "./club-survey-copy";
import { activeSurvey, surveyStartLink, type ClubSurvey } from "../clubs/survey-config";
import { dispatchSurveyResult, dispatchSurveyStart } from "../clubs/survey-dispatch";
import { surveySummary } from "../clubs/survey-slots";
import { confirmResult, createResultDraft, currentResult, getResult, listResponses } from "../clubs/survey-store";

/**
 * Опрос клуба — команды организатора. Как остальные организаторские команды,
 * отвечают только чату, прошедшему /admin <ключ>; остальным — молчат.
 *
 *   /survey        — сводка: кто что ответил, лучшие слоты, ссылка для поста;
 *   /surveysend    — стартовое сообщение бегавшим, с предпросмотром;
 *   /surveyresult  — итог: дата, время, место; предпросмотр обоих вариантов.
 *
 * Рассылки — по кнопке, в фоне, отчёт приходит сюда же: как /say и /open.
 */

const IN_FLIGHT = Symbol.for("nika.clubsurvey.inflight");

/**
 * Рассылки, которые идут прямо сейчас. Двойной тап по «Разослать» успевает
 * прийти раньше, чем исчезнут кнопки, а отметка «уже отправили» ставится
 * только после отправки — две параллельные рассылки задвоили бы сообщения.
 */
function inFlight(): Set<string> {
  const g = globalThis as unknown as Record<symbol, Set<string> | undefined>;
  if (!g[IN_FLIGHT]) g[IN_FLIGHT] = new Set();
  return g[IN_FLIGHT];
}

const DB_DOWN = "Не получилось собрать список — база не ответила. Проверь, применена ли миграция 063_club_surveys.sql, и смотри логи сервера.";

function logError(where: string, err: unknown): void {
  console.error(`[club-survey-admin] ${where}:`, err instanceof Error ? err.message : String(err));
}

function adminChatId(ctx: BotContext): number | null {
  const chatId = ctx.chat?.id;
  return chatId !== undefined && isAdminChat(chatId) ? chatId : null;
}

/** /survey — сводка. */
export async function handleSurveySummaryCommand(ctx: BotContext): Promise<void> {
  if (adminChatId(ctx) === null) return;
  const survey = activeSurvey();
  try {
    const rows = await listResponses(survey.key);
    await ctx.reply(surveySummaryText(survey, surveySummary(rows, survey), surveyStartLink(survey)));
  } catch (err) {
    logError("summary", err);
    await ctx.reply(DB_DOWN);
  }
}

/** /surveysend — предпросмотр стартовой рассылки. */
export async function handleSurveySendCommand(ctx: BotContext): Promise<void> {
  if (adminChatId(ctx) === null) return;
  const survey = activeSurvey();

  let preview;
  try {
    preview = await dispatchSurveyStart(survey, { dryRun: true });
  } catch (err) {
    logError("send preview", err);
    await ctx.reply(DB_DOWN);
    return;
  }

  if (!preview.wouldSend) {
    await ctx.reply(
      `Некому отправлять: бегали с нами ${preview.alumni} чел., уже спрошены ${preview.alreadyAsked}, ` +
        `просили не писать ${preview.optedOut}. Сводка — /survey.`,
    );
    return;
  }

  await ctx.reply(surveySendPreviewText(preview, TEXT.interest), {
    reply_markup: surveySendConfirmKeyboard(survey.key),
  });
}

/** /surveyresult <дата> <время> <место> | <что взять> — черновик итога и предпросмотр. */
export async function handleSurveyResultCommand(ctx: BotContext): Promise<void> {
  if (adminChatId(ctx) === null) return;
  const survey = activeSurvey();

  const parsed = parseSurveyResultCommand(survey, (ctx.match ?? "").toString());
  if (!parsed.ok) {
    await ctx.reply(surveyResultErrorText(survey, parsed.reason));
    return;
  }

  try {
    const draft = await createResultDraft(survey.key, parsed.args);
    const [preview, previous] = await Promise.all([
      dispatchSurveyResult(survey, draft, { dryRun: true }),
      currentResult(survey.key),
    ]);

    if (preview.match + preview.nomatch === 0) {
      await ctx.reply("Некому отправлять: согласие дали 0 чел. или все уже получили этот итог. Сводка — /survey.");
      return;
    }

    await ctx.reply(
      resultPreviewText(draft, preview, previous ? { result: previous, received: preview.hadPrevious } : null),
      { reply_markup: resultConfirmKeyboard(survey.key, draft.id) },
    );
  } catch (err) {
    logError("result preview", err);
    await ctx.reply(DB_DOWN);
  }
}

/** Фоновая рассылка с отчётом. Ключ inFlight снимается в любом случае. */
function runInBackground(
  chatId: number,
  key: string,
  job: () => Promise<{ sent?: number; blocked?: number; failed?: number; hasMore?: boolean }>,
  retry: Parameters<typeof sendBotMessage>[2],
): void {
  void job()
    .then((res) => sendBotMessage(chatId, surveyReportText(res), res.failed || res.hasMore ? retry : undefined))
    .catch((err) => {
      logError(`send ${key}`, err);
      return sendBotMessage(chatId, "Рассылка упала — смотри логи сервера.");
    })
    .finally(() => inFlight().delete(key));
}

async function startSend(ctx: BotContext, chatId: number, survey: ClubSurvey): Promise<void> {
  const key = `start:${survey.key}`;
  if (inFlight().has(key)) {
    await ctx.answerCallbackQuery({ text: "Уже рассылаю" }).catch(() => {});
    return;
  }
  inFlight().add(key);
  await ctx.answerCallbackQuery({ text: "Рассылаю" }).catch(() => {});
  await ctx.reply("Рассылаю стартовое сообщение опроса. Итог пришлю сюда, ответы — в эту же ленту.");
  runInBackground(chatId, key, () => dispatchSurveyStart(survey), surveySendRetryKeyboard(survey.key));
}

async function resultSend(ctx: BotContext, chatId: number, survey: ClubSurvey, resultId: number): Promise<void> {
  const key = `result:${resultId}`;
  if (inFlight().has(key)) {
    await ctx.answerCallbackQuery({ text: "Уже рассылаю" }).catch(() => {});
    return;
  }

  const [draft, current] = await Promise.all([getResult(resultId), currentResult(survey.key)]);
  if (!draft || draft.survey_key !== survey.key) {
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply("Не нашла этот итог. Пришли /surveyresult заново.");
    return;
  }
  // Старый черновик после рассылки нового итога перепутал бы людям время.
  if (current && current.id > resultId) {
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply("Этот вариант итога устарел: после него уже разослан другой. Сводка — /survey.");
    return;
  }

  inFlight().add(key);
  try {
    const result = await confirmResult(resultId);
    if (!result) throw new Error("result vanished");
    await ctx.answerCallbackQuery({ text: "Рассылаю" }).catch(() => {});
    await ctx.reply("Рассылаю итог. Отчёт пришлю сюда, ответы «буду / не приду» — в ленту.");
    runInBackground(chatId, key, () => dispatchSurveyResult(survey, result), resultRetryKeyboard(survey.key, resultId));
  } catch (err) {
    inFlight().delete(key);
    throw err;
  }
}

/** Кнопки организатора под предпросмотрами и «Дослать остальным» под отчётами. */
export async function handleSurveyAdminCallback(ctx: BotContext, survey: ClubSurvey, action: AdminAction): Promise<void> {
  const chatId = adminChatId(ctx);
  if (chatId === null) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  // Кнопки убираем в любом случае: решение принято.
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

  if ((action.type === "send" && !action.go) || action.type === "result_cancel") {
    await ctx.answerCallbackQuery({ text: "Отменила" }).catch(() => {});
    await ctx.reply("Отменила — никому ничего не отправляла.");
    return;
  }

  try {
    if (action.type === "send") await startSend(ctx, chatId, survey);
    else if (action.type === "result_send") await resultSend(ctx, chatId, survey, action.resultId);
  } catch (err) {
    logError("callback", err);
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply(DB_DOWN);
  }
}
