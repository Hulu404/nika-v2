import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type Phase = "menses" | "rise" | "peak" | "slow";

export interface CycleRecord {
  id: string;
  started_at: string; // YYYY-MM-DD
  cycle_length: number | null;
  created_at: string;
}

export interface AdviceRecord {
  advice_short: string;
  advice_full: string;
}

export interface CheckinRecord {
  tags: string[];
  note: string | null;
}

// ── Расчёт фазы ───────────────────────────────────────────────────────────────

/** Фаза по дню цикла. Пик = за 14 дней до конца. */
export function getPhase(cycleDay: number, len: number): Phase {
  const peakDay = len - 14;
  if (cycleDay <= 5) return "menses";
  if (cycleDay < peakDay) return "rise";
  if (cycleDay <= peakDay + 1) return "peak";
  return "slow";
}

/** Средняя длина цикла по последним ≤3 фактическим; иначе значение из
 *  онбординга (первая запись с cycle_length) или 28 по умолчанию. */
export function getCycleLength(cycles: CycleRecord[]): number {
  const factual = cycles
    .filter((c) => c.cycle_length != null)
    .map((c) => c.cycle_length!)
    .slice(0, 3);
  if (factual.length >= 2) {
    return Math.round(factual.reduce((a, b) => a + b, 0) / factual.length);
  }
  const any = cycles.find((c) => c.cycle_length != null);
  return any?.cycle_length ?? 28;
}

/** День цикла (1-based) от даты начала до сегодня. */
export function getCycleDay(startedAt: string, today: string): number {
  const start = new Date(startedAt);
  const todayDate = new Date(today);
  return Math.floor((todayDate.getTime() - start.getTime()) / 86_400_000) + 1;
}

/** Добавляет дни к дате YYYY-MM-DD, возвращает YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Форматирует YYYY-MM-DD в русский формат «21 июля». */
const MONTHS_RU = ["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"];
export function fmtDateRu(date: string): string {
  const d = new Date(date);
  return `${d.getUTCDate()} ${MONTHS_RU[d.getUTCMonth()]}`;
}

// ── Словарь фаз ───────────────────────────────────────────────────────────────

export const PHASE_META: Record<Phase, {
  heroEm: string;        // курсивное слово/словосочетание
  heroBefore: string;    // текст до em
  heroAfter: string;     // текст после em
  lede: string;
  labelRu: string;
  aheadTitle: string;    // для хронологии Впереди
  aheadText: string;
}> = {
  menses: {
    heroEm: "медленно",
    heroBefore: "Дни, когда можно ",
    heroAfter: ".",
    lede: "Идут месячные. Лёгкое движение помогает телу: спокойная короткая пробежка или прогулка. Пропуск в эти дни тоже часть плана.",
    labelRu: "Месячные",
    aheadTitle: "Месячные",
    aheadText: "Предложу мягкую неделю и подстрою план под самочувствие. Прогулка в эти дни тоже считается движением.",
  },
  rise: {
    heroEm: "окно энергии",
    heroBefore: "Открылось ",
    heroAfter: ".",
    lede: "Фаза подъёма. Силы возвращаются, восстановление идёт быстрее обычного. Лучшее время для интервалов, длинных дистанций и смелых целей.",
    labelRu: "Подъём",
    aheadTitle: "Окно энергии",
    aheadText: "Лучшее время для сложного: интервалы, новые дистанции, смелые цели. Сюда поставлю самое амбициозное из твоих планов.",
  },
  peak: {
    heroEm: "пике",
    heroBefore: "Ты на ",
    heroAfter: " формы.",
    lede: "Овуляция. Сегодня тело способно на максимум и просит внимательной разминки: связки сейчас эластичнее обычного, поэтому начни мягко.",
    labelRu: "Пик",
    aheadTitle: "Пик формы",
    aheadText: "Тело на максимуме. Амбициозная тренировка зайдёт легче, но начни с хорошей разминки.",
  },
  slow: {
    heroEm: "мягкости",
    heroBefore: "Тело просит ",
    heroAfter: ".",
    lede: "Идёт фаза замедления. Пульс сейчас выше обычного, сон чуть более хрупкий, и бег ощущается тяжелее. Это физиология, и она на твоей стороне: лёгкий темп сегодня даст больше, чем интервалы.",
    labelRu: "Замедление",
    aheadTitle: "Замедление",
    aheadText: "Лёгкий бег, растяжка, сон. База, на которой держится всё остальное. Короткая пробежка в мягком темпе сейчас ценнее любой интенсивной.",
  },
};

