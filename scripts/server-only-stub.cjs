/**
 * Предзагрузка для локальных tsx-скриптов: подменяет пакет "server-only" пустым
 * модулем (test/stubs/empty.ts), как это делает vitest.config.ts.
 *
 * Зачем: lib/telegram/bot.ts через linking → track-server → supabase-server
 * импортирует "server-only". Next подставляет его сам, а под tsx пакета нет,
 * и `npm run bot:dev` падает с «Cannot find module 'server-only'».
 *
 *   npx tsx -r ./scripts/server-only-stub.cjs scripts/bot-dev.ts
 *   npx tsx -r ./scripts/server-only-stub.cjs scripts/club-survey-tick.ts <ISO> [--yes]
 */
const Module = require("module");
const path = require("path");

const STUB = path.join(__dirname, "..", "test", "stubs", "empty.ts");
const resolve = Module._resolveFilename;

Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return STUB;
  return resolve.call(this, request, ...rest);
};
