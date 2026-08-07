import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, RunRow } from "@/types/database";
import type { RunIntensity } from "@/types/app";

type Client = SupabaseClient<Database>;

const MONTHS = ["ЯНВ", "ФЕВ", "МАР", "АПР", "МАЙ", "ИЮН", "ИЮЛ", "АВГ", "СЕН", "ОКТ", "НОЯ", "ДЕК"];
const INTENSITY: Record<RunIntensity, string> = { easy: "легко", medium: "средне", hard: "тяжело" };

/** Отображаемая пробежка для RunCard. */
export interface RunView {
  id: string;
  date: number;
  month: string;
  distance: string;
  duration: string;
  intensity: string;
  quote: string;
  pace: string;
  gapBefore?: string;
}

export interface WeekSummary {
  count: number;
  km: string;
  duration: string;
  /** Индексы дней недели с пробежкой (Пн=0 … Вс=6). */
  activeWeekdays: number[];
  /** Сегодняшний день недели (Пн=0 … Вс=6). */
  today: number;
}

// ─── дата пробежки ───────────────────────────────────────────────────────────

export const FUTURE_DATE_ERROR = "run date is in the future";

/** Сегодня в локальном времени пользователя, YYYY-MM-DD. */
export function todayStr(now = new Date()): string {
  return now.toLocaleDateString("en-CA");
}

/**
 * Пробежку записывают постфактум — дата позже сегодняшней недопустима.
 * Строки YYYY-MM-DD сравнимы лексикографически, так что часовой пояс
 * учитывается ровно один раз — в todayStr().
 */
export function isFutureDate(date: string, now = new Date()): boolean {
  return date > todayStr(now);
}

// ─── запросы ───────────────────────────────────────────────────────────────

/** Пробежки пользователя, новые сверху. Терпим к отсутствию таблицы (вернёт []). */
export async function getRuns(supabase: Client, userId: string): Promise<RunRow[]> {
  const { data, error } = await supabase
    .from("runs")
    .select("*")
    .eq("user_id", userId)
    .order("date", { ascending: false });
  if (error) {
    console.error("[runs] getRuns failed:", error.message);
    return [];
  }
  return data ?? [];
}

export interface NewRun {
  userId: string;
  date: string; // YYYY-MM-DD
  distanceKm: number;
  durationMin: number;
  intensity: RunIntensity;
  note?: string;
}

export async function createRun(supabase: Client, run: NewRun): Promise<string | null> {
  if (isFutureDate(run.date)) return FUTURE_DATE_ERROR;
  const { error } = await supabase.from("runs").insert({
    user_id: run.userId,
    date: run.date,
    distance_km: run.distanceKm,
    duration_min: run.durationMin,
    intensity: run.intensity,
    note: run.note?.trim() || null,
  });
  return error?.message ?? null;
}

export interface RunPatch {
  date: string; // YYYY-MM-DD
  distanceKm: number;
  durationMin: number;
  intensity: RunIntensity;
  note?: string;
}

/** Обновляет пробежку. RLS ограничивает строки владельцем (auth.uid() = user_id). */
export async function updateRun(supabase: Client, runId: string, patch: RunPatch): Promise<string | null> {
  if (isFutureDate(patch.date)) return FUTURE_DATE_ERROR;
  const { error } = await supabase
    .from("runs")
    .update({
      date: patch.date,
      distance_km: patch.distanceKm,
      duration_min: patch.durationMin,
      intensity: patch.intensity,
      note: patch.note?.trim() || null,
    })
    .eq("id", runId);
  return error?.message ?? null;
}

/** Удаляет пробежку. RLS ограничивает строки владельцем (auth.uid() = user_id). */
export async function deleteRun(supabase: Client, runId: string): Promise<string | null> {
  const { error } = await supabase.from("runs").delete().eq("id", runId);
  return error?.message ?? null;
}

// ─── чистые хелперы ──────────────────────────────────────────────────────────

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / 86_400_000);
}

/** Темп в формате M:SS на километр. */
export function formatPace(distanceKm: number, durationMin: number): string {
  if (!distanceKm) return "—";
  const paceMin = durationMin / distanceKm;
  let min = Math.floor(paceMin);
  let sec = Math.round((paceMin - min) * 60);
  if (sec === 60) { min += 1; sec = 0; }
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function formatDuration(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}ч ${m}м` : `${m}м`;
}

function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "дня";
  return "дней";
}

function weekdayMon0(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** Сводка за текущую неделю (Пн–Вс). */
export function weekSummary(rows: RunRow[], now = new Date()): WeekSummary {
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - weekdayMon0(now));

  const thisWeek = rows.filter((r) => parseDate(r.date) >= monday);
  const totalMin = thisWeek.reduce((s, r) => s + r.duration_min, 0);
  const totalKm = thisWeek.reduce((s, r) => s + Number(r.distance_km), 0);
  const activeWeekdays = [...new Set(thisWeek.map((r) => weekdayMon0(parseDate(r.date))))];

  return {
    count: thisWeek.length,
    km: totalKm.toFixed(1),
    duration: formatDuration(totalMin),
    activeWeekdays,
    today: weekdayMon0(now),
  };
}

/** Преобразует строки БД (отсортированные по дате desc) в карточки + разрывы. */
export function buildRunViews(rows: RunRow[]): RunView[] {
  return rows.map((r, i) => {
    const d = parseDate(r.date);
    let gapBefore: string | undefined;
    if (i > 0) {
      const gap = daysBetween(rows[i - 1].date, r.date) - 1;
      if (gap >= 2) gapBefore = `${gap} ${pluralDays(gap)} перерыв`;
    }
    return {
      id: r.id,
      date: d.getDate(),
      month: MONTHS[d.getMonth()],
      distance: String(Number(r.distance_km)),
      duration: `${r.duration_min} мин`,
      intensity: INTENSITY[r.intensity],
      quote: r.note ?? "",
      pace: formatPace(Number(r.distance_km), r.duration_min),
      gapBefore,
    };
  });
}
