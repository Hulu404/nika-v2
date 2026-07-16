import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, RunRow } from "@/types/database";
import type { ArchetypeId, Milestone, QuizAnswer, RunIntensity, Sprint, SprintStatus, WeeklyFocus } from "@/types/app";
import type { WordFreq } from "@/lib/analytics";
import { ARCHETYPES } from "@/lib/archetypes";

type Supa = SupabaseClient<Database>;

// ─── Чтение ──────────────────────────────────────────────────────────────────

/** Активный спринт пользователя или null. */
export async function getActiveSprint(supabase: Supa, userId: string): Promise<Sprint | null> {
  const { data } = await supabase
    .from("sprints")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as Sprint | null;
}

/** Текущий день спринта (1-indexed). Возвращает 0 если спринт null. */
export function sprintDay(sprint: Sprint | null): number {
  if (!sprint) return 0;
  const start = new Date(sprint.start_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - start.getTime()) / 86_400_000) + 1;
}

/** Текущий фокус недели (последний в массиве или дефолт архетипа). */
export function currentWeeklyFocus(sprint: Sprint): string {
  if (sprint.weekly_focus.length > 0) {
    return sprint.weekly_focus[sprint.weekly_focus.length - 1].focus_text;
  }
  return ARCHETYPES[sprint.archetype_id].weeklyFocusDefault;
}

/** Номер недели спринта (1, 2 или 3). */
export function sprintWeek(day: number): 1 | 2 | 3 {
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  return 3;
}

const SPRINT_TOTAL_DAYS = 21;

/** Один день ритма спринта. */
export interface RhythmDay {
  dayNumber: number; // 1..21
  week: 1 | 2 | 3;
  date: string; // YYYY-MM-DD
  intensity: RunIntensity | null;
  state: "past" | "today" | "future";
}

/**
 * Ритм спринта: ровно 21 день от start_date. Интенсивность — по пробежке этой
 * даты (маппинг по дате; если несколько за день — первая, как в buildMoodChart).
 * Чистая функция — считается на сервере и прокидывается пропом.
 */
export function buildSprintRhythm(sprint: Sprint, runs: RunRow[], now = new Date()): RhythmDay[] {
  const byDate = new Map<string, RunRow>();
  for (const r of runs) if (!byDate.has(r.date)) byDate.set(r.date, r);

  const start = new Date(sprint.start_date);
  start.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const days: RhythmDay[] = [];
  for (let i = 0; i < SPRINT_TOTAL_DAYS; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const ymd = d.toLocaleDateString("en-CA");
    const run = byDate.get(ymd);
    const state: RhythmDay["state"] =
      d.getTime() > today.getTime() ? "future"
      : d.getTime() === today.getTime() ? "today"
      : "past";
    days.push({
      dayNumber: i + 1,
      week: sprintWeek(i + 1),
      date: ymd,
      intensity: run ? run.intensity : null,
      state,
    });
  }
  return days;
}

/** Рекап одной недели спринта — данные для карточек чек-ина в хронологии. */
export interface WeekRecap {
  week: 1 | 2 | 3;
  runs: number; // пробежек за неделю
  hard: number; // из них тяжёлых
  skipped: number; // прошедших дней без пробежки
  topWord?: string; // частое слово недели
}

/**
 * Рекапы всех трёх недель из ритма. `topWord` — MVP-упрощение: одно слово на весь
 * спринт (wordFreqs[0]). TODO: считать топ-слово по конкретной неделе.
 */
export function buildWeekRecaps(rhythm: RhythmDay[], topWord?: string): WeekRecap[] {
  const weeks: (1 | 2 | 3)[] = [1, 2, 3];
  return weeks.map((week) => {
    const days = rhythm.filter((d) => d.week === week);
    return {
      week,
      runs: days.filter((d) => d.intensity !== null).length,
      hard: days.filter((d) => d.intensity === "hard").length,
      skipped: days.filter((d) => d.state === "past" && d.intensity === null).length,
      topWord,
    };
  });
}

/** Тёплый итог спринта для карточки закрытия — без оценок и нормативов. */
export interface SprintSummary {
  totalRuns: number;
  runsByWeek: number[]; // [неделя1, неделя2, неделя3]
  achievedMilestones: string[]; // подписи отмеченных ориентиров
  topWords: string[]; // топ-3 слова
}

export function buildSprintSummary(
  sprint: Sprint,
  rhythm: RhythmDay[],
  words: WordFreq[],
): SprintSummary {
  const runsByWeek = buildWeekRecaps(rhythm).map((r) => r.runs);
  return {
    totalRuns: runsByWeek.reduce((a, b) => a + b, 0),
    runsByWeek,
    achievedMilestones: sprint.milestones.filter((m) => m.achieved_at).map((m) => m.label),
    topWords: words.slice(0, 3).map((w) => w.text),
  };
}

