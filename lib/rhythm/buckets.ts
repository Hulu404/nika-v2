import type { MoodKey } from "@/types/app";

/**
 * Бакет настроя дня (бриф §6). Детерминированно выводится из отмеченных чипов
 * (и факта пропуска). НЕ фаза цикла и НЕ прогноз — только группировка состояния
 * «сейчас», чтобы подобрать тон реплики.
 */
export type RhythmBucket =
  | "low_energy"
  | "tension"
  | "high_energy"
  | "calm"
  | "mixed"
  | "skip"
  | "neutral";

// Маршрутизация чипов в бакеты (бриф §6).
const LOW = new Set<MoodKey>(["tired", "pain", "insomnia"]);
const TENSION = new Set<MoodKey>(["irritable", "anxious", "sad"]);
const HIGH = new Set<MoodKey>(["energetic", "happy"]);
const CALM = new Set<MoodKey>(["calm", "tenderness"]);
// Телесные модификаторы уточняют тон, сами по себе бакет не образуют.
const BODILY = new Set<MoodKey>(["bloating", "pain", "insomnia", "cravings"]);

/** Человеко-читаемые имена бакетов — для контекста чата (не для экрана). */
export const BUCKET_LABELS: Record<RhythmBucket, string> = {
  low_energy: "низкая энергия",
  tension: "раздражение и тревога",
  high_energy: "высокая энергия",
  calm: "спокойствие",
  mixed: "смешанное (силы и симптомы)",
  skip: "возвращение после паузы",
  neutral: "нейтральное",
};

/**
 * Определяет бакет по отмеченным состояниям.
 * Приоритеты: пропуск → (нет отметок) нейтрально → «высокая энергия + телесное»
 * = смешанное → низкая энергия → раздражение/тревога → высокая энергия →
 * спокойствие. Только телесные модификаторы без базового бакета трактуем как
 * низкую энергию (бережность к симптомам).
 */
export function resolveBucket(
  moods: readonly MoodKey[],
  opts?: { skip?: boolean },
): RhythmBucket {
  if (opts?.skip) return "skip";
  if (moods.length === 0) return "neutral";

  const has = (set: Set<MoodKey>) => moods.some((m) => set.has(m));
  const high = has(HIGH);
  const bodily = has(BODILY);

  if (high && bodily) return "mixed";
  if (has(LOW)) return "low_energy";
  if (has(TENSION)) return "tension";
  if (high) return "high_energy";
  if (has(CALM)) return "calm";
  return "low_energy";
}
