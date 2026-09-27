import type { Context } from "grammy";
import { STRANGER_TEXT } from "./copy";

/**
 * Конвейер апдейта бота данных — единственное место, где решается, что делать
 * с апдейтом. Порядок важен и держится здесь, а не размазан по экранам:
 *
 *   0. бот сам вошёл в группу или канал → выходит, больше ничего;
 *   1. нажатие кнопки гасится сразу, до любых проверок (иначе у человека
 *      крутится индикатор загрузки, пока мы ходим в базу);
 *   2. всё не из лички игнорируется, из группы — ещё и выходим;
 *   3. дальше шаги доступа и отчёта: лимит → членство → разбор запроса →
 *      зона → валидаторы → обработчик → журнал.
 *
 * В каркасе (Промт 1) доступа ещё нет, и каждый в личке — чужой.
 */

/** Статусы, при которых бот числится участником чата. */
const PRESENT_STATUSES = new Set(["member", "administrator", "restricted"]);

export async function runPipeline(ctx: Context): Promise<void> {
  // Шаг 0. Бота добавили в группу, супергруппу или канал — уходим. Выход
  // самого бота приходит сюда же вторым апдейтом (статус left): на него
  // ничего не делаем. Личка тоже приходит сюда (человек заблокировал бота) —
  // и тоже без ответа.
  const membership = ctx.myChatMember;
  if (membership) {
    const { chat, new_chat_member } = membership;
    if (chat.type !== "private" && PRESENT_STATUSES.has(new_chat_member.status)) {
      await leave(ctx, chat.id);
    }
    return;
  }

  // Шаг 1. Индикатор загрузки на кнопке гасим сразу — как lib/team/bot.ts.
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery().catch(() => {});
  }

  // Шаг 2. Только личка. В группу бот не пишет ни слова.
  const chat = ctx.chat;
  if (!chat) return;
  if (chat.type !== "private") {
    if (chat.type === "group" || chat.type === "supergroup") await leave(ctx, chat.id);
    return;
  }

  // Шаг 3. Лимит — Промт 2: check_rate_limit('databot:<chat_id>', 30, 60).
  // Действует и на /start, поэтому стоит до проверки членства.

  // Шаг 4. Членство — Промт 2: одна выборка databot_members по chat_id с
  // is_active = true, без кеша. Пока таблицы нет, каждый — чужой.
  const member = await findMember(chat.id);
  if (!member) {
    await ctx.reply(STRANGER_TEXT);
    return;
  }

  // Шаг 5. Разбор запроса — кнопка, команда или текст → ID отчёта и параметры.
  // Шаг 6. Зона — матрица lib/databot/access.ts, до обращения к базе.
  // Шаг 7. Валидаторы параметров — те же для кнопок и текста.
  // Шаг 8. Обработчик отчёта.
  // Шаг 9. Журнал databot_audit — каждый ответ, в том числе отказ.
}

/**
 * Заглушка до Промта 2. Возвращает null — «такого участника нет».
 */
async function findMember(_chatId: number): Promise<null> {
  return null;
}

async function leave(ctx: Context, chatId: number): Promise<void> {
  // chat_id в прод-логи не пишем: только сам факт и причину сбоя.
  await ctx.api.leaveChat(chatId).catch((err) => {
    console.error("[databot] leaveChat:", err instanceof Error ? err.message : String(err));
  });
}
