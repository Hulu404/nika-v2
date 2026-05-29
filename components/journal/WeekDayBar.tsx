import { cn } from "@/lib/utils";

const LABELS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];

/**
 * Полоса дней недели. Активные (есть пробежка) — терракотовая линия;
 * сегодня без пробежки — пунктир; остальные — приглушённая линия.
 */
export function WeekDayBar({
  activeWeekdays,
  today,
}: {
  activeWeekdays: number[];
  today: number;
}) {
  const active = new Set(activeWeekdays);
  return (
    <div className="flex gap-2">
      {LABELS.map((label, i) => {
        const state = active.has(i) ? "active" : i === today ? "current" : "off";
        return (
          <div key={label} className="flex flex-1 flex-col items-center gap-1.5">
            <div
              className={cn(
                "h-1.5 w-full rounded-full",
                state === "active"
                  ? "bg-accent"
                  : state === "current"
                    ? "border border-dashed border-accent bg-transparent"
                    : "bg-line-default",
              )}
            />
            <span className={cn("text-[10px]", i === today ? "text-accent" : "text-ink-secondary")}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
