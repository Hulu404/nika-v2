import { runCheckinDispatch } from "@/lib/telegram/checkin-cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Крон утренних чек-инов (раздел 9 ТЗ). Запускается ЧАСТО (ежечасно) — «утро»
 * определяется по локальной таймзоне каждого пользователя внутри диспетчера.
 * Защищён CRON_SECRET (как пуш-крон): Authorization: Bearer <secret> или
 * x-cron-secret для ручного вызова.
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

  const result = await runCheckinDispatch();
  return Response.json(result);
}
