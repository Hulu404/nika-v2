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

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function RhythmPage() {
  const supabase = await createServerComponentClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth?next=/rhythm");

  const profile = await getProfile(supabase, user.id);
  if (!showRhythm(profile?.gender, profile?.cycle)) redirect("/");

  const today = todayUtc();

  // Загружаем данные параллельно
  const cycles = await getLatestCycles(supabase, user.id, 5);

  // Нет ни одного цикла — онбординг
  if (cycles.length === 0) {
    return (
      <AppLayout sidebarSlot={<SidebarData />}>
        <PageHeader title="Мой ритм" />
        <RhythmOnboarding userId={user.id} todayStr={today} />
      </AppLayout>
    );
  }

  const cycleLen = getCycleLength(cycles);
  const cycleDay = getCycleDay(cycles[0].started_at, today);
  const phase = getPhase(cycleDay, cycleLen);
  const isOverdue = cycleDay > cycleLen + 7;

  const [checkin, advice] = await Promise.all([
    getTodayCheckin(supabase, user.id, today),
    getTodayAdvice(supabase, user.id, today),
  ]);

  const completedCycles = cycles.filter((c) => c.cycle_length != null).length;

  const { data: userData } = await supabase
    .from("users")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
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
