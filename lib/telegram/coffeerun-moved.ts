import { sendBotMessage } from "./send";
import {
  gatherFor,
  movedConfirmKeyboard,
  movedPreviewText,
  movedReportText,
  parseMovedCallback,
  parseTime,
} from "./moved-copy";
import { isAdminChat } from "./poll-store";
import { nextRun, runByDate } from "../coffeerun/run";
import { dispatchCoffeeRunMoved } from "../coffeerun/moved-dispatch";
import type { BotContext } from "./bot";

/**
 * Команда переноса старта: «сегодня бежим не утром, а вечером».
 *
 *   /moved                  — ближайший забег, старт в 18:00
 *   /moved 19:00            — то же время, но другое
 *   /moved 18:00 дождь      — с причиной в тексте
 *   /moved 2026-09-06 18:00 — конкретный забег
 *
 * Всегда в два шага: сначала бот показывает организатору ТОТ САМЫЙ текст,
 * который уйдёт людям, и число получателей, и только по кнопке «Разослать»
 * отправляет. Объявление о переносе нельзя отозвать — опечатка во времени
 * разошлётся по всем, кто записан, поэтому предпросмотр здесь не formality.
 *
 * Время по умолчанию — 18:00: перенос на вечер того же дня и есть типовой
 * сценарий, ради которого команда появилась.
 */

const DEFAULT_START = "18:00";

/** Черновик между командой и нажатием «Разослать»: причина в кнопку не влезает. */
interface MovedDraft {
  runDate: string;
  newStart: string;
  reason: string | null;
}

const DRAFTS = Symbol.for("nika.coffeerun.moved.drafts");

function drafts(): Map<number, MovedDraft> {
  const g = globalThis as unknown as Record<symbol, Map<number, MovedDraft> | undefined>;
  if (!g[DRAFTS]) g[DRAFTS] = new Map();
  return g[DRAFTS];
}

/**
 * Разбор аргументов команды. Порядок свободный в той мере, в какой он
 * однозначен: дата узнаётся по формату, время — по двоеточию или числу,
 * остальное считается причиной.
 */
export function parseMovedArgs(raw: string): {
  runDate: string | null;
  newStart: string;
  reason: string | null;
} {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  let runDate: string | null = null;
  let newStart: string | null = null;
  const rest: string[] = [];

  for (const part of parts) {
    if (!runDate && /^\d{4}-\d{2}-\d{2}$/.test(part)) {
      runDate = part;
      continue;
    }
    if (!newStart) {
      const time = parseTime(part);
      if (time) {
        newStart = time;
        continue;
      }
    }
    rest.push(part);
  }

  return {
    runDate,
    newStart: newStart ?? DEFAULT_START,
    reason: rest.length > 0 ? rest.join(" ") : null,
  };
}

/** /moved — показать предпросмотр объявления и спросить подтверждение. */
export async function handleMovedCommand(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined || !isAdminChat(chatId)) return;

  const { runDate, newStart, reason } = parseMovedArgs((ctx.match ?? "").toString());
  const run = runDate ? runByDate(runDate) : nextRun();
  if (!run) {
    await ctx.reply(`Не знаю забега с датой ${runDate}. Забеги задаются в lib/coffeerun/run.ts.`);
    return;
  }

  const preview = await dispatchCoffeeRunMoved({
    runDate: run.date,
    newStart,
    reason,
    dryRun: true,
  });
  if (!preview.ok) {
    await ctx.reply(`Не получилось: ${preview.error ?? "неизвестная ошибка"}`);
    return;
  }
  if (!preview.wouldSend) {
    await ctx.reply(
      `Некому отправлять: в забеге ${run.spotName}, ${run.dateLabel} подтвердили участие ` +
        `${preview.confirmed ?? 0} чел., и все уже получили перенос на ${newStart}. ` +
        "Другое время — /moved 19:00.",
    );
    return;
  }

  drafts().set(chatId, { runDate: run.date, newStart, reason });

  await ctx.reply(movedPreviewText(run, newStart, reason, preview.wouldSend ?? 0), {
    reply_markup: movedConfirmKeyboard(run.date, newStart),
  });
}

/**
 * Кнопки под предпросмотром. Рассылка идёт в фоне: на полсотни человек это
 * минута, а вебхук столько ждать не должен.
 */
export async function handleMovedCallback(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const parsed = parseMovedCallback(ctx.callbackQuery?.data ?? "");

  if (chatId === undefined || !parsed || !isAdminChat(chatId)) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  // Кнопки убираем в любом случае: решение принято, повторные нажатия ни к чему.
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

  if (parsed.action === "cancel") {
    drafts().delete(chatId);
    await ctx.answerCallbackQuery({ text: "Отменила" }).catch(() => {});
    await ctx.reply("Отменила — никому ничего не отправляла.");
    return;
  }

  // Причину берём из черновика: в callback_data она не влезает. Черновик мог
  // не пережить перезапуск — тогда объявление уйдёт без причины, но с временем,
  // которое зашито в самой кнопке. Это правильный компромисс: время важнее.
  const draft = drafts().get(chatId);
  const reason =
    draft && draft.runDate === parsed.runDate && draft.newStart === parsed.newStart
      ? draft.reason
      : null;
  drafts().delete(chatId);

  await ctx.answerCallbackQuery({ text: "Рассылаю" }).catch(() => {});
  await ctx.reply(
    `Рассылаю перенос на ${parsed.newStart} (сбор в ${gatherFor(parsed.newStart)}). ` +
      "Итог пришлю сюда.",
  );

  void dispatchCoffeeRunMoved({
    runDate: parsed.runDate,
    newStart: parsed.newStart,
    reason,
  })
    .then((res) => sendBotMessage(chatId, movedReportText(res)))
    .catch((err) => {
      console.error("[coffeerun-moved] send:", err instanceof Error ? err.message : err);
      return sendBotMessage(chatId, "Рассылка упала — смотри логи сервера.");
    });
}
