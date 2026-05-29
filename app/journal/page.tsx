import { Fragment } from "react";
import { redirect } from "next/navigation";
import { createServerComponentClient } from "@/lib/supabase";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { MobileHeader } from "@/components/journal/MobileHeader";
import { WeekStats } from "@/components/journal/WeekStats";
import { WeekDayBar } from "@/components/journal/WeekDayBar";
import { RunCard } from "@/components/journal/RunCard";
import { AddRunSheet } from "@/components/journal/AddRunSheet";
import { getRuns, weekSummary, buildRunViews } from "@/lib/runs";

const MONTHS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];

export default async function JournalPage() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth?next=/journal");

  const rows = await getRuns(supabase, user.id);
  const week = weekSummary(rows);
  const views = buildRunViews(rows);
  const totalKm = rows.reduce((s, r) => s + Number(r.distance_km), 0).toFixed(1);

  let monthLabel = "";
  if (rows.length) {
    const [y, m] = rows[0].date.split("-").map(Number);
    monthLabel = `${MONTHS[m - 1]} · ${y}`;
  }

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <MobileHeader title="Журнал" right={`${totalKm} км`} />

      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <div className="mx-auto max-w-2xl px-5 pt-6 lg:pt-10">

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
            {views.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line-default px-5 py-10 text-center">
                <p className="font-serif text-[17px] text-ink-primary">Пока нет пробежек</p>
                <p className="mt-1 text-sm text-ink-secondary">
                  Добавь первую — и она появится здесь.
                </p>
              </div>
            ) : (
              <>
                <p className="mb-2 text-xs uppercase tracking-wider text-ink-secondary">{monthLabel}</p>
                <div className="flex flex-col gap-2.5">
                  {views.map((run) => (
                    <Fragment key={run.id}>
                      {run.gapBefore && (
                        <div className="rounded-lg bg-surface-deep py-2 text-center text-xs text-ink-secondary">
                          — {run.gapBefore} —
                        </div>
                      )}
                      <RunCard run={run} />
                    </Fragment>
                  ))}
                </div>
              </>
            )}
          </section>

        </div>
      </div>
    </AppLayout>
  );
}
