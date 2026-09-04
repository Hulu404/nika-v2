import { dispatchCoffeeRunPoll } from "@/lib/coffeerun/poll-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Запасная ручка рассылки опроса про дождь — то же, что команда /pollsend в
 * боте, но из терминала. Нужна, если бот почему-то не отвечает на команды.
 *
 *   curl -H "x-cron-secret: $CRON_SECRET" \
 *     "https://www.mynika.online/api/cron/coffeerun-poll?dry=1"
 *
 * ?dry=1 — посчитать получателей, ничего не отправляя.
 * ?run=2026-09-06 — конкретный забег вместо ближайшего.
 *
 * Автоматики нет осознанно: спрашивать про дождь решает человек, посмотрев
 * прогноз, поэтому роут никуда не подключён и сам себя не вызывает. Повторный
 * запуск не задваивает вопрос — кого уже спросили, помнит lib/telegram/poll-store.
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
    const result = await dispatchCoffeeRunPoll({
      runDate: url.searchParams.get("run"),
      dryRun: url.searchParams.get("dry") === "1",
    });
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    console.error("[coffeerun-poll] route:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Dispatch failed" }, { status: 500 });
  }
}
