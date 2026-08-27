import { dispatchCoffeeRunReminders } from "@/lib/coffeerun/reminder-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ручной и внешний запуск рассылки напоминаний за сутки до кофе-рана.
 *
 * В штатном режиме рассылку заводит внутренний тикер (instrumentation.ts):
 * приложение запущено — напоминания уходят сами, отдельный планировщик не нужен.
 * Этот роут остаётся как ручка: проверить, догнать, разослать вне окна.
 *
 *   curl -H "x-cron-secret: $CRON_SECRET" https://www.mynika.online/api/cron/coffeerun-reminder
 *
 * ?dry=1 — посчитать, ничего не отправляя.
 * ?run=2026-08-29 — конкретный забег, минуя окно «завтра в 10:00 МСК».
 * Дедуп по reminder_sent_at действует всегда: задвоить напоминание нельзя.
 */
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

  try {
    const result = await dispatchCoffeeRunReminders({
      dryRun: url.searchParams.get("dry") === "1",
      runDate: url.searchParams.get("run"),
    });
    return Response.json(result);
  } catch (err) {
    console.error("[coffeerun-reminder] route:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Dispatch failed" }, { status: 500 });
  }
}
