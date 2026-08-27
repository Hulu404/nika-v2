import { getBot } from "@/lib/telegram/bot";
import { ensureWebhook } from "@/lib/telegram/ensure-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ручная переустановка вебхука Telegram + диагностика.
 *
 * В штатном режиме дёргать НЕ нужно: вебхук регистрируется сам при старте
 * приложения (instrumentation.ts → ensureWebhook). Роут остаётся ручкой —
 * переустановить и посмотреть getWebhookInfo, не перезапуская сервер:
 *
 *   curl -H "x-cron-secret: $CRON_SECRET" https://<app>/api/telegram/set-webhook
 *
 * Саму регистрацию делает ensureWebhook — ОДНА реализация на оба входа. Раньше
 * URL собирался здесь отдельно, теми же двумя строками, и это была ровно та
 * дырка, через которую в прод уехал задвоенный путь.
 * Доступ закрыт CRON_SECRET (как у крон-эндпоинтов).
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

  const result = await ensureWebhook();
  if (result.status !== "registered") {
    return Response.json({ ok: false, ...result }, { status: 500 });
  }

  const bot = getBot();
  if (!bot.isInited()) await bot.init();
  const info = await bot.api.getWebhookInfo();

  return Response.json({
    ok: true,
    url: info.url,
    pending_update_count: info.pending_update_count,
    last_error_message: info.last_error_message ?? null,
  });
}
