import { dispatchCoffeeRunInvites } from "@/lib/coffeerun/invite-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ручной и внешний запуск рассылки приглашений на новый забег.
 *
 * В штатном режиме рассылку заводит внутренний тикер (instrumentation.ts):
 * приложение запущено — приглашения уходят по понедельникам сами, отдельный
 * планировщик не нужен. Этот роут остаётся как ручка: проверить, догнать,
 * разослать вне окна.
 *
 *   curl -H "x-cron-secret: $CRON_SECRET" https://www.mynika.online/api/cron/coffeerun-invite
 *
 * ?dry=1          — посчитать, ничего не отправляя.
 * ?run=2026-09-20 — конкретный забег, минуя окно «понедельник с 10:00 МСК».
 * ?spot=luzhniki  — ближайший забег спота, тоже минуя окно.
 *
 * Дедуп по таблице coffee_run_invites действует всегда: задвоить приглашение
 * нельзя, сколько бы раз роут ни дёрнули.
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
    const result = await dispatchCoffeeRunInvites({
      dryRun: url.searchParams.get("dry") === "1",
      runDate: url.searchParams.get("run"),
      spot: url.searchParams.get("spot"),
    });
    return Response.json(result);
  } catch (err) {
    console.error("[coffeerun-invite] route:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Dispatch failed" }, { status: 500 });
  }
}
