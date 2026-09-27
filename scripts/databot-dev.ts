import { config } from "dotenv";
import { createDatabot } from "../lib/databot/bot";
import { DATABOT_DEFAULT_COMMANDS } from "../lib/databot/copy";
import { isProdWebhook } from "../lib/databot/dev-guard";

// Сначала .env.local (там токен ТЕСТОВОГО бота), потом .env — dotenv не
// перезаписывает уже заданные переменные.
config({ path: ".env.local" });
config();

/**
 * DEV-режим бота данных: тот же бот на long-polling, как scripts/team-bot-dev.ts.
 *
 * Запуск:  npm run databot:dev
 * Нужен DATABOT_TOKEN ТЕСТОВОГО бота. Polling снимает вебхук, поэтому с боевым
 * токеном скрипт не стартует: боевой бот замолчал бы в проде.
 *
 * Отличия от прода:
 *   • нет дедупа через processed_updates — номера апдейтов тестового бота
 *     могут совпасть с боевыми, и боевой апдейт выбросил бы тестовый;
 *   • печатается chat_id каждого апдейта: так узнаётся свой chat_id для
 *     DATABOT_OWNER_IDS (в личке он равен id в Telegram, подходит и боевому).
 */
async function main(): Promise<void> {
  const token = process.env.DATABOT_TOKEN?.trim();
  if (!token) {
    console.error("DATABOT_TOKEN не задан. Положи токен ТЕСТОВОГО бота в .env.local.");
    process.exit(1);
  }

  const bot = createDatabot(token, { logChatIds: true });

  const info = await bot.api.getWebhookInfo();
  if (isProdWebhook(info.url ?? "", process.env.NEXT_PUBLIC_APP_URL)) {
    console.error(
      [
        "Это боевой бот: вебхук стоит на прод.",
        "Polling снимет боевой вебхук, и бот данных замолчит для команды.",
        "Заведи отдельного тестового бота в BotFather и положи его токен в .env.local.",
      ].join("\n"),
    );
    process.exit(1);
  }

  await bot.start({
    onStart: async (me) => {
      console.log(`Бот данных запущен (dev, polling): @${me.username}`);
      console.log("Напиши боту в личку — ниже появится твой chat_id.");
      await bot.api.setMyCommands([...DATABOT_DEFAULT_COMMANDS]).catch(() => {});
    },
  });
}

main().catch((err) => {
  console.error("[databot:dev]", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
