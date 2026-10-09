import { sendBotMessage } from "./send";
import {
  BROADCAST_ASK_TEXT,
  broadcastConfirmKeyboard,
  broadcastPreviewText,
  broadcastReportText,
  broadcastRetryKeyboard,
  parseBroadcastCallback,
} from "./broadcast-copy";
import { isAdminChat } from "./poll-store";
import { broadcastKey, dispatchBroadcast } from "../coffeerun/broadcast-dispatch";
import type { BotContext } from "./bot";

/**
 * Общее сообщение от организатора всем, кто с нами бегал.
 *
 *   /say            — бот просит прислать сообщение;
 *   следующее сообщение — любое: текст, фото с подписью; бот отвечает на него
 *                     предпросмотром «уйдёт N чел.» с кнопками;
 *   «Разослать»     — копия уходит всем, итог приходит сюда же.
 *
 * Сообщение присылают отдельно, а не хвостом команды: так работает кнопка
 * «Меню» (она шлёт голый /say), и так сохраняются форматирование и картинки —
 * бот копирует сообщение целиком, а не пересобирает текст.
 */

/** Сколько ждём сообщение после /say. Дольше — забытый режим перехватил бы обычную переписку. */
const AWAIT_MS = 30 * 60 * 1000;

const AWAITING = Symbol.for("nika.coffeerun.say.awaiting");

/** Чаты, от которых ждём сообщение для рассылки: chatId → до какого момента ждём. */
function awaiting(): Map<number, number> {
  const g = globalThis as unknown as Record<symbol, Map<number, number> | undefined>;
  if (!g[AWAITING]) g[AWAITING] = new Map();
  return g[AWAITING];
}

const IN_FLIGHT = Symbol.for("nika.coffeerun.say.inflight");

/**
 * Рассылки, которые идут прямо сейчас. Двойной тап по «Разослать» успевает
 * прийти раньше, чем исчезнут кнопки, и две параллельные рассылки задвоили бы
 * сообщение: дедуп помечает получателя только после отправки.
 */
function inFlight(): Set<string> {
  const g = globalThis as unknown as Record<symbol, Set<string> | undefined>;
  if (!g[IN_FLIGHT]) g[IN_FLIGHT] = new Set();
  return g[IN_FLIGHT];
}

/** /say — перейти в режим «жду сообщение». */
export async function handleSayCommand(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined || !isAdminChat(chatId)) return;

  awaiting().set(chatId, Date.now() + AWAIT_MS);
  await ctx.reply(BROADCAST_ASK_TEXT);
}

/**
 * Перехват сообщения после /say. true — сообщение наше, дальше его не пускаем;
 * false — это обычный ввод, пусть отвечает общий обработчик.
 */
export async function handleBroadcastDraft(ctx: BotContext): Promise<boolean> {
  const chatId = ctx.chat?.id;
  const message = ctx.message;
  if (chatId === undefined || !message || !isAdminChat(chatId)) return false;

  const until = awaiting().get(chatId);
  if (until === undefined) return false;
  awaiting().delete(chatId);
  if (until < Date.now()) return false;

  // Незнакомая команда — опечатка, а не сообщение людям.
  if (message.text?.startsWith("/")) {
    await ctx.reply("Это похоже на команду, а не на сообщение. Начни заново — /say.");
    return true;
  }

  let preview;
  try {
    preview = await dispatchBroadcast(
      { fromChatId: chatId, messageId: message.message_id },
      { dryRun: true },
    );
  } catch (err) {
    console.error("[coffeerun-say] preview:", err instanceof Error ? err.message : err);
    await ctx.reply("Не получилось собрать список — база не ответила. Смотри логи сервера.");
    return true;
  }

  if (!preview.wouldSend) {
    await ctx.reply(
      `Некому отправлять: бегали с нами ${preview.alumni ?? 0} чел., ` +
        `просили не писать ${preview.optedOut ?? 0}.`,
    );
    return true;
  }

  await ctx.reply(broadcastPreviewText(preview.wouldSend, { optedOut: preview.optedOut ?? 0 }), {
    reply_parameters: { message_id: message.message_id },
    reply_markup: broadcastConfirmKeyboard(message.message_id),
  });
  return true;
}

/** Кнопки под предпросмотром и «Дослать остальным» под отчётом. Рассылка — в фоне. */
export async function handleBroadcastCallback(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const parsed = parseBroadcastCallback(ctx.callbackQuery?.data ?? "");

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

  const src = { fromChatId: chatId, messageId: parsed.messageId };
  const key = broadcastKey(src);
  if (inFlight().has(key)) {
    await ctx.answerCallbackQuery({ text: "Уже рассылаю" }).catch(() => {});
    return;
  }
  inFlight().add(key);

  await ctx.answerCallbackQuery({ text: "Рассылаю" }).catch(() => {});
  await ctx.reply("Рассылаю. Итог пришлю сюда.");

  void dispatchBroadcast(src)
    .then((res) =>
      sendBotMessage(
        chatId,
        broadcastReportText(res),
        res.failed || res.hasMore ? broadcastRetryKeyboard(src.messageId) : undefined,
      ),
    )
    .catch((err) => {
      console.error("[coffeerun-say] send:", err instanceof Error ? err.message : err);
      return sendBotMessage(chatId, "Рассылка упала — смотри логи сервера.");
    })
    .finally(() => inFlight().delete(key));
}
