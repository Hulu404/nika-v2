import { Fragment } from "react";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { MobileHeader } from "@/components/journal/MobileHeader";
import { WeekStats } from "@/components/journal/WeekStats";
import { WeekDayBar } from "@/components/journal/WeekDayBar";
import { RunCard, type Run } from "@/components/journal/RunCard";

// Пока mock — модели пробежек в БД ещё нет.
const runs: Run[] = [
  { id: "1", date: 12, month: "МАЙ", distance: "4.2", duration: "28 мин", intensity: "легко", quote: "сегодня было тяжело первые 10 минут", pace: "6:40" },
  { id: "2", date: 10, month: "МАЙ", distance: "3.5", duration: "24 мин", intensity: "средне", quote: "первый раз без остановок!", pace: "6:51" },
  { id: "3", date: 8, month: "МАЙ", distance: "4.7", duration: "31 мин", intensity: "легко", quote: "дождь, но было даже хорошо", pace: "6:36" },
  { id: "4", date: 3, month: "МАЙ", distance: "2.8", duration: "22 мин", intensity: "тяжело", quote: "колено побаливало, остановился пораньше", pace: "7:51", gapBefore: "4 дня перерыв" },
];

export default function JournalPage() {
  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <MobileHeader title="Журнал" right="14 дней" />

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
              Три пробежки. <span className="italic text-accent">Хороший ритм.</span>
            </p>
            <div className="mt-4">
              <WeekStats />
            </div>
            <div className="mt-4">
              <WeekDayBar />
            </div>
          </section>

          {/* Список пробежек */}
          <section className="mt-6">
            <p className="mb-2 text-xs uppercase tracking-wider text-ink-secondary">Май · 2026</p>
            <div className="flex flex-col gap-2.5">
              {runs.map((run) => (
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
          </section>

        </div>
      </div>
    </AppLayout>
  );
}
