import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, DailyStateRow, PeriodMarkRow, Profile } from "@/types/database";
import type { MoodKey } from "@/types/app";

type Client = SupabaseClient<Database>;

/**
 * Канонический список 12 чипов состояния (бриф §5), в порядке отображения.
 * Значения — ключи, не UI-лейблы (русские подписи — MOOD_LABELS в
 * lib/rhythm-copy.ts). Единственный источник валидного словаря: и запись в БД,
 * и чтение фильтруются через него, чтобы в moods не попадало постороннее.
 * Менять здесь можно без миграции — колонка moods это text[].
 */
export const MOOD_KEYS: readonly MoodKey[] = [
  "energetic",
  "calm",
  "tired",
  "irritable",
  "sad",
  "anxious",
  "happy",
  "bloating",
  "pain",
  "insomnia",
  "cravings",
  "tenderness",
] as const;

const MOOD_SET = new Set<string>(MOOD_KEYS);

/** Оставляет только валидные ключи из канонического словаря, без дублей. */
export function normalizeMoods(input: readonly string[] | null | undefined): MoodKey[] {
  if (!input) return [];
  const seen = new Set<MoodKey>();
  for (const m of input) {
    if (MOOD_SET.has(m)) seen.add(m as MoodKey);
  }
  return [...seen];
}

// ── Согласие на хранение (152-ФЗ) ─────────────────────────────────────────────

/**
 * Версия текста согласия. Меняется, когда правим формулировку в UI, чтобы можно
 * было различать, на какую редакцию человек согласился (и при желании перезапросить).
 */
export const RHYTHM_CONSENT_VERSION = "1";

/** Дал ли пользователь согласие на хранение данных раздела. */
export function hasRhythmConsent(profile: Profile | null | undefined): boolean {
  return Boolean(profile?.rhythm_consent_at);
}

/**
 * Фиксирует согласие в профиле (дата + версия текста). До этого чек-ин и отметки
 * в базу не пишем. Возвращает текст ошибки или null.
 */
export async function saveRhythmConsent(
  supabase: Client,
  userId: string,
): Promise<string | null> {
  // upsert по user_id (как остальные записи профиля) — надёжнее .update():
  // не молчит, если строки профиля почему-то нет, и не зависит от её наличия.
  const { error } = await supabase
    .from("profiles")
    .upsert(
      {
        user_id: userId,
        rhythm_consent_at: new Date().toISOString(),
        rhythm_consent_version: RHYTHM_CONSENT_VERSION,
      },
      { onConflict: "user_id" },
    );
  return error?.message ?? null;
}

// ── daily_state ───────────────────────────────────────────────────────────────

/** Состояние за конкретную дату пользователя или null. Терпимо к отсутствию строки. */
export async function getDailyState(
  supabase: Client,
  userId: string,
  date: string,
): Promise<DailyStateRow | null> {
  const { data, error } = await supabase
    .from("daily_state")
    .select("*")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();
  if (error) {
    console.error("[rhythm] getDailyState failed:", error.message);
    return null;
  }
  return data ? { ...data, moods: normalizeMoods(data.moods) } : null;
}

/** Последние состояния (новые сверху) — для будущего экрана истории. */
export async function getRecentDailyState(
  supabase: Client,
  userId: string,
  limit = 30,
): Promise<DailyStateRow[]> {
  const { data, error } = await supabase
    .from("daily_state")
    .select("*")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[rhythm] getRecentDailyState failed:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({ ...r, moods: normalizeMoods(r.moods) }));
}

export interface DailyStateInput {
  userId: string;
  date: string; // YYYY-MM-DD (дата пользователя, по его таймзоне)
  moods: readonly string[];
  ran?: boolean | null;
  note?: string | null;
}

/**
 * Пишет/обновляет состояние за день (одна запись на user_id+date). Повторный
 * чек-ин перезаписывает строку — «последняя запись за дату побеждает». Возвращает
 * текст ошибки или null.
 */
export async function upsertDailyState(
  supabase: Client,
  input: DailyStateInput,
): Promise<string | null> {
  const { error } = await supabase.from("daily_state").upsert(
    {
      user_id: input.userId,
      date: input.date,
      moods: normalizeMoods(input.moods),
      ran: input.ran ?? null,
      note: input.note?.trim() || null,
    },
    { onConflict: "user_id,date" },
  );
  return error?.message ?? null;
}

