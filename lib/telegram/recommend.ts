import { InlineKeyboard } from "grammy";
import { tgAdmin } from "./supabase";
import { siteKeyboard } from "./cta";
import { getPhase, getCycleDay, getCycleLength, type Phase, type CycleRecord } from "../rhythm/cycles";
import type { CheckinAnswer } from "./checkin-copy";

/**
 * Рекомендация на день по ответу чек-ина (раздел 5.3).
 * КРИТИЧНО: ни фаза, ни слово «цикл» НИКОГДА не попадают в текст. Фаза —
 * только внутренний дефолт, и субъективный ответ всегда приоритетнее.
 */
export type RecoCategory = "rest" | "base" | "more";
export type EnergyHint = "low" | "normal" | "high";

/** Тексты рекомендаций (голос Ники, без тире). Никаких упоминаний цикла. */
export const RECO_TEXT: Record<RecoCategory, string> = {
  rest: "Сегодня можно поберечься. Лёгкая разминка или совсем отдых, без «давай-давай». И это нормально, паузы тоже часть пути.",
  base: "Тогда сегодня по плану, спокойная база. Выйди, как договаривались, и побудь в своём темпе.",
  more: "Раз сил много, можно чуть прибавить. Добавь немного к обычному, если захочется, но без гонки за цифрой.",
};

function answerToCategory(answer: CheckinAnswer): RecoCategory {
  if (answer === "tired" || answer === "bad") return "rest";
  if (answer === "full") return "more";
  return "base"; // ok
}

function phaseToCategory(hint: EnergyHint): RecoCategory {
  if (hint === "low") return "rest";
  if (hint === "high") return "more";
  return "base";
}

/**
 * ПРИОРИТЕТ у субъективного ответа: если ответ есть — он решает, фаза
 * игнорируется (full при «низкой энергии» по фазе → всё равно «можно прибавить»).
 * Фаза применяется как дефолт только когда явного ответа нет.
 * Чистая функция — тестируется.
 */
export function resolveRecommendationCategory(
  answer: CheckinAnswer | null,
  phaseHint: EnergyHint | null,
): RecoCategory {
  if (answer) return answerToCategory(answer);
  return phaseHint ? phaseToCategory(phaseHint) : "base";
}

/** Фаза → ожидаемая энергия (внутренний сигнал, не для показа). */
const PHASE_ENERGY: Record<Phase, EnergyHint> = {
  menses: "low",
  rise: "normal",
  peak: "high",
  slow: "low",
};

/**
 * Внутренняя подсказка энергии по фазе цикла. Только ЧИТАЕТ rhythm_cycles.
 * Возвращает null, если цикл не трекается или данные устарели. Никогда не
 * попадает в текст сообщения.
 */
export async function getPhaseEnergyHint(userId: string): Promise<EnergyHint | null> {
  try {
    const { data } = await tgAdmin()
      .from("rhythm_cycles")
      .select("id, started_at, cycle_length, created_at")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(6);
    const cycles = (data ?? []) as CycleRecord[];
    if (cycles.length === 0) return null; // цикл не трекается
    const len = getCycleLength(cycles);
    const today = new Date().toISOString().slice(0, 10);
    const cycleDay = getCycleDay(cycles[0].started_at, today);
    if (cycleDay < 1 || cycleDay > len + 10) return null; // данные устарели
    return PHASE_ENERGY[getPhase(cycleDay, len)];
  } catch {
    return null;
  }
}

/** Текст рекомендации + опциональная CTA-кнопка на сайт по ответу пользователя. */
export async function recommendForAnswer(
  userId: string,
  answer: CheckinAnswer,
): Promise<{ text: string; keyboard?: InlineKeyboard }> {
  const phaseHint = await getPhaseEnergyHint(userId); // внутренний дефолт
  const category = resolveRecommendationCategory(answer, phaseHint); // ответ приоритетнее
  return { text: RECO_TEXT[category], keyboard: siteKeyboard() };
}
