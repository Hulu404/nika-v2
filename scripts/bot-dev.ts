import "dotenv/config";
import { getBot } from "../lib/telegram/bot";

/**
 * DEV-режим: локально webhook недоступен без туннеля, поэтому здесь поднимаем
 * ТОТ ЖЕ экземпляр бота через long-polling. В проде polling НЕ стартует —
 * там апдейты приходят в app/api/telegram/webhook.
 *
 * Запуск:  npm run bot:dev
 * Нужны env (в .env корня): TELEGRAM_BOT_TOKEN (или BOT_TOKEN),
 * NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.
 *
 * Внимание: polling и webhook взаимоисключающи. Если на боте уже стоит webhook,
 * grammY сам снимет его при start() (drop_pending_updates по умолчанию false).
 */
const bot = getBot();

console.log("НИКА бот (dev, polling) запускается…");
bot.start({
  onStart: (info) => console.log(`Бот запущен: @${info.username}`),
});
