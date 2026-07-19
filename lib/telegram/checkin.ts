import { InlineKeyboard } from "grammy";
import { tgAdmin } from "./supabase";
import { canReceiveBotMessages } from "./gate";
import { sendBotMessage } from "./send";
import { pickVariant, checkinKeyboard, ANSWER_CODES } from "./checkin-copy";
import { recommendForAnswer } from "./recommend";
import { trackServer } from "../track-server";
import type { BotContext } from "./bot";

export interface SendCheckinResult {
  sent: boolean;
  reason?: "not_opted_in" | "already_open" | "blocked" | "send_failed";
  variant?: string;
  retryAfter?: number; // секунды из 429 Telegram, если был rate limit
}

/** Начало текущего дня в UTC (грубый дедуп «за сегодня»; TZ-режим — Промт 9). */
function startOfTodayIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Отправляет утренний деликатный чек-ин пользователю.
 * Гейт (is_active && tg_opt_in), дедуп (один открытый чек-ин в день), ротация
 * варианта (не повторять прошлый), запись факта вопроса в checkins.
 */
export async function sendCheckin(userId: string): Promise<SendCheckinResult> {
  const admin = tgAdmin();

  // Гейт: активная связка + согласие.
  const { data: binding } = await admin
    .from("tg_bindings")
    .select("chat_id, is_active, tg_opt_in")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (!canReceiveBotMessages(binding)) return { sent: false, reason: "not_opted_in" };
  const chatId = Number((binding as { chat_id: number | string }).chat_id);

  // Дедуп: уже есть открытый (без ответа) чек-ин за сегодня → не шлём.
  const { data: open } = await admin
    .from("checkins")
    .select("id")
    .eq("user_id", userId)
    .is("answer", null)
    .gte("asked_at", startOfTodayIso())
    .limit(1)
    .maybeSingle();
  if (open) return { sent: false, reason: "already_open" };

  // Ротация: не повторять прошлый вариант.
  const { data: last } = await admin
    .from("checkins")
    .select("question_variant")
    .eq("user_id", userId)
    .order("asked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const chosen = pickVariant((last as { question_variant?: string } | null)?.question_variant ?? undefined);

  // Тихий режим: короче/без эмодзи (безлико на локскрине).
  const { data: prefs } = await admin
    .from("notification_prefs")
    .select("quiet_mode")
    .eq("user_id", userId)
    .maybeSingle();
  const quiet = (prefs as { quiet_mode?: boolean } | null)?.quiet_mode === true;
  const text = quiet ? chosen.quietText : chosen.text;

  // Отправка через единый транспорт (403/429 обрабатываются там).
  const result = await sendBotMessage(chatId, text, checkinKeyboard(chosen.variant, quiet));
  if (!result.ok) {
    return {
      sent: false,
      reason: result.blocked ? "blocked" : "send_failed",
      retryAfter: result.retryAfter,
    };
  }

  // Фиксация факта вопроса.
  await admin.from("checkins").insert({
    user_id: userId,
    asked_at: new Date().toISOString(),
    question_variant: chosen.variant,
    answer: null,
    source: "telegram",
  });

  trackServer(userId, "checkin_sent");
  return { sent: true, variant: chosen.variant };
}

/**
 * Обработка ответа на чек-ин (раздел 5.3): фиксирует answer + answered_at и
 * присылает рекомендацию на день. Идемпотентно: один ответ = одна рекомендация,
 * повторный/устаревший тап рекомендацию не плодит.
 */
export async function handleCheckinAnswer(ctx: BotContext, code: string): Promise<void> {
  await ctx.answerCallbackQuery(); // гасим «часик» всегда
  const answer = ANSWER_CODES[code];
  const chatId = ctx.from?.id;
  if (!answer || chatId === undefined) return;

  const admin = tgAdmin();

  // chat_id → user_id (активная связка).
  const { data: binding } = await admin
    .from("tg_bindings")
    .select("user_id")
    .eq("chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();
  if (!binding) return;
  const userId = (binding as { user_id: string }).user_id;

  // Последний ОТКРЫТЫЙ чек-ин ЗА СЕГОДНЯ (устаревшие/вчерашние не берём).
  const { data: openRow } = await admin
    .from("checkins")
    .select("id")
    .eq("user_id", userId)
    .is("answer", null)
    .gte("asked_at", startOfTodayIso())
    .order("asked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Убираем кнопки в любом случае — нельзя ответить дважды.
  await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {});

  // Нет открытого чек-ина (уже отвечен / устарел / не найден) → тихо игнор,
  // повторную рекомендацию не шлём.
  if (!openRow) return;

  // Идемпотентная запись: обновляем ТОЛЬКО пока answer IS NULL. При гонке/двойном
  // тапе второй апдейт совпадёт с 0 строк → второй рекомендации не будет.
  const { data: updated } = await admin
    .from("checkins")
    .update({ answer, answered_at: new Date().toISOString() })
    .eq("id", (openRow as { id: string }).id)
    .is("answer", null)
    .select("id");
  if (!updated || updated.length === 0) return;

  trackServer(userId, "checkin_answered", { answer });

  // Рекомендация на день (ответ приоритетнее фазы; фаза в текст не попадает).
  const { text, keyboard } = await recommendForAnswer(userId, answer);
  await ctx.reply(text, keyboard ? { reply_markup: keyboard } : undefined);
}
