"use client";

import { getPhase, PHASE_META, type Phase } from "@/lib/rhythm/cycles";
import { cn } from "@/lib/utils";

const PHASE_COLOR: Record<Phase, string> = {
  menses: "var(--ph-menses)",
  rise: "var(--ph-rise)",
  peak: "var(--ph-peak)",
  slow: "var(--ph-slow)",
};

interface CycleGridProps {
  cycleLen: number;
  cycleDay: number; // текущий день (1-based)
}

export function CycleGrid({ cycleLen, cycleDay }: CycleGridProps) {
  const weeks: number[][] = [];
  for (let i = 1; i <= cycleLen; i += 7) {
    weeks.push(Array.from({ length: Math.min(7, cycleLen - i + 1) }, (_, j) => i + j));
  }

  return (
    <div className="rounded-card border border-line-subtle bg-elevated p-4">
      {weeks.map((days, wi) => (
        <div key={wi} className="mb-3 last:mb-0">
          <div className="mb-2 text-[10.5px] font-medium text-ink-muted">
            Дни {days[0]}–{days[days.length - 1]}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {days.map((day) => {
              const phase = getPhase(day, cycleLen);
              const isToday = day === cycleDay;
              const isFuture = day > cycleDay;
              return (
                <div
                  key={day}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-[8px] py-1.5",
                    isToday && "bg-surface-warm",
                  )}
                >
                  <span
                    className="h-3 w-3 rounded-full flex-shrink-0"
                    style={{
                      background: PHASE_COLOR[phase],
                      opacity: isFuture ? 0.32 : 1,
                    }}
                  />
                  <span
                    className={cn(
                      "text-[10px]",
                      isToday ? "font-semibold text-accent-deep" : "text-ink-muted",
                    )}
                  >
                    {day}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Легенда */}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 border-t border-line-subtle pt-3">
        {(["menses", "rise", "peak", "slow"] as Phase[]).map((ph) => (
          <span key={ph} className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <i
              className="h-2 w-2 rounded-full flex-shrink-0 inline-block"
              style={{ background: PHASE_COLOR[ph] }}
            />
            {PHASE_META[ph].labelRu.toLowerCase()}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <i className="h-2 w-2 rounded-full flex-shrink-0 inline-block bg-ink-faint opacity-50" />
          впереди
        </span>
      </div>
    </div>
  );
}
