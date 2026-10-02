/**
 * Память Ники для Про: краткий контекст за последние три недели в начале каждого
 * диалога. Ника не переспрашивает известное и может вернуться к важному.
 *
 * Что попадает: реплики самого человека из прошлых разговоров (они уже уходили
 * в модель), пробежки (дистанция, время, оценки, метки) и, только при согласии
 * на сведения о здоровье, записи дневника.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { Message } from "@/types/app";

export const MEMORY_DAYS = 21;
const MAX_CHARS = 3200;
const PER_CONVERSATION = 3;

export interface MemoryInput {
  conversations: { scenario: string; updated_at: string; messages: Message[] }[];
  runs: { date: string; distance_km: number; duration_min: number; ratings: Json | null; tags: string[]; note: string | null }[];
  entries: { date: string; text: string }[];
}

const clip = (t: string, n: number) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

/** Собирает текст блока памяти. Пусто, если вспоминать нечего. */
export function formatMemory(input: MemoryInput): string {
  const lines: string[] = [];
  for (const c of input.conversations) {
    const said = (c.messages ?? []).filter((m) => m.role === "user" && m.content?.trim()).slice(-PER_CONVERSATION);
    if (!said.length) continue;
    lines.push(`- ${c.updated_at.slice(0, 10)}: ${said.map((m) => `«${clip(m.content, 160)}»`).join(" ")}`);
  }
  const runs = input.runs.map((r) => {
    const rt = (r.ratings ?? {}) as Record<string, number>;
    const parts = [`${Number(r.distance_km)} км за ${r.duration_min} мин`];
    if (rt.effort) parts.push(`усилие ${rt.effort}/10`);
    if (rt.legs) parts.push(`ноги ${rt.legs}/10`);
    if (rt.mood) parts.push(`настрой ${rt.mood}/10`);
    if (r.note) parts.push(`«${clip(r.note, 100)}»`);
    return `- ${r.date}: ${parts.join(", ")}`;
  });
  const entries = input.entries.map((e) => `- ${e.date}: «${clip(e.text, 140)}»`);
  if (!lines.length && !runs.length && !entries.length) return "";

  const blocks = [
    "<memory>",
    `Что человек рассказывал за последние ${MEMORY_DAYS} дней (подписка Про). Используй, чтобы не переспрашивать известное и мягко возвращаться к важному, например «на прошлой неделе вечером было тяжелее, сегодня так же?». Не пересказывай это списком и не делай выводов о здоровье.`,
  ];
  if (lines.length) blocks.push("Из прошлых разговоров (его слова):", ...lines);
  if (runs.length) blocks.push("Пробежки:", ...runs);
  if (entries.length) blocks.push("Дневник:", ...entries);
  blocks.push("</memory>");
  let text = blocks.join("\n");
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS - 12) + "\n</memory>";
  return text;
}

/** Загружает данные для памяти. Текущий разговор не включается: он и так в окне. */
export async function loadMemory(
  supabase: SupabaseClient<Database>,
  userId: string,
  currentConversationId: string | null,
  withDiary: boolean,
): Promise<string> {
  const since = new Date(Date.now() - MEMORY_DAYS * 86_400_000);
  const sinceIso = since.toISOString();
  const sinceYmd = sinceIso.slice(0, 10);
  let convQ = supabase
    .from("conversations")
    .select("id, scenario, updated_at, messages")
    .eq("user_id", userId)
    .gte("updated_at", sinceIso)
    .order("updated_at", { ascending: false })
    .limit(8);
  if (currentConversationId) convQ = convQ.neq("id", currentConversationId);
  const [convs, runs, entries] = await Promise.all([
    convQ,
    supabase
      .from("runs")
      .select("date, distance_km, duration_min, ratings, tags, note")
      .eq("user_id", userId)
      .gte("date", sinceYmd)
      .order("date", { ascending: false })
      .limit(10),
    withDiary
      ? supabase
          .from("diary_entries")
          .select("date, text")
          .eq("user_id", userId)
          .gte("date", sinceYmd)
          .order("created_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] as { date: string; text: string }[] }),
  ]);
  return formatMemory({
    conversations: (convs.data ?? []).map((c) => ({
      scenario: c.scenario,
      updated_at: c.updated_at,
      messages: c.messages ?? [],
    })),
    runs: (runs.data ?? []).map((r) => ({ ...r, tags: r.tags ?? [] })),
    entries: entries.data ?? [],
  });
}
