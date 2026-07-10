import { cn } from "@/lib/utils";
import { parseYmd, toYmd, weekdayMon0 } from "@/lib/rhythm";
import { RHYTHM_STRINGS, WEEKDAYS_RU } from "@/lib/rhythm-copy";

interface WeekStripProps {
  /** Сегодняшняя дата пользователя (YYYY-MM-DD). */
  today: string;
  /** Даты с отметкой состояния. */
  markedDates: Set<string>;
  /** Даты с отметкой месячных (опционально). */
  periodDates: Set<string>;
  className?: string;
}

/**
 * Недельная полоса-запись (Пн..Вс). Дни с отметкой помечены, сегодня в фокусе,
 * будущие — пустые с пунктиром. Это запись, а не прогноз: ничего не кликается и
 * будущее ничего не предсказывает.
 */
export function WeekStrip({ today, markedDates, periodDates, className }: WeekStripProps) {
  const todayDate = parseYmd(today);
  const monday = new Date(todayDate);
  monday.setDate(todayDate.getDate() - weekdayMon0(todayDate));

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const ymd = toYmd(d);
    return {
      ymd,
      num: d.getDate(),
      isToday: ymd === today,
      isFuture: ymd > today,
      marked: markedDates.has(ymd),
      period: periodDates.has(ymd),
    };
  });

  return (
    <section
      className={cn("rounded-card border border-line-default bg-surface-warm p-5", className)}
      aria-label={RHYTHM_STRINGS.weekTitle}
    >
      <div className="mb-4 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
        {RHYTHM_STRINGS.weekTitle}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((d, i) => (
          <div key={d.ymd} className="flex flex-col items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-ink-muted">{WEEKDAYS_RU[i]}</span>
            <span
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full text-[13px]",
                d.isFuture
                  ? "border border-dashed border-line-strong text-ink-faint"
                  : d.marked
                    ? "bg-ink-primary font-medium text-canvas"
                    : "text-ink-secondary",
                d.isToday && "ring-2 ring-accent ring-offset-2 ring-offset-[var(--surface-warm)]",
              )}
              aria-current={d.isToday ? "date" : undefined}
            >
              {d.num}
            </span>
            {/* Отметка месячных — только факт; спейсер держит сетку ровной. */}
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                d.period && !d.isFuture ? "bg-accent" : "bg-transparent",
              )}
              aria-hidden
            />
          </div>
        ))}
      </div>
    </section>
  );
}