// ─── Создание / обновление ───────────────────────────────────────────────────

export interface CreateSprintParams {
  userId: string;
  archetypeId: ArchetypeId;
  goalText: string;
  milestonesEnabled: boolean;
  milestones: Milestone[];
  quizAnswers: QuizAnswer[];
}

/** Создаёт новый активный спринт. Предыдущий активный закрывается автоматически (в транзакции). */
export async function createSprint(supabase: Supa, params: CreateSprintParams): Promise<Sprint> {
  // Закрываем предыдущий активный спринт
  await supabase
    .from("sprints")
    .update({ status: "closed" as SprintStatus, closed_at: new Date().toISOString() })
    .eq("user_id", params.userId)
    .eq("status", "active");

  const { data, error } = await supabase
    .from("sprints")
    .insert({
      user_id: params.userId,
      archetype_id: params.archetypeId,
      goal_text: params.goalText,
      milestones_enabled: params.milestonesEnabled,
      milestones: params.milestones,
      quiz_answers: params.quizAnswers,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Sprint;
}

/** Меняет цель без сброса дня. Архетип не меняется. */
export async function updateSprintGoal(
  supabase: Supa,
  sprintId: string,
  goalText: string,
): Promise<void> {
  const { error } = await supabase
    .from("sprints")
    .update({ goal_text: goalText })
    .eq("id", sprintId);
  if (error) throw new Error(error.message);
}

/** Отмечает ориентир достигнутым (или снимает отметку). */
export async function toggleMilestone(
  supabase: Supa,
  sprint: Sprint,
  milestoneId: string,
): Promise<void> {
  const updated = sprint.milestones.map((m) =>
    m.id === milestoneId
      ? { ...m, achieved_at: m.achieved_at ? null : new Date().toISOString() }
      : m,
  );
  const { error } = await supabase
    .from("sprints")
    .update({ milestones: updated })
    .eq("id", sprint.id);
  if (error) throw new Error(error.message);
}

/** Сохраняет еженедельный чек-ин (фокус недели). */
export async function saveWeeklyFocus(
  supabase: Supa,
  sprint: Sprint,
  focusText: string,
  weekNumber: 1 | 2 | 3,
): Promise<void> {
  const entry: WeeklyFocus = {
    week_number: weekNumber,
    focus_text: focusText,
    set_at: new Date().toISOString(),
  };
  // Заменяем запись той же недели если уже есть, иначе добавляем
  const existing = sprint.weekly_focus.filter((f) => f.week_number !== weekNumber);
  const { error } = await supabase
    .from("sprints")
    .update({ weekly_focus: [...existing, entry] })
    .eq("id", sprint.id);
  if (error) throw new Error(error.message);
}

/** Закрывает спринт (21-й день). */
export async function closeSprint(
  supabase: Supa,
  sprintId: string,
  closingReflection: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("sprints")
    .update({
      status: "closed" as SprintStatus,
      closed_at: new Date().toISOString(),
      closing_reflection: closingReflection,
    })
    .eq("id", sprintId);
  if (error) throw new Error(error.message);
}

// ─── Системный промпт ─────────────────────────────────────────────────────────

/**
 * Динамический блок <user_context> для системного промпта.
 * Добавляется ПОСЛЕ кэшируемого статичного префикса (NIKA_BASE_PROMPT).
 * Архетип не называется вслух — инструкция зашита прямо здесь.
 */
export function buildSprintContext(sprint: Sprint, lastRunSummary?: string): string {
  const arch = ARCHETYPES[sprint.archetype_id];
  const day = sprintDay(sprint);
  const focus = currentWeeklyFocus(sprint);

  const achievedCount = sprint.milestones.filter((m) => m.achieved_at).length;
  const totalCount = sprint.milestones.length;
  const milestonesLine =
    sprint.milestones_enabled && totalCount > 0
      ? `Ориентиры: ${achievedCount} из ${totalCount} отмечено`
      : null;

  const lines = [
    `<user_context>`,
    `Архетип пользователя: ${arch.name} — используй для тона, НЕ называй архетип вслух, если пользователь прямо не спросил.`,
    `Тон наблюдений: ${arch.observationTone}`,
    `Спринт: день ${day} из 21`,
    `Цель: «${sprint.goal_text}»`,
    milestonesLine,
    `Фокус недели: «${focus}»`,
    lastRunSummary ? `Последняя пробежка: ${lastRunSummary}` : null,
    `</user_context>`,
  ]
    .filter(Boolean)
    .join("\n");

  return lines;
}
