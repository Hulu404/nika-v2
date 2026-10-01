import "server-only";
import type { User } from "@supabase/supabase-js";
import type { ServerClient } from "@/lib/v2/http";
import { getConsentStates } from "@/lib/consents";
import { CONSENT_TYPES } from "@/lib/legal";
import { resolveIsPro } from "@/lib/subscription";
import { rhythmEnabled } from "@/lib/v2/validate";
import { weekSummary } from "@/lib/runs";
import { isTelegramAllowed } from "@/lib/telegram/allowlist";

/**
 * Пользователи, заведённые до запуска новой версии, проходили старый онбординг
 * (имя и род). Новые вопросы им не показываем: состояние берём из уже имеющихся
 * данных, метки дневника можно настроить в профиле.
 */
export const V2_LAUNCH = "2026-10-01T00:00:00Z";

async function count(supabase: ServerClient, table: "diary_entries" | "runs" | "practice_sessions", userId: string, completedOnly = false) {
  let q = supabase.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (completedOnly) q = q.not("completed_at", "is", null);
  const { count: n } = await q;
  return n ?? 0;
}

export async function buildMe(supabase: ServerClient, user: User) {
  const weekFrom = new Date(Date.now() - 8 * 86_400_000).toISOString().slice(0, 10);
  const [userRow, profileRow, consents, entries, runs, practices, lastRunRow, lastEntryRow, tgRow, subRow, weekRuns] =
    await Promise.all([
      supabase.from("users").select("display_name, is_pro, created_at").eq("id", user.id).maybeSingle(),
      supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
      getConsentStates(supabase, user.id, CONSENT_TYPES),
      count(supabase, "diary_entries", user.id),
      count(supabase, "runs", user.id),
      count(supabase, "practice_sessions", user.id, true),
      supabase
        .from("runs")
        .select("date, distance_km, duration_min, note, tags")
        .eq("user_id", user.id)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("diary_entries")
        .select("date, text, tags, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("tg_bindings").select("is_active").eq("user_id", user.id).eq("is_active", true).maybeSingle(),
      supabase
        .from("subscriptions")
        .select("status, current_period_end")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("runs").select("*").eq("user_id", user.id).gte("date", weekFrom),
    ]);

  const u = userRow.data;
  const p = profileRow.data;
  const createdAt = u?.created_at ?? user.created_at;
  const legacy = !!p?.gender && createdAt < V2_LAUNCH;

  return {
    user: {
      id: user.id,
      email: user.email ?? null,
      name: u?.display_name ?? "",
      createdAt,
    },
    profile: {
      gender: p?.gender ?? null,
      cycle: p?.cycle ?? null,
      proactive: p?.proactive ?? true,
      intent: p?.intent ?? null,
      intentCustom: p?.intent_custom ?? null,
      barrier: p?.barrier ?? null,
      barrierCustom: p?.barrier_custom ?? null,
      baseline: p?.baseline ?? null,
      daypart: p?.daypart ?? null,
      behaviors: p?.behaviors ?? [],
      uiPrefs: (p?.ui_prefs as Record<string, unknown> | null) ?? {},
    },
    onboarding: {
      needsName: !p?.gender,
      complete: !!p?.onboarded_at || legacy,
    },
    plan: {
      isPro: resolveIsPro(u?.is_pro),
      periodEnd: subRow.data?.current_period_end ?? null,
    },
    consents,
    rhythm: {
      enabled: rhythmEnabled(p?.gender, p?.cycle),
      consent: consents.health.granted,
    },
    stats: {
      entries,
      runs,
      practicesCompleted: practices,
      records: entries + runs + practices,
      lastRun: lastRunRow.data ?? null,
      lastEntry: lastEntryRow.data ?? null,
      week: weekSummary(weekRuns.data ?? []),
    },
    telegram: { linked: !!tgRow.data, available: isTelegramAllowed(user.email) },
    push: { vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null },
    state: entries + runs + practices === 0 ? ("fresh" as const) : ("regular" as const),
  };
}

export type Me = Awaited<ReturnType<typeof buildMe>>;
