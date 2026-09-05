import { tgAdmin } from "../telegram/supabase";
import { sendBotMessage } from "../telegram/send";
import { movedText, movedKeyboard } from "../telegram/moved-copy";
import { alreadyNotified, markMoved, markNotified } from "../telegram/poll-store";
import { runByDate, type CoffeeRun } from "./run";

/**
 * Рассылка объявления «старт переносится на другое время сегодня».
 *
 * Устроено как рассылка опроса (poll-dispatch) и по тем же причинам: в базу
 * ничего не пишем — из coffee_run_signups только ЧИТАЕМ, кому писать, — а
 * «кому уже ушло» держим в памяти процесса под ключом объявления.
 *
 * Ключ включает дату забега и новое время, поэтому:
 *   • повторная команда с тем же временем никого не побеспокоит дважды;
 *   • если время сдвинули ещё раз (18:00 → 19:00), новое объявление уйдёт всем.
 *
 * Кому: всем, кто подтвердил участие в этом забеге, включая тех, кто в опросе
 * ответил «не побегу». Дождь утром — как раз причина переноса, и человек,
 * отказавшийся от утреннего старта, вечером вполне может прийти.
 */

/** Троттлинг под лимиты Telegram (~30 msg/sec суммарно) — шлём последовательно. */
const THROTTLE_MS = 1100;
/** Порция за проход. Рассылка идёт в фоне, но бесконечной быть не должна. */
const MAX_SENDS = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SignupRow {
  name: string;
  tg_chat_id: number;
}

export interface MovedDispatchOptions {
  /** Забег (YYYY-MM-DD). */
  runDate: string;
  /** Новое время старта, «18:00». */
  newStart: string;
  /** Причина одной строкой («дождь») или null. */
  reason?: string | null;
  /** Только посчитать, ничего не отправляя. */
  dryRun?: boolean;
}

export interface MovedDispatchResult {
  ok: boolean;
  error?: string;
  dryRun?: boolean;
  runDate?: string;
  newStart?: string;
  /** Подтвердивших участие всего в этом забеге. */
  confirmed?: number;
  /** Скольким уйдёт объявление за этот проход. */
  wouldSend?: number;
  sent?: number;
  blocked?: number;
  failed?: number;
  hasMore?: boolean;
}

/** Ключ объявления: дата забега + новое время. */
export function movedKey(runDate: string, newStart: string): string {
  return `moved:${runDate}:${newStart}`;
}

/** Подтвердившие участие в забеге — единственное, что читаем из базы. */
async function confirmedFor(run: CoffeeRun): Promise<SignupRow[]> {
  const { data, error } = await tgAdmin()
    .from("coffee_run_signups")
    .select("name, tg_chat_id")
    .eq("spot", run.spot)
    .eq("run_date", run.date)
    .not("confirmed_at", "is", null)
    .not("tg_chat_id", "is", null)
    .order("confirmed_at", { ascending: true });

  if (error) {
    console.error("[coffeerun-moved] select:", error.message);
    throw new Error("DB error");
  }

  return (data as SignupRow[] | null) ?? [];
}

export async function dispatchCoffeeRunMoved(
  opts: MovedDispatchOptions,
): Promise<MovedDispatchResult> {
  const run = runByDate(opts.runDate);
  if (!run) return { ok: false, error: `нет забега с датой ${opts.runDate}` };

  const key = movedKey(run.date, opts.newStart);
  const base = { runDate: run.date, newStart: opts.newStart };

  const confirmed = await confirmedFor(run);
  const pending = confirmed.filter((r) => !alreadyNotified(key, r.tg_chat_id));
  const due = pending.slice(0, MAX_SENDS);
  const hasMore = pending.length > MAX_SENDS;

  if (opts.dryRun) {
    return { ok: true, dryRun: true, confirmed: confirmed.length, wouldSend: due.length, hasMore, ...base };
  }

  // Запоминаем объявленное время: перекличка (/rollcall) возьмёт его по
  // умолчанию, чтобы не спросить «придёшь в 9:30?» после переноса на 18:00.
  markMoved(run.date, opts.newStart);

  const reason = opts.reason ?? null;
  let sent = 0;
  let blocked = 0;
  let failed = 0;

  for (const row of due) {
    const res = await sendBotMessage(
      row.tg_chat_id,
      movedText(row, run, opts.newStart, reason),
      movedKeyboard(run),
    );

    if (res.ok) sent++;
    else if (res.blocked) blocked++;
    else {
      // Транзиентная ошибка (429 и прочее): НЕ помечаем — заберём следующим запуском.
      failed++;
      continue;
    }

    // Помечаем и доставленных, и заблокировавших бота: второй попытки не будет.
    markNotified(key, row.tg_chat_id);

    await sleep(THROTTLE_MS);
  }

  return { ok: true, confirmed: confirmed.length, sent, blocked, failed, hasMore, ...base };
}
