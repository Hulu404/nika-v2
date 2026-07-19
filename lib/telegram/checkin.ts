import { InlineKeyboard } from "grammy";
import { tgAdmin } from "./supabase";
import { canReceiveBotMessages } from "./gate";
import { sendBotMessage } from "./send";
import { pickVariant, checkinKeyboard, ANSWER_CODES } from "./checkin-copy";
import type { BotContext } from "./bot";

export interface SendCheckinResult {
  sent: boolean;
  reason?: "not_opted_in" | "already_open" | "blocked" | "send_failed";
  variant?: string;
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

  // Отправка через единый транспорт (403/429 обрабатываются там).
  const result = await sendBotMessage(chatId, chosen.text, checkinKeyboard(chosen.variant));
  if (!result.ok) {
    return { sent: false, reason: result.blocked ? "blocked" : "send_failed" };
  }

  // Фиксация факта вопроса.
  await admin.from("checkins").insert({
    user_id: userId,
    asked_at: new Date().toISOString(),
    question_variant: chosen.variant,
    answer: null,
    source: "telegram",
  });

  return { sent: true, variant: chosen.variant };
}

/**
 * Минимальная обработка ответа на чек-ин: гасит «часик», пишет answer в
 * последний открытый чек-ин, короткое подтверждение. Полный флоу ответов
 * (благодарность/следующий шаг/эскалация) — Промт 6.
 */
export async function handleCheckinAnswer(ctx: BotContext, code: string): Promise<void> {
  await ctx.answerCallbackQuery();
  const answer = ANSWER_CODES[code];
  const chatId = ctx.from?.id;
  if (!answer || chatId === undefined) return;

  const admin = tgAdmin();
  const { data: binding } = await admin
    .from("tg_bindings")
    .select("user_id")
    .eq("chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();
  if (!binding) return;

  const { data: openRow } = await admin
    .from("checkins")
    .select("id")
    .eq("user_id", (binding as { user_id: string }).user_id)
    .is("answer", null)
    .order("asked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!openRow) return;

  await admin
    .from("checkins")
    .update({ answer, answered_at: new Date().toISOString() })
    .eq("id", (openRow as { id: string }).id);

  await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {});
  await ctx.reply("Спасибо, что заглянула. Я рядом.");
}
