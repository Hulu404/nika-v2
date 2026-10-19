import "dotenv/config";
import { CLUB_SURVEYS } from "../lib/clubs/survey-config";
import { evePassOpen, reminderPass } from "../lib/clubs/survey-schedule";
import { currentResult } from "../lib/clubs/survey-store";
import { tickClubSurveys } from "../lib/clubs/survey-reminders";

/**
 * Один проход тикера опроса клуба с подменённым «сейчас» — проверить оба
 * напоминания на ТЕСТОВОМ боте, не дожидаясь суток. Сценарий: docs/club-survey.md,
 * раздел «Ручная проверка».
 *
 *   npx tsx -r ./scripts/server-only-stub.cjs scripts/club-survey-tick.ts 2026-10-21T12:00:00+03:00        — только окна
 *   npx tsx -r ./scripts/server-only-stub.cjs scripts/club-survey-tick.ts 2026-10-21T12:00:00+03:00 --yes  — и разослать
 *
 * ВНИМАНИЕ: шлёт всем подходящим строкам базы из .env, токеном из .env.
 * Запускать только с тестовым ботом и тестовой базой.
 */

async function main(): Promise<void> {
  const [iso, flag] = process.argv.slice(2);
  const now = iso ? new Date(iso) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error(`не дата: ${iso}`);

  for (const survey of CLUB_SURVEYS) {
    const pass = reminderPass(survey, now);
    const result = await currentResult(survey.key);
    console.log(
      `[${survey.key}] сейчас ${now.toISOString()}: напоминание незавершившим — ` +
        (pass.open ? `окно открыто, asked_at <= ${pass.askedBefore.toISOString()}` : pass.reason) +
        (result ? "; итог разослан, напоминаний незавершившим не будет" : "") +
        `; накануне — ${evePassOpen(survey, result, now) ? "окно открыто" : "закрыто"}`,
    );
  }

  if (flag !== "--yes") {
    console.log("Ничего не отправляла. Чтобы разослать — добавь --yes.");
    return;
  }
  console.log(await tickClubSurveys({ now }));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  // exitCode, а не exit(): на Windows резкий exit с открытыми сокетами роняет libuv.
  process.exitCode = 1;
});
