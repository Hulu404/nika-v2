import { anthropic } from "@/lib/anthropic";
import { createServerComponentClient } from "@/lib/supabase";
import { resolveIsPro } from "@/lib/subscription";
import { getActiveSprint, sprintDay, sprintWeek } from "@/lib/sprint";
import { getRuns } from "@/lib/runs";
import { buildWordCloud } from "@/lib/analytics";
import { getLatestCycles, getCycleLength, getCycleDay, getPhase, type Phase } from "@/lib/rhythm/cycles";
import {
  buildSprintSignals,
  selectTipThemes,
  buildTipsPrompt,
  fallbackTip,
  type EnergyHint,
} from "@/lib/sprint-advice";
import type { Message, SprintTip } from "@/types/app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

/** Фаза → внутренний сигнал энергии (в текст советов не попадает). */
const PHASE_ENERGY: Record<Phase, EnergyHint> = {
  menses: "low",
  rise: "normal",
  peak: "high",
  slow: "low",
};

/** Внутренний сигнал энергии по циклу. Только читает rhythm_cycles, null если нет. */
async function getEnergyHint(
  supabase: Awaited<ReturnType<typeof createServerComponentClient>>,
  userId: string,
): Promise<EnergyHint | null> {
  try {
    const cycles = await getLatestCycles(supabase, userId, 6);
    if (cycles.length === 0) return null;
    const len = getCycleLength(cycles);
    const today = new Date().toISOString().slice(0, 10);
    const cycleDay = getCycleDay(cycles[0].started_at, today);
    if (cycleDay < 1 || cycleDay > len + 10) return null; // данные устарели
    return PHASE_ENERGY[getPhase(cycleDay, len)];
  } catch {
    return null;
  }
}

export async function POST() {
  const supabase = await createServerComponentClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Советы спринта — Про-фича (страница /sprint тоже под Pro).
  const { data: userRow } = await supabase
    .from("users")
    .select("is_pro, display_name")
    .eq("id", user.id)
    .maybeSingle();
  if (!resolveIsPro(userRow?.is_pro)) return Response.json({ error: "Pro required" }, { status: 403 });

  const sprint = await getActiveSprint(supabase, user.id);
  if (!sprint) return Response.json({ error: "No active sprint" }, { status: 404 });

  const week = sprintWeek(Math.min(sprintDay(sprint), 21));

  // Кэш на неделю спринта (обновление привязано к чек-ину недели).
  const { data: cached } = await supabase
    .from("sprint_advice")
    .select("tips")
    .eq("sprint_id", sprint.id)
    .eq("week_number", week)
    .maybeSingle();
  if (cached && Array.isArray(cached.tips) && cached.tips.length > 0) {
    return Response.json({ week, tips: cached.tips });
  }

  // Сигналы: бег + чат + цель/ориентиры + внутренний сигнал энергии.
  const since = new Date(sprint.start_date);
  since.setHours(0, 0, 0, 0);
  const [runs, energyHint, { data: convs }] = await Promise.all([
    getRuns(supabase, user.id),
    getEnergyHint(supabase, user.id),
    supabase
      .from("conversations")
      .select("messages")
      .eq("user_id", user.id)
      .gte("updated_at", since.toISOString()),
  ]);

  const words = buildWordCloud((convs ?? []).map((c) => ({ messages: c.messages as Message[] })));
  const signals = buildSprintSignals(sprint, runs, words, energyHint);
  const themes = selectTipThemes(signals);
  const name = userRow?.display_name || "бегунья";

  // Генерация текста. При любом сбое — детерминированный фолбэк по теме.
  let tips: SprintTip[] = [];
  let generated = false;
  try {
    const msg = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 500,
      messages: [{ role: "user", content: buildTipsPrompt(signals, themes, name) }],
    });
    const text = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "";
    const parsed = JSON.parse(text) as { tips?: { theme?: string; text?: string }[] };
    const byTheme = new Map((parsed.tips ?? []).map((t) => [t.theme, (t.text ?? "").trim()]));
    tips = themes.map((theme) => {
      const t = byTheme.get(theme);
      return { theme, text: t && t.length > 0 ? t : fallbackTip(theme, signals) };
    });
    generated = tips.some((t) => t.text.length > 0);
  } catch {
    tips = themes.map((theme) => ({ theme, text: fallbackTip(theme, signals) }));
  }

  // Кэшируем ТОЛЬКО удачную генерацию — фолбэк не должен застрять на всю неделю.
  if (generated) {
    await supabase
      .from("sprint_advice")
      .upsert(
        { user_id: user.id, sprint_id: sprint.id, week_number: week, tips },
        { onConflict: "sprint_id,week_number" },
      );
  }

  return Response.json({ week, tips });
}
