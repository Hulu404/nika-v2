import type { RunRow } from "@/types/database";
import type { Message, RunIntensity } from "@/types/app";

const WEEKDAYS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];

export interface ChartDay {
  label: string;
  intensity: RunIntensity | null;
}

export interface WordFreq {
  text: string;
  freq: number;
}

/** Последние 14 дней: интенсивность пробежки по дню (или null — «не было»). */
export function buildMoodChart(runs: RunRow[], now = new Date()): ChartDay[] {
  const byDate = new Map<string, RunRow>();
  for (const r of runs) if (!byDate.has(r.date)) byDate.set(r.date, r);

  const days: ChartDay[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const ymd = d.toLocaleDateString("en-CA");
    const run = byDate.get(ymd);
    days.push({ label: WEEKDAYS[(d.getDay() + 6) % 7], intensity: run ? run.intensity : null });
  }
  return days;
}

// Частые служебные слова (длиной ≥3; короткие и так отсекаются по длине).
const STOP = new Set([
  "что", "как", "это", "для", "или", "если", "чтобы", "когда", "там", "тут",
  "уже", "ещё", "еще", "все", "всё", "меня", "мне", "мой", "моя", "мои", "так",
  "вот", "нет", "был", "была", "было", "были", "есть", "будет", "очень", "тоже",
  "потому", "просто", "над", "под", "про", "без", "при", "даже", "чем", "кто",
  "они", "она", "оно", "его", "её", "их", "себя", "свой", "своя", "эта", "эти",
  "этот", "того", "тебя", "тебе", "буду", "быть", "этом", "более", "чём", "себе",
  "ничего", "когда", "после", "перед", "потом", "сейчас", "можно", "надо",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^а-яёa-z0-9-]+/i)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^[\d-]+$/.test(w));
}

/** Топ слов из сообщений пользователя в диалогах. */
export function buildWordCloud(
  conversations: { messages: Message[] }[],
  limit = 14,
): WordFreq[] {
  const counts = new Map<string, number>();
  for (const c of conversations) {
    for (const m of c.messages ?? []) {
      if (m.role !== "user") continue;
      for (const w of tokenize(m.content)) counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([text, freq]) => ({ text, freq }))
    .sort((a, b) => b.freq - a.freq)
    .slice(0, limit);
}

export function pluralConversations(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "разговор";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "разговора";
  return "разговоров";
}