// ── Суффикс для системного промпта чата ───────────────────────────────────────

export function buildCycleContext(
  cycleDay: number,
  cycleLen: number,
  phase: Phase,
  checkin: CheckinRecord | null,
): string {
  const phaseRu = PHASE_META[phase].labelRu;
  const tags = checkin?.tags?.length ? checkin.tags.join(", ") : "нет";
  const note = checkin?.note ? ` («${checkin.note}»)` : "";

  return [
    "[Контекст ритма]",
    `День цикла: ${cycleDay} из ${cycleLen}. Фаза: ${phaseRu}.`,
    `Вчерашний чек-ин: ${tags}${note}.`,
    "Правила: учитывай фазу в советах о темпе, нагрузке и восстановлении.",
    "Упоминай цикл только когда это уместно по контексту разговора.",
    "Медицинские советы не даёшь — при вопросах о здоровье мягко направляй к специалисту.",
  ].join("\n");
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

type Client = SupabaseClient<Database>;

export async function getLatestCycles(
  supabase: Client,
  userId: string,
  limit = 5,
): Promise<CycleRecord[]> {
  const { data } = await supabase
    .from("rhythm_cycles")
    .select("id, started_at, cycle_length, created_at")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as CycleRecord[];
}

export async function getTodayCheckin(
  supabase: Client,
  userId: string,
  today: string,
): Promise<CheckinRecord | null> {
  const { data } = await supabase
    .from("rhythm_checkins")
    .select("tags, note")
    .eq("user_id", userId)
    .eq("date", today)
    .maybeSingle();
  if (!data) return null;
  return { tags: data.tags ?? [], note: data.note ?? null };
}

export async function getTodayAdvice(
  supabase: Client,
  userId: string,
  today: string,
): Promise<AdviceRecord | null> {
  const { data } = await supabase
    .from("rhythm_daily_advice")
    .select("advice_short, advice_full")
    .eq("user_id", userId)
    .eq("date", today)
    .maybeSingle();
  return data ?? null;
}

/** Вставляет запись начала цикла и проставляет cycle_length предыдущей. */
export async function markCycleStart(
  supabase: Client,
  userId: string,
  today: string,
  prevCycleId: string | null,
  prevStartedAt: string | null,
): Promise<string | null> {
  if (prevCycleId && prevStartedAt) {
    const prevStart = new Date(prevStartedAt);
    const todayDate = new Date(today);
    const factLength = Math.floor(
      (todayDate.getTime() - prevStart.getTime()) / 86_400_000,
    );
    await supabase
      .from("rhythm_cycles")
      .update({ cycle_length: factLength })
      .eq("id", prevCycleId);
  }
  const { error } = await supabase
    .from("rhythm_cycles")
    .insert({ user_id: userId, started_at: today });
  return error?.message ?? null;
}

/** Отменяет последнюю отметку (только если не старше 24ч). */
export async function undoLastMark(
  supabase: Client,
  userId: string,
  cycleId: string,
  prevCycleId: string | null,
): Promise<string | null> {
  const { error } = await supabase
    .from("rhythm_cycles")
    .delete()
    .eq("id", cycleId)
    .eq("user_id", userId);
  if (error) return error.message;
  if (prevCycleId) {
    await supabase
      .from("rhythm_cycles")
      .update({ cycle_length: null })
      .eq("id", prevCycleId);
  }
  return null;
}

/** Удаляет все данные ритма 2.0 пользователя. */
export async function deleteAllCycleData(
  supabase: Client,
  userId: string,
): Promise<string | null> {
  const [r1, r2, r3] = await Promise.all([
    supabase.from("rhythm_cycles").delete().eq("user_id", userId),
    supabase.from("rhythm_checkins").delete().eq("user_id", userId),
    supabase.from("rhythm_daily_advice").delete().eq("user_id", userId),
  ]);
  return r1.error?.message ?? r2.error?.message ?? r3.error?.message ?? null;
}

/** Экспортирует данные ритма 2.0 в JSON. */
export async function exportCycleData(supabase: Client, userId: string) {
  const [{ data: cycles }, { data: checkins }, { data: advice }] = await Promise.all([
    supabase.from("rhythm_cycles").select("*").eq("user_id", userId),
    supabase.from("rhythm_checkins").select("*").eq("user_id", userId),
    supabase.from("rhythm_daily_advice").select("*").eq("user_id", userId),
  ]);
  return { rhythm_cycles: cycles ?? [], rhythm_checkins: checkins ?? [], rhythm_daily_advice: advice ?? [] };
}
