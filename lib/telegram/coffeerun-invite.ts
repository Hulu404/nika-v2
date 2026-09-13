import { sendBotMessage } from "./send";
import {
  inviteConfirmKeyboard,
  invitePreviewText,
  inviteReportText,
  parseInviteCallback,
} from "./invite-copy";
import { isAdminChat } from "./poll-store";
import { COFFEE_RUNS, nextRun, runBySpot, runByDate, type CoffeeRun } from "../coffeerun/run";
import {
  dispatchCoffeeRunInvites,
  MAX_SENDS_MANUAL,
} from "../coffeerun/invite-dispatch";
import type { BotContext } from "./bot";

/**
 * Приглашение на новый забег, ручной запуск.
 *
 *   /open                 — ближайший забег (любого спота)
 *   /open luzhniki        — ближайший забег этого спота
 *   /open 2026-09-20      — конкретный забег по дате
 *
 * В штатном режиме приглашения уходят сами, по понедельникам с 10:00 МСК
 * (тикер в instrumentation.ts). Команда нужна там, где расписание не годится:
 * забег объявили в среду, зовём сразу; понедельник проспали; хочется сначала
 * посмотреть, кому вообще уйдёт.
 *
 * Как /moved и /cancel — в два шага, с предпросмотром. Здесь это даже важнее:
 * приглашение уходит людям, которые на него не подписывались, и отозвать его
 * нельзя.
 */

/** Слаги спотов из COFFEE_RUNS — по ним узнаём аргумент команды. */
function knownSpots(): string[] {
  return [...new Set(COFFEE_RUNS.map((r) => r.spot))];
}

/**
 * Разбор аргумента: дата узнаётся по формату, известный слаг спота — по
 * справочнику, всё остальное игнорируем. Пустой аргумент — ближайший забег.
 */
export function parseOpenArgs(
  raw: string,
  spots: string[] = knownSpots(),
): { runDate: string | null; spot: string | null } {
  let runDate: string | null = null;
  let spot: string | null = null;

  for (const part of raw.trim().split(/\s+/).filter(Boolean)) {
    if (!runDate && /^\d{4}-\d{2}-\d{2}$/.test(part)) {
      runDate = part;
      continue;
    }
    const slug = part.toLowerCase();
    if (!spot && spots.includes(slug)) spot = slug;
  }

  return { runDate, spot };
}

/** Забег, на который зовём: дата приоритетнее спота, иначе ближайший. */
function resolveRun(runDate: string | null, spot: string | null): CoffeeRun | null {
  if (runDate) return runByDate(runDate);
  if (spot) return runBySpot(spot);
  return nextRun();
}

/** /open — показать предпросмотр приглашения и спросить подтверждение. */
export async function handleOpenCommand(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined || !isAdminChat(chatId)) return;

  const { runDate, spot } = parseOpenArgs((ctx.match ?? "").toString());
  const run = resolveRun(runDate, spot);

  if (!run) {
    await ctx.reply(
      (runDate ? `Не знаю забега с датой ${runDate}.` : `Не знаю спота ${spot}.`) +
        ` Забеги задаются в lib/coffeerun/run.ts. Известные споты: ${knownSpots().join(", ")}.`,
    );
    return;
  }

  // Выборка ходит в базу, и падение здесь молча улетело бы в bot.catch: команда
  // просто не ответила бы. Самый вероятный случай — не применена миграция 034
  // (нет таблицы coffee_run_invites), и об этом организатор должен узнать.
  let preview;
  try {
    preview = await dispatchCoffeeRunInvites({
      runDate: run.date,
      dryRun: true,
      limit: MAX_SENDS_MANUAL,
    });
  } catch (err) {
    console.error("[coffeerun-invite] preview:", err instanceof Error ? err.message : err);
    await ctx.reply(
      "Не получилось собрать список — база не ответила. Проверь, применена ли миграция " +
        "034_coffee_run_invites.sql, и смотри логи сервера.",
    );
    return;
  }

  if (!preview.ok) {
    await ctx.reply(`Не получилось: ${preview.error ?? "неизвестная ошибка"}`);
    return;
  }

  if (!preview.wouldSend) {
    await ctx.reply(
      `Некому отправлять: на споте ${run.spotName} бегали ${preview.alumni ?? 0} чел., ` +
        `и все они уже либо приглашены на ${run.dateLabel} (${preview.alreadyInvited ?? 0}), ` +
        `либо записаны (${preview.registered ?? 0}), либо просили не писать (${preview.optedOut ?? 0}).`,
    );
    return;
  }

  await ctx.reply(
    invitePreviewText(run, preview.wouldSend ?? 0, {
      alreadyInvited: preview.alreadyInvited ?? 0,
      optedOut: preview.optedOut ?? 0,
      registered: preview.registered ?? 0,
    }),
    { reply_markup: inviteConfirmKeyboard(run.spot, run.date) },
  );
}

/**
 * Кнопки под предпросмотром. Рассылка идёт в фоне: на полсотни человек это
 * минута, а вебхук столько ждать не должен.
 *
 * Всё, что нужно рассылке, вшито в callback_data (спот и дата), поэтому
 * черновик в памяти здесь не нужен — в отличие от /moved, где в кнопку не
 * влезала свободная причина.
 */
export async function handleOpenCallback(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const parsed = parseInviteCallback(ctx.callbackQuery?.data ?? "");

  if (chatId === undefined || !parsed || !isAdminChat(chatId)) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  // Кнопки убираем в любом случае: решение принято, повторные нажатия ни к чему.
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

  if (parsed.action === "cancel") {
    await ctx.answerCallbackQuery({ text: "Отменила" }).catch(() => {});
    await ctx.reply("Отменила — никому ничего не отправляла.");
    return;
  }

  await ctx.answerCallbackQuery({ text: "Рассылаю" }).catch(() => {});
  await ctx.reply("Рассылаю приглашение. Итог пришлю сюда.");

  void dispatchCoffeeRunInvites({ runDate: parsed.runDate, limit: MAX_SENDS_MANUAL })
    .then((res) => sendBotMessage(chatId, inviteReportText(res)))
    .catch((err) => {
      console.error("[coffeerun-invite] send:", err instanceof Error ? err.message : err);
      return sendBotMessage(chatId, "Рассылка упала — смотри логи сервера.");
    });
}
