import { tgAdmin } from "../telegram/supabase";
import { sendBotMessage } from "../telegram/send";
import { localParts, DEFAULT_TZ } from "../telegram/schedule";
import { reminderText, runKeyboard } from "../telegram/coffeerun";
import { runDueForReminder, runByDate, REMINDER_HOUR_MSK } from "./run";

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
/** Порция за проход: держим ниже maxDuration=60s роута. Остаток уйдёт следующим. */
const MAX_SENDS_PER_RUN = 25;

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
  runDate?: string;
  candidates?: number;
  wouldSend?: number;
  sent?: number;
  blocked?: number;
  failed?: number;
  hasMore?: boolean;
  msk: { date: string; hour: number };
  reminderHourMsk: number;
}

export async function dispatchCoffeeRunReminders(
  opts: DispatchOptions = {},
): Promise<DispatchResult> {
  const now = opts.now ?? new Date();
  const msk = localParts(DEFAULT_TZ, now);
  const base = { msk: { date: msk.ymd, hour: msk.hour }, reminderHourMsk: REMINDER_HOUR_MSK };

  const run = opts.runDate
    ? runByDate(opts.runDate)
    : runDueForReminder(msk.ymd, msk.hour);

  if (!run) {
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
  const { data, error } = await admin
    .from("coffee_run_signups")
    .select("id, name, tg_chat_id")
    .eq("run_date", run.date)
    .not("confirmed_at", "is", null)
    .not("tg_chat_id", "is", null)
    .is("reminder_sent_at", null)
    .order("confirmed_at", { ascending: true })
    .limit(MAX_SENDS_PER_RUN);

  if (error) {
    console.error("[coffeerun-reminder] select:", error.message);
    throw new Error("DB error");
  }

  const due = (data as DueRow[] | null) ?? [];

  if (opts.dryRun) {
    return { ok: true, dryRun: true, runDate: run.date, wouldSend: due.length, ...base };
  }

  const keyboard = runKeyboard(run);
  let sent = 0;
  let blocked = 0;
  let failed = 0;

  for (const row of due) {
    const res = await sendBotMessage(row.tg_chat_id, reminderText(row, run), keyboard);

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

  return {
    ok: true,
    runDate: run.date,
    candidates: due.length,
    sent,
    blocked,
    failed,
    hasMore: due.length === MAX_SENDS_PER_RUN,
    ...base,
  };
}
