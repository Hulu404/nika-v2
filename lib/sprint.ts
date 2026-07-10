import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ArchetypeId, Milestone, QuizAnswer, Sprint, SprintStatus, WeeklyFocus } from "@/types/app";
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
