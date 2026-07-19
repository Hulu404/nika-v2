import { InlineKeyboard } from "grammy";

/**
 * БАНК ВОПРОСОВ утреннего чек-ина. Тексты правит один человек в одном месте.
 *
 * КРИТИЧНО (разделы 3.1 privacy): вопрос НИКОГДА не упоминает цикл, фазу,
 * месячные, ПМС, овуляцию — ни прямо, ни намёком. Спрашиваем нейтрально, как
 * заботливая подруга. Нейтральность важна и для локскрина (текст на
 * заблокированном экране ничего не выдаёт).
 */
export type CheckinAnswer = "full" | "ok" | "tired" | "bad";

export interface CheckinVariant {
  variant: string;
  text: string;
}

export const CHECKIN_VARIANTS: CheckinVariant[] = [
  { variant: "morning_how", text: "Доброе утро 🌸 Как ты сегодня?" },
  { variant: "morning_today", text: "Что сегодня по силам: размяться или разогнаться?" },
  { variant: "morning_sleep", text: "Как спалось, как настрой?" },
  { variant: "morning_energy", text: "Энергия сегодня на сколько из 5?" },
];

/**
 * Стандартные кнопки ответа. callback_data — стабильные коды (не текст!),
 * чтобы правки подписей не ломали обработку.
 */
export const CHECKIN_BUTTONS: { code: string; label: string; answer: CheckinAnswer }[] = [
  { code: "ans_full", label: "💪 полна сил", answer: "full" },
  { code: "ans_ok", label: "🙂 норм", answer: "ok" },
  { code: "ans_tired", label: "😮‍💨 устала", answer: "tired" },
  { code: "ans_bad", label: "🤕 не оч", answer: "bad" },
];

/** Шкала 1–5 для варианта morning_energy — маппится в тот же answer-enum. */
export const SCALE_BUTTONS: { code: string; label: string }[] = [
  { code: "ans_1", label: "1" },
  { code: "ans_2", label: "2" },
  { code: "ans_3", label: "3" },
  { code: "ans_4", label: "4" },
  { code: "ans_5", label: "5" },
];

/** Маппинг шкалы 1–5 → answer (1–2 → bad/tired, 3 → ok, 4–5 → full). */
export const SCALE_TO_ANSWER: Record<string, CheckinAnswer> = {
  ans_1: "bad",
  ans_2: "tired",
  ans_3: "ok",
  ans_4: "full",
  ans_5: "full",
};

/** Единый маппинг любого answer-кода (кнопка или шкала) → enum. */
export const ANSWER_CODES: Record<string, CheckinAnswer> = {
  ...Object.fromEntries(CHECKIN_BUTTONS.map((b) => [b.code, b.answer])),
  ...SCALE_TO_ANSWER,
};

/** Вариант morning_energy показывает шкалу, остальные — 4 стандартные кнопки. */
export function checkinKeyboard(variant: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (variant === "morning_energy") {
    for (const b of SCALE_BUTTONS) kb.text(b.label, b.code);
    return kb; // одна строка 1..5
  }
  kb.text("💪 полна сил", "ans_full").text("🙂 норм", "ans_ok").row();
  kb.text("😮‍💨 устала", "ans_tired").text("🤕 не оч", "ans_bad");
  return kb;
}

/**
 * Ротация: выбирает вариант, не равный прошлому (чтобы не звучать роботом).
 * Чистая функция — легко тестируется.
 */
export function pickVariant(lastVariant?: string): CheckinVariant {
  const pool = lastVariant
    ? CHECKIN_VARIANTS.filter((v) => v.variant !== lastVariant)
    : CHECKIN_VARIANTS;
  const choices = pool.length ? pool : CHECKIN_VARIANTS;
  return choices[Math.floor(Math.random() * choices.length)];
}
