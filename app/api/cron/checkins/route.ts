export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * DEPRECATED (pure-push). Старый крон двустороннего чек-ина снят: он рассылал
 * вопрос с inline-кнопками и заводил открытую строку checkins из Telegram —
 * этого в pure-push нет. Диспетчер `runCheckinDispatch` и `sendCheckin` удалены.
 *
 * Утренний pure-push нудж (одно сообщение + URL-кнопка, слот-инсерт в
 * notifications_log) заводится отдельным кроном в Промте 4 — тогда этот роут
 * будет заменён/переписан. Пока оставлен как no-op заглушка под тем же
 * CRON_SECRET, чтобы существующий планировщик (если поднят) не получал ошибок.
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

  // Ничего не рассылаем: интерактивный чек-ин снят, нудж-крон — Промт 4.
  return Response.json({ retired: true, note: "interactive checkin removed (pure-push); morning nudge cron pending" });
}
