import { sendBotMessage } from "../telegram/send";
import { TEXT, reminderMessage } from "../telegram/club-survey-copy";
import { MAX_SENDS_PER_TICK } from "../coffeerun/invite-dispatch";
import { CLUB_SURVEYS, type ClubSurvey } from "./survey-config";
import { THROTTLE_MS } from "./survey-dispatch";
import { evePassOpen, reminderDueForRow, reminderPass } from "./survey-schedule";
import {
  currentResult,
  dueForEve,
  dueForReminder,
  markBlocked,
  markEveSent,
  markReminded,
  type SurveyResponseRow,
} from "./survey-store";

/**
 * Опрос клуба пишет сам — тикер instrumentation.ts, каждые 15 минут и сразу
 * на старте процесса (то есть на каждом деплое). Поэтому дедуп только в базе:
 *   reminded_at   — напоминание незавершившим, одно на человека;
 *   eve_result_id — напоминание накануне по действующей версии итога.
 * Окна по МСК — survey-schedule.ts.
 *
 * Порция за проход общая на оба напоминания и все опросы — MAX_SENDS_PER_TICK,
 * как у приглашений: остаток заберёт следующий тик.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TickResult {
  reminded: number;
  eve: number;
  blocked: number;
  failed: number;
}

export interface TickOptions {
  now?: Date;
  limit?: number;
  /** Для тестов: 0 — без пауз. */
  throttleMs?: number;
}

type Sender = (row: SurveyResponseRow) => Promise<"sent" | "blocked" | "failed">;

/** Разослать порции, отметки — после отправки. Возвращает, сколько бюджета потрачено. */
async function sendAll(
  rows: SurveyResponseRow[],
  send: Sender,
  totals: TickResult,
  field: "reminded" | "eve",
  throttleMs: number,
): Promise<number> {
  let used = 0;
  for (const row of rows) {
    const res = await send(row);
    used++;
    if (res === "failed") {
      totals.failed++;
      continue;
    }
    if (res === "blocked") totals.blocked++;
    else totals[field]++;
    await sleep(throttleMs);
  }
  return used;
}

async function tickSurvey(survey: ClubSurvey, now: Date, budget: number, totals: TickResult, throttleMs: number) {
  const result = await currentResult(survey.key);
  let left = budget;

  // Напоминание незавершившим — только пока итога нет.
  const pass = reminderPass(survey, now);
  if (!result && pass.open && left > 0) {
    const rows = (await dueForReminder(survey.key, pass.askedBefore, left)).filter((r) =>
      reminderDueForRow(r, survey, now),
    );
    const msg = reminderMessage(survey);
    left -= await sendAll(
      rows,
      async (row) => {
        const res = await sendBotMessage(row.chat_id, msg.text, msg.keyboard);
        if (res.ok) await markReminded(survey.key, row.chat_id);
        else if (res.blocked) await markBlocked(survey.key, row.chat_id, row.source);
        return res.ok ? "sent" : res.blocked ? "blocked" : "failed";
      },
      totals,
      "reminded",
      throttleMs,
    );
  }

  // Напоминание накануне — тем, кто ответил «Буду»/«Приду» на действующий итог.
  if (result && evePassOpen(survey, result, now) && left > 0) {
    const rows = await dueForEve(survey.key, result.id, left);
    const text = TEXT.eve(result);
    left -= await sendAll(
      rows,
      async (row) => {
        const res = await sendBotMessage(row.chat_id, text);
        if (res.ok) await markEveSent(survey.key, row.chat_id, result.id);
        else if (res.blocked) await markBlocked(survey.key, row.chat_id, row.source);
        return res.ok ? "sent" : res.blocked ? "blocked" : "failed";
      },
      totals,
      "eve",
      throttleMs,
    );
  }

  return left;
}

/** Один проход тикера по всем опросам. Ошибка базы — наверх, тикер её залогирует. */
export async function tickClubSurveys(opts: TickOptions = {}): Promise<TickResult> {
  const now = opts.now ?? new Date();
  const totals: TickResult = { reminded: 0, eve: 0, blocked: 0, failed: 0 };
  let budget = opts.limit ?? MAX_SENDS_PER_TICK;

  for (const survey of CLUB_SURVEYS) {
    if (budget <= 0) break;
    budget = await tickSurvey(survey, now, budget, totals, opts.throttleMs ?? THROTTLE_MS);
  }
  return totals;
}
