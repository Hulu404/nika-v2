import type { InlineKeyboard } from "grammy";
import type { BotContext } from "./bot";
import { sendBotMessage } from "./send";
import { adminChats } from "./poll-store";
import { handleSurveyAdminCallback, isSurveyTestRun, offerSurveyTestVerdict } from "./club-survey-admin";
import {
  CLUB_SURVEY_CALLBACK_RE,
  daysKeyboard,
  isAdminAction,
  parseSurveyCallback,
  participantMessage,
  resultAnswerFeedLine,
  resultMessage,
  surveyFeedLine,
  weekdaysKeyboard,
  type SurveyMessage,
} from "./club-survey-copy";
import { activeSurvey, consentUrl, surveyByKey, type ClubSurvey } from "../clubs/survey-config";
import {
  PRIMARY_KINDS,
  surveyStep,
  type FlowContext,
  type FlowEvent,
  type FlowOutcome,
} from "../clubs/survey-flow";
import {
  createResponse,
  currentResult,
  getResponse,
  listResponses,
  updateResponse,
  type SurveyResponseRow,
  type SurveyResultRow,
  type SurveyStep,
} from "../clubs/survey-store";
import { surveySummary } from "../clubs/survey-slots";
import { LEGAL_VERSION } from "../legal";

/**
 * Опрос клуба для участника: /start <payload>, кнопки и ввод времени.
 * Сценарий — docs/club-survey.md, переходы — lib/clubs/survey-flow.ts,
 * тексты — club-survey-copy.ts. Здесь только Telegram и база.
 *
 * Порядок, как в handleCoffeeRunPollAnswer: сначала записать ответ в базу,
 * потом отвечать человеку. Потерять ответ хуже, чем не ответить: упавший
 * reply человек переживёт и нажмёт ещё раз, а потерянный шаг — нет.
 *
 * Логи — только коды ошибок, без текстов сообщений и ответов людей.
 */

export { CLUB_SURVEY_CALLBACK_RE };

/** Шаги, на которых свободный текст — наш: ввод времени и шаги с кнопками. */
const TEXT_STEPS: ReadonlySet<SurveyStep> = new Set<SurveyStep>([
  "time",
  "interest",
  "consent",
  "attend",
  "days",
  "later",
]);

/** Шаги, на которых опрос для человека закончен: тут тестовому прогону — вердикт. */
const END_STEPS: ReadonlySet<SurveyStep> = new Set<SurveyStep>(["done", "later_done", "skipped", "declined"]);

function logError(where: string, err: unknown): void {
  console.error(`[club-survey] ${where}:`, err instanceof Error ? err.message : String(err));
}

function flowContext(ctx: BotContext, survey: ClubSurvey, resultSent: boolean): FlowContext {
  const name = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ");
  return {
    survey,
    now: new Date(),
    resultSent,
    legalVersion: LEGAL_VERSION,
    person: { name: name || null, username: ctx.from?.username ?? null },
  };
}

/**
 * Записать переход. С ожидаемым updated_at: если строку успели поменять
 * (двойной тап), перечитываем и считаем переход заново — один раз.
 * null — строки нет или вторая попытка тоже не прошла.
 */
async function commit(
  survey: ClubSurvey,
  chatId: number,
  row: SurveyResponseRow,
  event: FlowEvent,
  fctx: FlowContext,
): Promise<{ row: SurveyResponseRow; out: FlowOutcome } | null> {
  let current = row;
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = surveyStep(current, event, fctx);
    if (out.ignored || Object.keys(out.patch).length === 0) return { row: current, out };

    const saved = await updateResponse(survey.key, chatId, out.patch, { expectedUpdatedAt: current.updated_at });
    if (saved) return { row: saved, out };

    const fresh = await getResponse(survey.key, chatId);
    if (!fresh) return null;
    current = fresh;
  }
  return null;
}

/** Повтор итога человеку: его вариант с кнопками. */
function repeatResult(survey: ClubSurvey, row: SurveyResponseRow, result: SurveyResultRow | null): SurveyMessage | null {
  if (!result || !row.result_variant || row.result_id !== result.id) return null;
  return resultMessage(survey, result, row.result_variant);
}

async function stripMessage(ctx: BotContext, chatId: number, messageId: number | null): Promise<void> {
  if (!messageId) return;
  await ctx.api.editMessageReplyMarkup(chatId, messageId, { reply_markup: undefined }).catch(() => {});
}

function redrawKeyboard(survey: ClubSurvey, row: SurveyResponseRow, what: "days" | "weekdays"): InlineKeyboard {
  return what === "days" ? daysKeyboard(survey, row.days) : weekdaysKeyboard(survey, row.weekdays);
}

/** Строка в ленту всем админ-чатам. Падение ленты не роняет ответ человеку. */
async function notifyAdmins(text: string): Promise<void> {
  for (const chatId of adminChats()) {
    await sendBotMessage(chatId, text);
  }
}

async function feed(survey: ClubSurvey, row: SurveyResponseRow, kind: "finished" | "result_answer"): Promise<void> {
  if (adminChats().length === 0) return;
  try {
    const rows = await listResponses(survey.key);
    if (kind === "finished") {
      const s = surveySummary(rows, survey);
      await notifyAdmins(surveyFeedLine(survey, row, { coming: s.coming, later: s.later }));
      return;
    }
    const totalYes = rows.filter((r) => r.result_id === row.result_id && r.result_answer === "yes").length;
    await notifyAdmins(resultAnswerFeedLine(row, row.result_answer === "yes", totalYes));
  } catch (err) {
    logError("feed", err);
  }
}

