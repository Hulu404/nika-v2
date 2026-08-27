import { getBot } from "@/lib/telegram/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ручная установка вебхука Telegram.
 *
 * В штатном режиме дёргать НЕ нужно: вебхук регистрируется сам при старте
 * приложения (instrumentation.ts → ensureWebhook). Роут остаётся диагностикой —
 * переустановить и посмотреть getWebhookInfo, не перезапуская сервер:
 *
 *   curl -H "x-cron-secret: $CRON_SECRET" https://<app>/api/telegram/set-webhook
 *
 * Регистрирует url = ${NEXT_PUBLIC_APP_URL}/api/telegram/webhook, secret_token из
 * TELEGRAM_WEBHOOK_SECRET и allowed_updates = ['message','callback_query'].
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!appUrl || !webhookSecret) {
    return Response.json(
      { error: "NEXT_PUBLIC_APP_URL или TELEGRAM_WEBHOOK_SECRET не заданы" },
      { status: 500 },
    );
  }

  const bot = getBot();
  if (!bot.isInited()) await bot.init();

  await bot.api.setWebhook(`${appUrl.replace(/\/$/, "")}/api/telegram/webhook`, {
    secret_token: webhookSecret,
    allowed_updates: ["message", "callback_query"],
  });

  const info = await bot.api.getWebhookInfo();
  return Response.json({
    ok: true,
    url: info.url,
    pending_update_count: info.pending_update_count,
    last_error_message: info.last_error_message ?? null,
  });
}
