import { tgAdmin } from "@/lib/telegram/supabase";
import { sendBotMessage } from "@/lib/telegram/send";
import { localParts, DEFAULT_TZ } from "@/lib/telegram/schedule";
import { runDueForReminder, runByDate, REMINDER_HOUR_MSK } from "@/lib/coffeerun/run";
import { reminderText, runKeyboard } from "@/lib/telegram/coffeerun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Напоминание за сутки до кофе-рана.
 *
 * Кому: подтвердившим участие (confirmed_at + tg_chat_id) в забеге, который
 * стартует ЗАВТРА по Москве. Забег московский, поэтому и окно считаем по МСК,
 * а не по таймзоне каждого — в отличие от утреннего нуджа.
 *
 * Opt-in из tg_bindings здесь НЕ проверяем осознанно: человек сам записался на
 * конкретное событие и сам нажал Start у бота ради него. Это одно транзакционное
 * сообщение о его же записи, а не рассылка НИКИ. Гейт tg_opt_in — про утренние
 * нуджи, и распространять его сюда значит молча не позвать того, кто ждёт.
 *
 * Идемпотентность: reminder_sent_at. Тикать можно хоть ежечасно — каждый получит
 * ровно одно напоминание.
 *
 * Запуск (планировщика на Railway пока нет — можно и руками):
 *   curl -H "x-cron-secret: $CRON_SECRET" https://www.mynika.online/api/cron/coffeerun-reminder
 * Расписание, когда заведут крон: ежечасно, `0 * * * *` — окно само отберётся.
 * Проверить без отправки: ?dry=1. Разослать вручную по конкретному забегу,
 * не дожидаясь окна: ?run=2026-08-29.
 */

/** Троттлинг под лимиты Telegram (~30 msg/sec суммарно) — шлём последовательно. */
const THROTTLE_MS = 1100;
/** Порция за тик: держим заметно ниже maxDuration=60s. Остаток уйдёт следующим. */
const MAX_SENDS_PER_TICK = 25;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface DueRow {
  id: string;
  name: string;
  tg_chat_id: number;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const legacyHeader = req.headers.get("x-cron-secret");
  const authorized =
    !!secret && (authHeader === `Bearer ${secret}` || legacyHeader === secret);
  if (!authorized) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  // ?run=YYYY-MM-DD — разослать по конкретному забегу, минуя окно «завтра в 10:00».
  // Ручной запуск и проверка; дедуп по reminder_sent_at продолжает действовать,
  // так что задвоить напоминание этим нельзя.
  const runParam = url.searchParams.get("run");

  const now = new Date();
  const msk = localParts(DEFAULT_TZ, now);
  const run = runParam ? runByDate(runParam) : runDueForReminder(msk.ymd, msk.hour);

  if (!run) {
    return Response.json({
      ok: true,
      sent: 0,
      skipped: runParam
        ? `no run with date ${runParam}`
        : "no run tomorrow (or too early today)",
      msk: { date: msk.ymd, hour: msk.hour },
      reminderHourMsk: REMINDER_HOUR_MSK,
    });
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
    .limit(MAX_SENDS_PER_TICK);

  if (error) {
    console.error("[coffeerun-reminder] select:", error.message);
    return Response.json({ error: "DB error" }, { status: 500 });
  }

  const due = (data as DueRow[] | null) ?? [];

  if (dry) {
    return Response.json({
      ok: true,
      dryRun: true,
      runDate: run.date,
      wouldSend: due.length,
      msk: { date: msk.ymd, hour: msk.hour },
    });
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
      // Транзиентная ошибка (429 и прочее): НЕ помечаем — заберём следующим тиком.
      failed++;
      continue;
    }

    // Помечаем и доставленные, и заблокировавших бота: второй попытки не будет.
    const { error: markErr } = await admin
      .from("coffee_run_signups")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", row.id);
    if (markErr) console.error("[coffeerun-reminder] mark:", markErr.message);

    await sleep(THROTTLE_MS);
  }

  return Response.json({
    ok: true,
    runDate: run.date,
    candidates: due.length,
    sent,
    blocked,
    failed,
    hasMore: due.length === MAX_SENDS_PER_TICK,
  });
}
