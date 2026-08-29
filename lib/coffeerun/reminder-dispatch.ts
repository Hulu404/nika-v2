import { tgAdmin } from "../telegram/supabase";
import { sendBotMessage } from "../telegram/send";
import { localParts, DEFAULT_TZ } from "../telegram/schedule";
import { reminderText, runKeyboard } from "../telegram/coffeerun";
import { runsDueForReminder, runByDate, REMINDER_HOUR_MSK, type CoffeeRun } from "./run";

/**
 * Рассылка напоминаний за сутки до кофе-рана.
 *
 * Живёт отдельно от HTTP-роута, потому что вызывающих двое: внутренний тикер
 * (instrumentation.ts — «работает сайт = работает бот») и роут
 * /api/cron/coffeerun-reminder для ручного запуска и внешнего планировщика.
 *
 * Кому: подтвердившим участие (confirmed_at + tg_chat_id) в забеге, который
 * стартует ЗАВТРА по Москве. Забег московский, поэтому окно считаем по МСК, а
 * не по таймзоне каждого — в отличие от утреннего нуджа.
 *
 * Забегов на завтра может оказаться несколько (разные споты) — проходим по всем
 * и каждому шлём его текст: адрес и время у Лужников и Усачёвой свои. Выборка
 * идёт по паре (spot, run_date), поэтому заявки соседнего спота в чужую
 * рассылку не попадают, даже если день совпал.
 *
 * Opt-in из tg_bindings здесь НЕ проверяем осознанно: человек сам записался на
 * конкретное событие и сам нажал Start у бота ради него. Это одно сообщение о
 * его же записи, а не рассылка НИКИ. Гейт tg_opt_in — про утренние нуджи, и
 * распространять его сюда значит молча не позвать того, кто ждёт.
 *
 * Идемпотентность — reminder_sent_at. Тикать можно хоть каждые 15 минут: каждый
 * получит ровно одно напоминание.
 */

/** Троттлинг под лимиты Telegram (~30 msg/sec суммарно) — шлём последовательно. */
const THROTTLE_MS = 1100;
/**
 * Порция за проход — суммарно по всем забегам: держим ниже maxDuration=60s
 * роута. Остаток уйдёт следующим тиком.
 */
const MAX_SENDS_PER_TICK = 25;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface DueRow {
  id: string;
  name: string;
  tg_chat_id: number;
}

export interface DispatchOptions {
  /** Только посчитать, ничего не отправляя. */
  dryRun?: boolean;
  /** Забег по точной дате — ручной запуск мимо окна «завтра в 10:00». */
  runDate?: string | null;
  now?: Date;
}

export interface DispatchResult {
  ok: true;
  skipped?: string;
  dryRun?: boolean;
  /** Даты забегов, попавших в этот проход (обычно одна, но спотов может быть несколько). */
  runDates?: string[];
  candidates?: number;
  wouldSend?: number;
  sent?: number;
  blocked?: number;
  failed?: number;
  hasMore?: boolean;
  msk: { date: string; hour: number };
  reminderHourMsk: number;
}

/** Кому ещё не напоминали про этот забег. Ключ забега — спот И дата. */
async function dueRowsFor(run: CoffeeRun, limit: number): Promise<DueRow[]> {
  const { data, error } = await tgAdmin()
    .from("coffee_run_signups")
    .select("id, name, tg_chat_id")
    .eq("spot", run.spot)
    .eq("run_date", run.date)
    .not("confirmed_at", "is", null)
    .not("tg_chat_id", "is", null)
    .is("reminder_sent_at", null)
    .order("confirmed_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[coffeerun-reminder] select:", error.message);
    throw new Error("DB error");
  }

  return (data as DueRow[] | null) ?? [];
}

export async function dispatchCoffeeRunReminders(
  opts: DispatchOptions = {},
): Promise<DispatchResult> {
  const now = opts.now ?? new Date();
  const msk = localParts(DEFAULT_TZ, now);
  const base = { msk: { date: msk.ymd, hour: msk.hour }, reminderHourMsk: REMINDER_HOUR_MSK };

  const runs = opts.runDate
    ? [runByDate(opts.runDate)].filter((r): r is CoffeeRun => r !== null)
    : runsDueForReminder(msk.ymd, msk.hour);

  if (runs.length === 0) {
    return {
      ok: true,
      sent: 0,
      skipped: opts.runDate
        ? `no run with date ${opts.runDate}`
        : "no run tomorrow (or too early today)",
      ...base,
    };
  }

  const admin = tgAdmin();
  const runDates = runs.map((r) => r.date);

  if (opts.dryRun) {
    let wouldSend = 0;
    for (const run of runs) wouldSend += (await dueRowsFor(run, MAX_SENDS_PER_TICK)).length;
    return { ok: true, dryRun: true, runDates, wouldSend, ...base };
  }

  let candidates = 0;
  let sent = 0;
  let blocked = 0;
  let failed = 0;
  let hasMore = false;
  // Бюджет прохода общий на все забеги: 25 отправок по секунде уже упираются в
  // maxDuration роута, и делить его поровну между спотами незачем — остаток
  // заберёт следующий тик.
  let budget = MAX_SENDS_PER_TICK;

  for (const run of runs) {
    if (budget <= 0) {
      hasMore = true;
      break;
    }

    const due = await dueRowsFor(run, budget);
    candidates += due.length;
    if (due.length === budget) hasMore = true;

    const keyboard = runKeyboard(run);

    for (const row of due) {
      const res = await sendBotMessage(row.tg_chat_id, reminderText(row, run), keyboard);
      budget--;

      if (res.ok) sent++;
      else if (res.blocked) blocked++;
      else {
        // Транзиентная ошибка (429 и прочее): НЕ помечаем — заберём следующим проходом.
        failed++;
        continue;
      }

      // Помечаем и доставленных, и заблокировавших бота: второй попытки не будет.
      // Порядок «сначала отправить, потом пометить» выбран сознательно: падение
      // между двумя шагами даёт в худшем случае повтор напоминания, а не тишину.
      // (Оборотная сторона: при нескольких репликах приложения возможен дубль —
      // на Railway реплика одна, при масштабировании понадобится блокировка.)
      const { error: markErr } = await admin
        .from("coffee_run_signups")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", row.id);
      if (markErr) console.error("[coffeerun-reminder] mark:", markErr.message);

      await sleep(THROTTLE_MS);
    }
  }

  return {
    ok: true,
    runDates,
    candidates,
    sent,
    blocked,
    failed,
    hasMore,
    ...base,
  };
}
