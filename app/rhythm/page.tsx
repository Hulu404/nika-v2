import { redirect } from "next/navigation";
import { createServerComponentClient } from "@/lib/supabase";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { PageHeader } from "@/components/nav/PageHeader";
import { getProfile, showRhythm } from "@/lib/profile";
import {
  getLatestCycles,
  getTodayCheckin,
  getTodayAdvice,
  getCycleLength,
  getCycleDay,
  getPhase,
} from "@/lib/rhythm/cycles";
import { RhythmContent } from "@/components/rhythm/RhythmContent";
import { RhythmOnboarding } from "@/components/rhythm/RhythmOnboarding";
import { MorningAttribution } from "@/components/rhythm/MorningAttribution";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function RhythmPage() {
  const supabase = await createServerComponentClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth?next=/rhythm");

  const today = todayUtc();

  // Все запросы к БД одной параллельной волной, а не цепочкой ожиданий.
  // Профиль/циклы/чек-ин/совет/имя независимы, поэтому грузятся сразу вместе;
  // гейт showRhythm и ветку онбординга проверяем уже по готовым данным.
  const [profile, cycles, checkin, advice, { data: userData }] = await Promise.all([
    getProfile(supabase, user.id),
    getLatestCycles(supabase, user.id, 5),
    getTodayCheckin(supabase, user.id, today),
    getTodayAdvice(supabase, user.id, today),
    supabase.from("users").select("display_name").eq("id", user.id).maybeSingle(),
  ]);

  if (!showRhythm(profile?.gender, profile?.cycle)) redirect("/");

  // Нет ни одного цикла — онбординг
  if (cycles.length === 0) {
    return (
      <AppLayout sidebarSlot={<SidebarData />}>
        <MorningAttribution />
        <PageHeader title="Мой ритм" />
        <RhythmOnboarding userId={user.id} todayStr={today} />
      </AppLayout>
    );
  }

  const cycleLen = getCycleLength(cycles);
  const cycleDay = getCycleDay(cycles[0].started_at, today);
  const phase = getPhase(cycleDay, cycleLen);
  const isOverdue = cycleDay > cycleLen + 7;

  const completedCycles = cycles.filter((c) => c.cycle_length != null).length;

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <MorningAttribution />
      <PageHeader title="Мой ритм" />
      <RhythmContent
        userId={user.id}
        todayStr={today}
        cycles={cycles}
        cycleDay={cycleDay}
        cycleLen={cycleLen}
        phase={phase}
        isOverdue={isOverdue}
        checkin={checkin}
        advice={advice}
        completedCycles={completedCycles}
        displayName={userData?.display_name ?? ""}
      />
    </AppLayout>
  );
}
