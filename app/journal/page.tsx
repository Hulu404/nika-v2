import { redirect } from "next/navigation";
import { createServerComponentClient } from "@/lib/supabase";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { PageHeader } from "@/components/nav/PageHeader";
import { WeekStats } from "@/components/journal/WeekStats";
import { WeekDayBar } from "@/components/journal/WeekDayBar";
import { JournalRunList } from "@/components/journal/JournalRunList";
import { AddRunSheet } from "@/components/journal/AddRunSheet";
import { getRuns, weekSummary } from "@/lib/runs";

export default async function JournalPage() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth?next=/journal");

  const rows = await getRuns(supabase, user.id);
  const week = weekSummary(rows);
  const totalKm = rows.reduce((s, r) => s + Number(r.distance_km), 0).toFixed(1);

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <PageHeader title="Журнал" subtitle={`${totalKm} км`} />

      <div className="flex-1 overflow-y-auto pb-tabbar lg:pb-10">
        <div className="mx-auto w-full max-w-[720px] px-6 pt-6 lg:pt-10">

          {/* Заголовок (десктоп) */}
          <div className="hidden border-b border-line-default pb-4 lg:block">
            <h1 className="text-[22px] font-bold text-ink-primary">Бег</h1>
            <p className="mt-0.5 text-sm text-ink-secondary">журнал пробежек</p>
          </div>

          {/* Эта неделя */}
          <section className="mt-6">
            <h2 className="text-lg font-bold text-ink-primary">Эта неделя</h2>
            <p className="mt-1 text-sm text-ink-secondary">
              {week.count > 0 ? (
                <>Пробежек: {week.count}. <span className="italic text-accent">Так держать.</span></>
              ) : (
                "На этой неделе пока пусто."
              )}
            </p>
            <div className="mt-4">
              <WeekStats count={week.count} km={week.km} duration={week.duration} />
            </div>
            <div className="mt-4">
              <WeekDayBar activeWeekdays={week.activeWeekdays} today={week.today} />
            </div>
          </section>

          {/* Добавить пробежку */}
          <div className="mt-6">
            <AddRunSheet userId={user.id} />
          </div>

          {/* Список пробежек / пустое состояние */}
          <section className="mt-6">
            <JournalRunList rows={rows} userId={user.id} />
          </section>

        </div>
      </div>
    </AppLayout>
  );
}
