import { getBot } from "./bot";

/**
 * Регистрация вебхука при старте приложения.
 *
 * Раньше это был разовый ручной curl на /api/telegram/set-webhook — и ровно
 * поэтому бот однажды молчал: приложение работало, а вебхук никто не поставил,
 * апдейты копились в очереди Telegram. Теперь связка жёсткая: поднялся сервер —
 * бот на связи.
 *
 * Вызывается идемпотентно из instrumentation.ts. setWebhook дёргаем ВСЕГДА, а не
 * только при расхождении url: секрет мог быть перевыпущен, а по getWebhookInfo
 * этого не видно — Telegram его не отдаёт. Загрузки это не создаёт, вызов один
 * на старт процесса.
 *
 * Из NEXT_PUBLIC_APP_URL берём ТОЛЬКО origin. На проде переменная однажды уже
 * приехала с хвостом «/api/telegram/webhook», путь задвоился, и Telegram получал
 * 404 на каждый апдейт — то есть бот снова молчал, но теперь тихо. Origin от
 * такой ошибки защищает, а сам факт кривой переменной шумим в лог: чинить всё
 * равно надо её (из неё же строятся ссылки на сайт в других местах).
 */
export interface EnsureWebhookResult {
  status: "registered" | "skipped" | "failed";
  detail?: string;
}

export async function ensureWebhook(): Promise<EnsureWebhookResult> {
  const rawAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const token = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN;

  if (!token || !rawAppUrl || !webhookSecret) {
    // Не падаем и не шумим секретами: просто говорим, чего не хватает.
    const missing = [
      !token && "TELEGRAM_BOT_TOKEN",
      !rawAppUrl && "NEXT_PUBLIC_APP_URL",
      !webhookSecret && "TELEGRAM_WEBHOOK_SECRET",
    ].filter(Boolean);
    return { status: "skipped", detail: `env не задан: ${missing.join(", ")}` };
  }

  let origin: string;
  try {
    origin = new URL(rawAppUrl).origin;
  } catch {
    return { status: "failed", detail: `NEXT_PUBLIC_APP_URL не похож на URL: ${rawAppUrl}` };
  }

  if (origin !== rawAppUrl) {
    console.warn(
      `[telegram] NEXT_PUBLIC_APP_URL содержит лишний путь: ${rawAppUrl}. ` +
        `Для вебхука взят origin ${origin}, но переменную надо починить — ` +
        `из неё строятся ссылки на сайт в кнопках бота и письмах.`,
    );
  }

  const target = `${origin}/api/telegram/webhook`;

  try {
    const bot = getBot();
    if (!bot.isInited()) await bot.init();
    await bot.api.setWebhook(target, {
      secret_token: webhookSecret,
      allowed_updates: ["message", "callback_query"],
    });
    return { status: "registered", detail: target };
  } catch (err) {
    return { status: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
