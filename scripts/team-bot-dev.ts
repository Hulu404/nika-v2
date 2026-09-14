import "dotenv/config";
import { getTeamBot, TEAM_COMMANDS } from "../lib/team/bot";

/**
 * DEV-режим внутреннего бота команды: локально вебхук недоступен без туннеля,
 * поэтому поднимаем ТОТ ЖЕ экземпляр через long-polling — как scripts/bot-dev.ts
 * делает с основным ботом.
 *
 * Запуск:  npm run team:dev
 * Нужны env (в .env корня): TEAM_BOT_TOKEN, TEAM_BOT_SECRET,
 * NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *
 * Внимание: polling и вебхук взаимоисключающи. Если на боте стоит вебхук
 * (а на проде он стоит), grammY снимет его при start() — то есть прод-бот
 * замолчит, пока этот процесс жив. Для локальной работы заводи ОТДЕЛЬНОГО
 * тестового бота в BotFather, а не тот же токен, что в проде.
 */
const bot = getTeamBot();

bot.start({
  onStart: async (info) => {
    console.log(`Командный бот запущен (dev, polling): @${info.username}`);
    await bot.api.setMyCommands(TEAM_COMMANDS).catch(() => {});
  },
});
