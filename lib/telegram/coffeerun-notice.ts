import { sendBotMessage } from "./send";
import {
  cancelConfirmKeyboard,
  cancelPreviewText,
  gatherFor,
  movedConfirmKeyboard,
  movedPreviewText,
  noticeReportText,
  parseCancelCallback,
  parseMovedCallback,
  parseTime,
} from "./notice-copy";
import { cancelledAt, isAdminChat } from "./poll-store";
import { nextRun, runByDate } from "../coffeerun/run";
import { dispatchCoffeeRunCancel, dispatchCoffeeRunMoved } from "../coffeerun/notice-dispatch";
import type { BotContext } from "./bot";

/**
 * Объявления по забегу: перенос старта и отмена.
 *
 *   /moved                  — ближайший забег, старт в 18:00
 *   /moved 19:00            — то же время, но другое
 *   /moved 18:00 дождь      — с причиной в тексте
 *   /moved 2026-09-06 18:00 — конкретный забег
 *   /cancel                 — отменить ближайший забег
 *   /cancel гроза           — с причиной
 *   /cancel 2026-09-06      — конкретный забег
 *
 * Обе всегда в два шага: сначала бот показывает организатору ТОТ САМЫЙ текст,
 * который уйдёт людям, и число получателей, и только по кнопке отправляет.
 * Такое объявление нельзя отозвать — опечатка разойдётся по всем, кто записан,
 * поэтому предпросмотр здесь не формальность.
 *
 * Время переноса по умолчанию — 18:00: перенос на вечер того же дня и есть
 * типовой сценарий, ради которого команда появилась.
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

  await ctx.reply(
    cancelledWarning(run.date) + movedPreviewText(run, newStart, reason, preview.wouldSend ?? 0),
    { reply_markup: movedConfirmKeyboard(run.date, newStart) },
  );
}

/**
 * Шапка предпросмотра, если забег уже отменяли. Не запрещаем — организатор
 * вправе передумать и позвать людей заново, — но молча дать разослать «бежим в
 * 19:00» после разосланной отмены нельзя.
 */
export function cancelledWarning(runDate: string): string {
  return cancelledAt(runDate) ? "⚠️ Этому забегу уже разослана ОТМЕНА.\n\n" : "";
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
    .then((res) => sendBotMessage(chatId, noticeReportText(res, "перенос")))
    .catch((err) => {
      console.error("[coffeerun-moved] send:", err instanceof Error ? err.message : err);
      return sendBotMessage(chatId, "Рассылка упала — смотри логи сервера.");
    });
}

/**
 * /cancel [дата] [причина] — отменить забег.
 *
 * Дата узнаётся по формату, остальное считается причиной: «/cancel гроза и
 * ливень» и «/cancel 2026-09-06 гроза» одинаково понятны.
 */
export function parseCancelArgs(raw: string): { runDate: string | null; reason: string | null } {
  let runDate: string | null = null;
  const rest: string[] = [];

  for (const part of raw.trim().split(/\s+/).filter(Boolean)) {
    if (!runDate && /^\d{4}-\d{2}-\d{2}$/.test(part)) {
      runDate = part;
      continue;
    }
    rest.push(part);
  }

  return { runDate, reason: rest.length > 0 ? rest.join(" ") : null };
}

/** /cancel — предпросмотр отмены и подтверждение. */
export async function handleCancelCommand(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined || !isAdminChat(chatId)) return;

  const { runDate, reason } = parseCancelArgs((ctx.match ?? "").toString());
  const run = runDate ? runByDate(runDate) : nextRun();
  if (!run) {
    await ctx.reply(`Не знаю забега с датой ${runDate}. Забеги задаются в lib/coffeerun/run.ts.`);
    return;
  }

  const preview = await dispatchCoffeeRunCancel({ runDate: run.date, reason, dryRun: true });
  if (!preview.ok) {
    await ctx.reply(`Не получилось: ${preview.error ?? "неизвестная ошибка"}`);
    return;
  }
  if (!preview.wouldSend) {
    await ctx.reply(
      `Некому отправлять: в забеге ${run.spotName}, ${run.dateLabel} подтвердили участие ` +
        `${preview.confirmed ?? 0} чел., и все уже получили отмену.`,
    );
    return;
  }

  // Причину держим в том же черновике, что и у переноса: в кнопку она не влезает.
  drafts().set(chatId, { runDate: run.date, newStart: "", reason });

  await ctx.reply(cancelPreviewText(run, reason, preview.wouldSend ?? 0), {
    reply_markup: cancelConfirmKeyboard(run.date),
  });
}

/** Кнопки под предпросмотром отмены. Рассылка идёт в фоне. */
export async function handleCancelCallback(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const parsed = parseCancelCallback(ctx.callbackQuery?.data ?? "");

  if (chatId === undefined || !parsed || !isAdminChat(chatId)) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

  if (parsed.action === "cancel") {
    drafts().delete(chatId);
    await ctx.answerCallbackQuery({ text: "Не отменяю" }).catch(() => {});
    await ctx.reply("Забег в силе — никому ничего не отправляла.");
    return;
  }

  const draft = drafts().get(chatId);
  const reason = draft && draft.runDate === parsed.runDate ? draft.reason : null;
  drafts().delete(chatId);

  await ctx.answerCallbackQuery({ text: "Рассылаю отмену" }).catch(() => {});
  await ctx.reply("Рассылаю отмену. Итог пришлю сюда.");

  void dispatchCoffeeRunCancel({ runDate: parsed.runDate, reason })
    .then((res) => sendBotMessage(chatId, noticeReportText(res, "отмену")))
    .catch((err) => {
      console.error("[coffeerun-cancel] send:", err instanceof Error ? err.message : err);
      return sendBotMessage(chatId, "Рассылка упала — смотри логи сервера.");
    });
}
