import type { BotContext } from "./bot";
import { sendBotMessage } from "./send";
import { isAdminChat } from "./poll-store";
import {
  SURVEY_TEST_INTRO,
  SURVEY_TEST_REWORK,
  SURVEY_TEST_VERDICT,
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
  surveyTestVerdictKeyboard,
  startMessage,
  type AdminAction,
} from "./club-survey-copy";
import { activeSurvey, surveyStartLink, type ClubSurvey } from "../clubs/survey-config";
import { dispatchSurveyResult, dispatchSurveyStart } from "../clubs/survey-dispatch";
import { surveySummary } from "../clubs/survey-slots";
import {
  confirmResult,
  createResponse,
  createResultDraft,
  currentResult,
  deleteResponse,
  getResult,
  listResponses,
} from "../clubs/survey-store";

/**
 * Опрос клуба — команды организатора. Как остальные организаторские команды,
 * отвечают только чату, прошедшему /admin <ключ>; остальным — молчат.
 *
 *   /survey        — сводка: кто что ответил, лучшие слоты, ссылка для поста;
 *   /surveysend    — стартовое сообщение бегавшим, с предпросмотром и
 *                    тестовым прогоном на себе («Тест» → «Апрув» / «На доработку»);
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

const TEST_RUNS = Symbol.for("nika.clubsurvey.testruns");

/**
 * Идущие тестовые прогоны: «<ключ опроса>:<chat_id участника>» → чат
 * организатора, куда прислать «Апрув» / «На доработку».
 *
 * В памяти, а не в базе: прогон — минуты, а после рестарта организатор
 * просто снова жмёт «Тест» в /surveysend. Сама тестовая строка ответа — в
 * базе, как у всех: иначе сценарий участника не прошёл бы.
 */
function testRuns(): Map<string, number> {
  const g = globalThis as unknown as Record<symbol, Map<string, number> | undefined>;
  if (!g[TEST_RUNS]) g[TEST_RUNS] = new Map();
  return g[TEST_RUNS];
}

const testRunKey = (key: string, chatId: number) => `${key}:${chatId}`;

export function isSurveyTestRun(key: string, chatId: number): boolean {
  return testRuns().has(testRunKey(key, chatId));
}

export function __resetSurveyTestsForTests(): void {
  testRuns().clear();
  inFlight().clear();
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

/**
 * «Тест»: стартовое сообщение — только организатору в личку, строка ответа
 * заводится как у рассылки, чтобы он прошёл опрос глазами участника.
 * Прошлые ответы организатора в опросе стираем: тест каждый раз с начала.
 */
async function startTest(ctx: BotContext, adminChat: number, survey: ClubSurvey): Promise<void> {
  const userId = ctx.from?.id;
  if (userId === undefined) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }
  await ctx.answerCallbackQuery({ text: "Присылаю тебе" }).catch(() => {});
  await ctx.reply(SURVEY_TEST_INTRO);

  await deleteResponse(survey.key, userId);
  testRuns().set(testRunKey(survey.key, userId), adminChat);

  const msg = startMessage(survey);
  const res = await sendBotMessage(userId, msg.text, msg.keyboard);
  if (!res.ok) {
    testRuns().delete(testRunKey(survey.key, userId));
    await ctx.reply("Не смогла прислать тебе опрос: напиши боту в личку /start и нажми «Тест» снова.");
    return;
  }
  await createResponse(survey.key, userId, "broadcast", { last_msg_id: res.messageId ?? null });
}

/** Конец тестового прогона: кнопки «Апрув» / «На доработку» в чат организатора. */
export async function offerSurveyTestVerdict(survey: ClubSurvey, chatId: number): Promise<void> {
  const adminChat = testRuns().get(testRunKey(survey.key, chatId));
  if (adminChat === undefined) return;
  await sendBotMessage(adminChat, SURVEY_TEST_VERDICT, surveyTestVerdictKeyboard(survey.key));
}

/**
 * Стереть тестовые строки прогонов, начатых из этого чата. После рестарта
 * карта пуста — тогда стираем строку того, кто нажал: тест проходил он.
 */
async function finishTests(ctx: BotContext, adminChat: number, survey: ClubSurvey): Promise<void> {
  const prefix = `${survey.key}:`;
  const testers = [...testRuns()]
    .filter(([k, chat]) => chat === adminChat && k.startsWith(prefix))
    .map(([k]) => Number(k.slice(prefix.length)));
  if (testers.length === 0 && ctx.from?.id !== undefined) testers.push(ctx.from.id);

  for (const chatId of testers) {
    await deleteResponse(survey.key, chatId);
    testRuns().delete(testRunKey(survey.key, chatId));
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
    else if (action.type === "test") await startTest(ctx, chatId, survey);
    else if (action.type === "approve") {
      await finishTests(ctx, chatId, survey);
      await startSend(ctx, chatId, survey);
    } else if (action.type === "rework") {
      await finishTests(ctx, chatId, survey);
      await ctx.answerCallbackQuery({ text: "Не отправляю" }).catch(() => {});
      await ctx.reply(SURVEY_TEST_REWORK);
    } else if (action.type === "result_send") await resultSend(ctx, chatId, survey, action.resultId);
  } catch (err) {
    logError("callback", err);
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply(DB_DOWN);
  }
}
