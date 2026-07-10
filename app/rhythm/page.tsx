import { redirect } from "next/navigation";
import { createServerComponentClient } from "@/lib/supabase";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { PageHeader } from "@/components/nav/PageHeader";
import { getProfile, showRhythm } from "@/lib/profile";
import {
  getLatestPeriodMark,
  getPeriodMarks,
  getRecentDailyState,
  hasRhythmConsent,
  parseYmd,
  toYmd,
  userToday,
} from "@/lib/rhythm";
import { RHYTHM_REDS, shouldShowRedsNotice } from "@/lib/rhythm/reds";
import { RhythmScreen, type RhythmDay } from "@/components/rhythm/RhythmScreen";

// Пауза, после которой пропуск (ran=false) поднимает бакет «возвращение».
const PAUSE_DAYS = 5;

export default async function RhythmPage() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth?next=/rhythm");

  // Гейт: женский род и cycle != 'off'. Закрываем и прямой переход по ссылке.
  const profile = await getProfile(supabase, user.id);
  if (!showRhythm(profile?.gender, profile?.cycle)) redirect("/");

  // Широкое окно вокруг «сегодня» сервера — клиент сам выберет свой месяц/неделю
  // по своей таймзоне (границы намеренно с запасом, чтобы TZ не срезала край).
  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - 45);
  const to = new Date(now);
  to.setDate(now.getDate() + 5);

  const [recent, periods] = await Promise.all([
    getRecentDailyState(supabase, user.id, 60),
    getPeriodMarks(supabase, user.id, toYmd(from), toYmd(to)),
  ]);

  const days: RhythmDay[] = recent.map((r) => ({ date: r.date, moods: r.moods }));
  const periodDates = periods.map((p) => p.date);

  // Пропуск: сегодня отмечено «не бегала» (ran=false) И была известная пауза с
  // последней пробежки. ran сейчас может быть null (не задан) — тогда skip=false.
  const todayStr = userToday(now);
  const todayRan = recent.find((r) => r.date === todayStr)?.ran ?? null;
  let skip = false;
  if (todayRan === false) {
    const { data: lastRun } = await supabase
      .from("runs")
      .select("date")
      .eq("user_id", user.id)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const gapDays = lastRun
      ? Math.round((parseYmd(todayStr).getTime() - parseYmd(lastRun.date).getTime()) / 86_400_000)
      : Infinity;
    skip = gapDays >= PAUSE_DAYS;
  }

  // RED-S: безопасная заглушка за флагом (по умолчанию выключена). Запросы идут
  // только когда флаг включён. Сигналы: сама отмечала месячные + длинный разрыв
  // + регулярные самоотчёты о нагрузке (пробежки). Без счёта фаз и прогноза.
  let redsNotice = false;
  if (RHYTHM_REDS.enabled) {
    const lastPeriod = await getLatestPeriodMark(supabase, user.id);
    const daysSinceLastPeriod = lastPeriod
      ? Math.round((parseYmd(todayStr).getTime() - parseYmd(lastPeriod).getTime()) / 86_400_000)
      : null;
    const windowFrom = new Date(now);
    windowFrom.setDate(now.getDate() - RHYTHM_REDS.windowDays);
    const { count } = await supabase
      .from("runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("date", toYmd(windowFrom));
    redsNotice = shouldShowRedsNotice({
      hasSelfReportedPeriods: lastPeriod !== null,
      daysSinceLastPeriod,
      loadReportsInWindow: count ?? 0,
    });
  }

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <PageHeader title="Мой ритм" />
      <RhythmScreen
        userId={user.id}
        serverToday={userToday(now)}
        days={days}
        periodDates={periodDates}
        hasConsent={hasRhythmConsent(profile)}
        skip={skip}
        redsNotice={redsNotice}
        redsMessage={RHYTHM_REDS.message}
      />
    </AppLayout>
  );
}