/** Полностью стирает состояние за день (кнопка «стереть в один тап»). */
export async function deleteDailyState(
  supabase: Client,
  userId: string,
  date: string,
): Promise<string | null> {
  const { error } = await supabase
    .from("daily_state")
    .delete()
    .eq("user_id", userId)
    .eq("date", date);
  return error?.message ?? null;
}

// ── period_marks ──────────────────────────────────────────────────────────────
// ВАЖНО: только факты календаря. Никакого вычисления дня цикла/фазы/прогноза.

/** Отметки месячных в диапазоне дат [from, to] включительно. */
export async function getPeriodMarks(
  supabase: Client,
  userId: string,
  from: string,
  to: string,
): Promise<PeriodMarkRow[]> {
  const { data, error } = await supabase
    .from("period_marks")
    .select("*")
    .eq("user_id", userId)
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true });
  if (error) {
    console.error("[rhythm] getPeriodMarks failed:", error.message);
    return [];
  }
  return data ?? [];
}

/** Ставит отметку месячных за день (идемпотентно — unique по user_id+date). */
export async function addPeriodMark(
  supabase: Client,
  userId: string,
  date: string,
): Promise<string | null> {
  const { error } = await supabase
    .from("period_marks")
    .upsert({ user_id: userId, date }, { onConflict: "user_id,date" });
  return error?.message ?? null;
}

/** Снимает отметку месячных за день. */
export async function removePeriodMark(
  supabase: Client,
  userId: string,
  date: string,
): Promise<string | null> {
  const { error } = await supabase
    .from("period_marks")
    .delete()
    .eq("user_id", userId)
    .eq("date", date);
  return error?.message ?? null;
}

// ── Приватность: экспорт и удаление (бриф §9) ─────────────────────────────────

export interface RhythmExport {
  exported_at: string;
  daily_state: DailyStateRow[];
  period_marks: PeriodMarkRow[];
}

/** Полная выгрузка данных раздела пользователя — для «Скачать мои данные». */
export async function exportRhythmData(supabase: Client, userId: string): Promise<RhythmExport> {
  const [{ data: daily }, { data: periods }] = await Promise.all([
    supabase.from("daily_state").select("*").eq("user_id", userId).order("date", { ascending: true }),
    supabase.from("period_marks").select("*").eq("user_id", userId).order("date", { ascending: true }),
  ]);
  return {
    exported_at: new Date().toISOString(),
    daily_state: (daily ?? []).map((r) => ({ ...r, moods: normalizeMoods(r.moods) })),
    period_marks: periods ?? [],
  };
}

/**
 * Удаляет все данные раздела И факт согласия — раздел возвращается в состояние
 * «первый вход» (следующая запись снова спросит согласие). Текст ошибки или null.
 */
export async function deleteAllRhythmData(supabase: Client, userId: string): Promise<string | null> {
  const daily = await supabase.from("daily_state").delete().eq("user_id", userId);
  if (daily.error) return daily.error.message;

  const periods = await supabase.from("period_marks").delete().eq("user_id", userId);
  if (periods.error) return periods.error.message;

  const consent = await supabase
    .from("profiles")
    .update({ rhythm_consent_at: null, rhythm_consent_version: null })
    .eq("user_id", userId);
  return consent.error?.message ?? null;
}

/** Последняя отметка месячных (YYYY-MM-DD) или null. Для RED-S-заглушки. */
export async function getLatestPeriodMark(supabase: Client, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("period_marks")
    .select("date")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.date ?? null;
}

// ── Чистые хелперы ─────────────────────────────────────────────────────────────

/** Дата пользователя (YYYY-MM-DD) по его локальной таймзоне. */
export function userToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA");
}

/** Локальная дата (YYYY-MM-DD) без сдвига таймзоны. */
export function toYmd(d: Date): string {
  return d.toLocaleDateString("en-CA");
}

/** Разбирает YYYY-MM-DD в локальную дату (без UTC-сдвига). */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Индекс дня недели с понедельника: Пн=0 … Вс=6. */
export function weekdayMon0(d: Date): number {
  return (d.getDay() + 6) % 7;
}
