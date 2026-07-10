import { cn } from "@/lib/utils";
import { parseYmd, toYmd, weekdayMon0 } from "@/lib/rhythm";
import { MONTHS_RU, RHYTHM_STRINGS, WEEKDAYS_RU } from "@/lib/rhythm-copy";

interface MonthCalendarProps {
  /** Сегодняшняя дата пользователя (YYYY-MM-DD) — задаёт видимый месяц. */
  today: string;
  markedDates: Set<string>;
  periodDates: Set<string>;
  className?: string;
}

/**
 * Календарь как запись (бриф §4.3). Прошлое и сегодня помечают известное,
 * сегодня выделен, будущие дни — только приглушённый номер, без цвета и
 * прогноза. Никакой метки «День N цикла», фаз и овуляции.
 */
export function MonthCalendar({ today, markedDates, periodDates, className }: MonthCalendarProps) {
  const todayDate = parseYmd(today);
  const year = todayDate.getFullYear();
  const month = todayDate.getMonth();

  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = weekdayMon0(first);

  const cells: (null | { ymd: string; num: number; isToday: boolean; isFuture: boolean; marked: boolean; period: boolean })[] = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const ymd = toYmd(new Date(year, month, day));
    cells.push({
      ymd,
      num: day,
      isToday: ymd === today,
      isFuture: ymd > today,
      marked: markedDates.has(ymd),
      period: periodDates.has(ymd),
    });
  }

  return (
    <section
      className={cn("rounded-card border border-line-default bg-surface-warm p-6", className)}
      aria-label={`${MONTHS_RU[month]} ${year}`}
    >
      <div className="mb-5 font-serif text-[19px] font-medium tracking-[-0.01em] text-ink-primary">
        {MONTHS_RU[month]} <span className="text-ink-muted">{year}</span>
      </div>

      <div className="mb-2 grid grid-cols-7 gap-1">
        {WEEKDAYS_RU.map((w) => (
          <div key={w} className="py-1 text-center text-[10px] uppercase tracking-wide text-ink-muted">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) =>
          c === null ? (
            <div key={`blank-${i}`} aria-hidden />
          ) : (
            <div
              key={c.ymd}
              className={cn(
                "flex aspect-square flex-col items-center justify-center gap-1 rounded-[10px]",
                c.isToday && "bg-surface-nika ring-2 ring-accent",
              )}
              aria-current={c.isToday ? "date" : undefined}
            >
              <span
                className={cn(
                  "text-[13px] leading-none",
                  c.isFuture ? "text-ink-faint" : "text-ink-primary",
                  c.isToday && "font-semibold",
                )}
              >
                {c.num}
              </span>
              {/* Маркеры — только для прошлого/сегодня; у будущего пусто. */}
              <span className="flex h-1.5 items-center gap-1">
                {!c.isFuture && c.marked && (
                  <span className="h-1.5 w-1.5 rounded-full bg-ink-secondary" aria-label={RHYTHM_STRINGS.legendMarked} />
                )}
                {!c.isFuture && c.period && (
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label={RHYTHM_STRINGS.legendPeriod} />
                )}
              </span>
            </div>
          ),
        )}
      </div>

      {/* Минимальная легенда: только факты, без «овуляции»/прогноза. */}
      <div className="mt-5 flex items-center gap-5 border-t border-line-subtle pt-4">
        <span className="flex items-center gap-2 text-[12px] text-ink-secondary">
          <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />
          {RHYTHM_STRINGS.legendPeriod}
        </span>
        <span className="flex items-center gap-2 text-[12px] text-ink-secondary">
          <span className="h-2 w-2 rounded-full bg-ink-secondary" aria-hidden />
          {RHYTHM_STRINGS.legendMarked}
        </span>
      </div>
    </section>
  );
}
