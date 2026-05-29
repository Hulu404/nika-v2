import { cn } from "@/lib/utils";

type DayState = "active" | "partial" | "current" | "off";

const DAYS: { d: string; state: DayState }[] = [
  { d: "ПН", state: "active" },
  { d: "ВТ", state: "off" },
  { d: "СР", state: "active" },
  { d: "ЧТ", state: "off" },
  { d: "ПТ", state: "partial" },
  { d: "СБ", state: "off" },
  { d: "ВС", state: "current" },
];

const BAR: Record<DayState, string> = {
  active: "bg-accent",
  partial: "bg-[#C8553D]/40",
  current: "border border-dashed border-accent bg-transparent",
  off: "bg-line-default",
};

/** Полоса дней недели с индикаторами активности. */
export function WeekDayBar() {
  return (
    <div className="flex gap-2">
      {DAYS.map(({ d, state }) => (
        <div key={d} className="flex flex-1 flex-col items-center gap-1.5">
          <div className={cn("h-1.5 w-full rounded-full", BAR[state])} />
          <span className="text-[10px] text-ink-secondary">{d}</span>
        </div>
      ))}
    </div>
  );
}
