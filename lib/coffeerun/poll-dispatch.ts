import { tgAdmin } from "../telegram/supabase";
import { sendBotMessage } from "../telegram/send";
import { pollText, pollKeyboard } from "../telegram/poll-copy";
import { alreadyAsked, markSent, pollRunDate, startPoll } from "../telegram/poll-store";
import { nextRun, runByDate, type CoffeeRun } from "./run";

/**
 * Рассылка опроса «завтра дождь — побежишь?».
 *
 * Отличие от напоминания за сутки принципиальное: напоминание уходит само по
 * расписанию, а опрос — РУЧНОЕ решение организатора. Дождь не в календаре, и
 * автоматики здесь быть не должно, поэтому модуль не подключён к тикеру
 * instrumentation.ts: рассылку заводит команда /pollsend в боте (или роут
 * /api/cron/coffeerun-poll с секретом).
 *
 * В базу опрос НЕ пишет ничего: из coffee_run_signups мы только ЧИТАЕМ, кому
 * писать. Кого уже спросили и кто как ответил — в lib/telegram/poll-store.ts
 * (память процесса), а настоящий архив ответов — лента в личке
 * организатора, куда бот пересылает каждый ответ сразу.
 *
 * Кому: подтвердившим участие (confirmed_at + tg_chat_id) в этом забеге. Гейт
 * tg_opt_in не применяем по той же причине, что и в reminder-dispatch: это
 * сообщение про его собственную запись, а не рассылка НИКИ.
 */

/** Троттлинг под лимиты Telegram (~30 msg/sec суммарно) — шлём последовательно. */
const THROTTLE_MS = 1100;
/**
 * Порция за проход по умолчанию: держим ниже maxDuration=60s HTTP-роута.
 * Команда /pollsend в боте рассылает в фоне и передаёт лимит побольше — там
 * ждать ответа некому.
 */
const MAX_SENDS_PER_TICK = 25;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SignupRow {
  id: string;
  name: string;
  tg_username: string | null;
  tg_chat_id: number;
}

export interface PollDispatchOptions {
  /** Забег, участников которого спрашиваем (YYYY-MM-DD). По умолчанию — ближайший. */
  runDate?: string | null;
  /** Только посчитать, ничего не отправляя. */
  dryRun?: boolean;
  /** Сколько сообщений максимум за этот проход (по умолчанию 25). */
  limit?: number;
}

export interface PollDispatchResult {
  ok: boolean;
  error?: string;
  dryRun?: boolean;
  runDate?: string;
  spot?: string;
  /** Подтвердивших участие всего в этом забеге. */
  confirmed?: number;
  /** Кого ещё не спрашивали — столько уйдёт за этот проход (не больше limit). */
  wouldSend?: number;
  sent?: number;
  blocked?: number;
  failed?: number;
  /** Остались неспрошенные — запустить ещё раз. */
  hasMore?: boolean;
}

/** Подтвердившие участие в забеге — единственное, что читаем из базы. */
async function confirmedFor(run: CoffeeRun): Promise<SignupRow[]> {
  const { data, error } = await tgAdmin()
    .from("coffee_run_signups")
    .select("id, name, tg_username, tg_chat_id")
    .eq("spot", run.spot)
    .eq("run_date", run.date)
    .not("confirmed_at", "is", null)
    .not("tg_chat_id", "is", null)
    .order("confirmed_at", { ascending: true });

  if (error) {
    console.error("[coffeerun-poll] select:", error.message);
    throw new Error("DB error");
  }

  return (data as SignupRow[] | null) ?? [];
}

export async function dispatchCoffeeRunPoll(
  opts: PollDispatchOptions = {},
): Promise<PollDispatchResult> {
  // Незнакомая дата — опечатка организатора, а не повод разослать «что-то
  // похожее»: без забега в COFFEE_RUNS у нас нет ни спота, ни текста.
  const run = opts.runDate ? runByDate(opts.runDate) : nextRun();
  if (!run) return { ok: false, error: `нет забега с датой ${opts.runDate}` };

  const base = { runDate: run.date, spot: run.spot };

  // Первый запуск по этому забегу — начинаем опрос заново: сводка не должна
  // складывать субботние ответы с воскресными.
  if (!opts.dryRun && pollRunDate() !== run.date) startPoll(run.date);

  const limit = opts.limit ?? MAX_SENDS_PER_TICK;
  const confirmed = await confirmedFor(run);
  const pending = confirmed.filter((r) => !alreadyAsked(r.tg_chat_id));
  const due = pending.slice(0, limit);
  const hasMore = pending.length > limit;

  if (opts.dryRun) {
    return {
      ok: true,
      dryRun: true,
      confirmed: confirmed.length,
      wouldSend: due.length,
      hasMore,
      ...base,
    };
  }

  let sent = 0;
  let blocked = 0;
  let failed = 0;

  for (const row of due) {
    const res = await sendBotMessage(row.tg_chat_id, pollText(row, run), pollKeyboard(run.date));

    if (res.ok) sent++;
    else if (res.blocked) blocked++;
    else {
      // Транзиентная ошибка (429 и прочее): НЕ помечаем — заберём следующим запуском.
      failed++;
      continue;
    }

    // Помечаем и доставленных, и заблокировавших бота: второй попытки не будет.
    markSent({ chatId: row.tg_chat_id, name: row.name, username: row.tg_username });

    await sleep(THROTTLE_MS);
  }

  return { ok: true, confirmed: confirmed.length, sent, blocked, failed, hasMore, ...base };
}
