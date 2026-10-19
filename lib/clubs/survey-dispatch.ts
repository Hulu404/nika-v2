import { sendBotMessage } from "../telegram/send";
import { resultMessage, startMessage } from "../telegram/club-survey-copy";
import { alumniChats } from "../coffeerun/broadcast-dispatch";
import { optedOutChats } from "../coffeerun/invite-dispatch";
import type { ClubSurvey } from "./survey-config";
import {
  askedChatIds,
  createResponse,
  markBlocked,
  markResultSent,
  resultRecipients,
  type SurveyResultRow,
} from "./survey-store";
import { resultVariant } from "./survey-slots";

/**
 * Ручные рассылки опроса клуба: стартовое сообщение (/surveysend) и итог
 * (/surveyresult). Обе — по кнопке организатора, в фоне, с троттлингом.
 *
 * Дедуп — в базе, а не в памяти, как у приглашений (invite-dispatch):
 *   старт — строка club_survey_responses появляется ТОЛЬКО после успешной
 *     отправки или 403 (бот заблокирован). Временная ошибка (429 и прочее)
 *     строку не создаёт — человека заберёт «Дослать остальным»;
 *   итог — result_id в строке; меньше действующей версии — пора прислать.
 * Порядок «отправить, потом пометить»: падение между шагами даст повтор, а не тишину.
 *
 * Ошибка базы при сборе списка бросается наверх (как optedOutChats): разослать
 * тем, кто просил не писать, хуже, чем не разослать.
 */

/** Троттлинг под лимиты Telegram — как у остальных рассылок бота. */
export const THROTTLE_MS = 1100;

/**
 * Порция за ручной проход. Рассылка идёт в фоне, вебхук её не ждёт: 200
 * человек — три с половиной минуты. Бегавших сейчас меньше, так что обычно
 * хватает одной порции; остаток — кнопкой «Дослать остальным».
 */
export const MAX_SENDS_MANUAL = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface DispatchOptions {
  dryRun?: boolean;
  limit?: number;
  /** Для тестов: 0 — без пауз. */
  throttleMs?: number;
}

export interface StartAudience {
  due: number[];
  alumni: number;
  optedOut: number;
  alreadyAsked: number;
}

/**
 * Кому уйдёт стартовое сообщение: бегавшие минус отписавшиеся минус уже
 * спрошенные (рассылкой или по ссылке). Чистая функция.
 */
export function surveyStartAudience(
  alumni: readonly number[],
  optedOut: ReadonlySet<number>,
  asked: ReadonlySet<number>,
): StartAudience {
  const unique = [...new Set(alumni)];
  const due: number[] = [];
  let skippedOptedOut = 0;
  let skippedAsked = 0;

  for (const chatId of unique) {
    if (optedOut.has(chatId)) {
      skippedOptedOut++;
      continue;
    }
    if (asked.has(chatId)) {
      skippedAsked++;
      continue;
    }
    due.push(chatId);
  }

  return { due, alumni: unique.length, optedOut: skippedOptedOut, alreadyAsked: skippedAsked };
}

export interface SendCounts {
  sent: number;
  blocked: number;
  failed: number;
  hasMore: boolean;
}

export type StartDispatchResult = Omit<StartAudience, "due"> & { wouldSend: number } & Partial<SendCounts> & {
    hasMore: boolean;
  };

export async function dispatchSurveyStart(
  survey: ClubSurvey,
  opts: DispatchOptions = {},
): Promise<StartDispatchResult> {
  const [alumni, optedOut, asked] = await Promise.all([alumniChats(), optedOutChats(), askedChatIds(survey.key)]);
  const audience = surveyStartAudience(alumni, optedOut, asked);
  const limit = opts.limit ?? MAX_SENDS_MANUAL;
  const due = audience.due.slice(0, limit);
  const base = {
    alumni: audience.alumni,
    optedOut: audience.optedOut,
    alreadyAsked: audience.alreadyAsked,
    wouldSend: due.length,
    hasMore: audience.due.length > limit,
  };
  if (opts.dryRun) return base;

  const msg = startMessage(survey);
  const counts = { sent: 0, blocked: 0, failed: 0 };

  for (const chatId of due) {
    const res = await sendBotMessage(chatId, msg.text, msg.keyboard);
    if (res.ok) {
      counts.sent++;
      await createResponse(survey.key, chatId, "broadcast", { last_msg_id: res.messageId ?? null });
    } else if (res.blocked) {
      counts.blocked++;
      await markBlocked(survey.key, chatId, "broadcast");
    } else {
      counts.failed++;
      continue;
    }
    await sleep(opts.throttleMs ?? THROTTLE_MS);
  }

  return { ...base, ...counts };
}

export interface ResultDispatchResult extends Partial<SendCounts> {
  /** Получат вариант «совпал» (текст 8). */
  match: number;
  /** Получат вариант «не совпал» (текст 9). */
  nomatch: number;
  /** Сколько из получателей уже получали прошлую версию итога. */
  hadPrevious: number;
  hasMore: boolean;
}

/** Итог версии result: всем с согласием, кому эта версия ещё не уходила. */
export async function dispatchSurveyResult(
  survey: ClubSurvey,
  result: SurveyResultRow,
  opts: DispatchOptions = {},
): Promise<ResultDispatchResult> {
  const rows = await resultRecipients(survey.key, result.id);
  const limit = opts.limit ?? MAX_SENDS_MANUAL;
  const due = rows.slice(0, limit).map((row) => ({ row, variant: resultVariant(row, result, survey) }));
  const base = {
    match: due.filter((d) => d.variant === "match").length,
    nomatch: due.filter((d) => d.variant === "nomatch").length,
    hadPrevious: rows.filter((r) => r.result_id !== null).length,
    hasMore: rows.length > limit,
  };
  if (opts.dryRun) return base;

  const counts = { sent: 0, blocked: 0, failed: 0 };
  for (const { row, variant } of due) {
    const msg = resultMessage(survey, result, variant);
    const res = await sendBotMessage(row.chat_id, msg.text, msg.keyboard);
    if (res.ok) {
      counts.sent++;
      await markResultSent(survey.key, row.chat_id, {
        resultId: result.id,
        variant,
        messageId: res.messageId ?? null,
      });
    } else if (res.blocked) {
      counts.blocked++;
      await markBlocked(survey.key, row.chat_id, row.source);
    } else {
      counts.failed++;
      continue;
    }
    await sleep(opts.throttleMs ?? THROTTLE_MS);
  }

  return { ...base, ...counts };
}
