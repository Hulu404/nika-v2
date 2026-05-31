import { cn } from "@/lib/utils";
import type { WeekDayState } from "@/lib/today";

const STYLES: Record<WeekDayState, string> = {
  done: "bg-accent border-accent text-white",
  today: "border-accent text-accent shadow-[0_0_0_3px_rgba(200,85,61,0.10)]",
  empty: "border-line-strong text-ink-muted",
};

export function WeekRibbon({ days }: { days: { label: string; state: WeekDayState }[] }) {
  return (
    <div className="flex gap-1.5">
      {days.map((d, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
          <div className={cn(
            "flex h-[26px] w-[26px] items-center justify-center rounded-full border-[1.5px] font-mono text-[10px]",
            STYLES[d.state],
          )}>
            {d.state === "done" ? "✓" : "·"}
          </div>
          <span className="text-[9.5px] font-medium uppercase tracking-[0.06em] text-ink-muted">
            {d.label}
          </span>
        </div>
      ))}
    </div>
  );
}