/**
 * Ответить человеку по итогу перехода: снять или перерисовать кнопки, прислать
 * тексты, запомнить сообщение с главными кнопками шага. false — по опросу
 * сказать нечего (fallback): пусть отвечает общий обработчик бота.
 */
async function deliver(
  ctx: BotContext,
  survey: ClubSurvey,
  chatId: number,
  before: SurveyResponseRow | null,
  row: SurveyResponseRow,
  out: FlowOutcome,
  result: SurveyResultRow | null,
): Promise<boolean> {
  if (out.send.includes("fallback")) return false;

  if (out.redraw) {
    await ctx.editMessageReplyMarkup({ reply_markup: redrawKeyboard(survey, row, out.redraw) }).catch(() => {});
  }
  if (out.stripPressed) await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  if (out.stripLast) {
    const pressed = ctx.callbackQuery?.message?.message_id;
    const last = before?.last_msg_id ?? null;
    if (last !== pressed || !out.stripPressed) await stripMessage(ctx, chatId, last);
  }

  let primaryId: number | null = null;
  for (const kind of out.send) {
    const msg =
      kind === "result_repeat" ? repeatResult(survey, row, result) : participantMessage(kind, survey, row, consentUrl());
    if (!msg) continue;
    try {
      const sent = await ctx.reply(msg.text, msg.keyboard ? { reply_markup: msg.keyboard } : undefined);
      if (PRIMARY_KINDS.has(kind)) primaryId = sent.message_id;
    } catch (err) {
      logError(`reply ${kind}`, err);
    }
  }

  if (primaryId !== null) {
    await updateResponse(survey.key, chatId, { last_msg_id: primaryId }).catch((err) => logError("last msg", err));
  }

  if (out.feed) await feed(survey, row, out.feed);

  const justFinished = before?.step !== row.step && END_STEPS.has(row.step);
  if (justFinished && isSurveyTestRun(survey.key, chatId)) {
    await offerSurveyTestVerdict(survey, chatId).catch((err) => logError("test verdict", err));
  }
  return true;
}

/**
 * /start <payload опроса>. true — ответили по опросу; false — пусть bot.ts
 * продолжит обычной веткой /start (опрос закрыт, сказать по нему нечего).
 */
export async function handleSurveyStart(ctx: BotContext, survey: ClubSurvey): Promise<boolean> {
  const chatId = ctx.from?.id;
  if (chatId === undefined) return true;

  try {
    const [existing, result] = await Promise.all([getResponse(survey.key, chatId), currentResult(survey.key)]);
    const fctx = flowContext(ctx, survey, result !== null);
    const first = surveyStep(existing, { type: "start" }, fctx);
    if (first.send.includes("fallback")) return false;

    let row = existing;
    if (first.create) {
      await createResponse(survey.key, chatId, "link");
      row = await getResponse(survey.key, chatId);
      if (!row) throw new Error("row vanished after create");
    }
    if (!row) return false;

    const committed = await commit(survey, chatId, row, { type: "start" }, fctx);
    if (!committed) throw new Error("start not committed");
    return await deliver(ctx, survey, chatId, row, committed.row, committed.out, result);
  } catch (err) {
    // База не ответила: молчать на /start хуже, чем ответить общим текстом.
    logError("start", err);
    return false;
  }
}

/** Кнопка опроса. «Часики» гасим всегда, даже если база упала. */
export async function handleSurveyCallback(ctx: BotContext): Promise<void> {
  let answered = false;
  const answer = async () => {
    if (answered) return;
    answered = true;
    await ctx.answerCallbackQuery().catch(() => {});
  };

  try {
    const parsed = parseSurveyCallback(ctx.callbackQuery?.data ?? "");
    const chatId = ctx.from?.id;
    const survey = parsed ? surveyByKey(parsed.key) : null;
    if (!parsed || !survey || chatId === undefined) return;

    const action = parsed.action;
    if (isAdminAction(action)) {
      answered = true; // «часики» организатора гасит его хендлер — с подписью.
      await handleSurveyAdminCallback(ctx, survey, action);
      return;
    }

    const [row, result] = await Promise.all([getResponse(survey.key, chatId), currentResult(survey.key)]);
    if (!row) return;

    const fctx = flowContext(ctx, survey, result !== null);
    const committed = await commit(survey, chatId, row, { type: "action", action }, fctx);
    await answer();
    if (!committed || committed.out.ignored) return;

    await deliver(ctx, survey, chatId, row, committed.row, committed.out, result);
  } catch (err) {
    logError("callback", err);
  } finally {
    await answer();
  }
}

/**
 * Свободный текст в личке. true — сообщение наше (ввод времени или повтор
 * шага с кнопками), false — пусть отвечает общий обработчик бота.
 */
export async function handleSurveyText(ctx: BotContext): Promise<boolean> {
  const text = ctx.message?.text;
  const chatId = ctx.from?.id;
  if (ctx.chat?.type !== "private" || !text || text.startsWith("/") || chatId === undefined) return false;

  const survey = activeSurvey();
  try {
    const row = await getResponse(survey.key, chatId);
    if (!row || !TEXT_STEPS.has(row.step) || row.blocked_at) return false;

    const result = await currentResult(survey.key);
    const fctx = flowContext(ctx, survey, result !== null);
    const committed = await commit(survey, chatId, row, { type: "text", text }, fctx);
    if (!committed) throw new Error("text not committed");
    return await deliver(ctx, survey, chatId, row, committed.row, committed.out, result);
  } catch (err) {
    logError("text", err);
    return false;
  }
}
