import type { ChartDay } from "@/lib/analytics";
import type { RunIntensity } from "@/types/app";

// Цвета/высота по интенсивности — фиксированные (это визуализация).
const STYLE: Record<RunIntensity, { color: string; h: number; label: string }> = {
  easy: { color: "#EDADA0", h: 35, label: "легко" },
  medium: { color: "#C8553D", h: 60, label: "средне" },
  hard: { color: "#7A2E1F", h: 85, label: "тяжело" },
};

function DayColumn({ day }: { day: ChartDay }) {
  const s = day.intensity ? STYLE[day.intensity] : null;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex h-24 items-end">
        {s ? (
          <div style={{ height: `${s.h}%`, backgroundColor: s.color }} className="w-3.5 rounded-t-sm sm:w-5" />
        ) : (
          <div className="h-1.5 w-1.5 rounded-full border border-ink-muted" />
        )}
      </div>
      <span className="text-[10px] uppercase text-ink-secondary">{day.label}</span>
    </div>
  );
}

function Legend() {
  const items = [
    { label: "легко", color: STYLE.easy.color },
    { label: "средне", color: STYLE.medium.color },
    { label: "тяжело", color: STYLE.hard.color },
    { label: "не было", outline: true },
  ];
  return (
    <div className="mt-3 flex flex-wrap gap-4">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-xs text-ink-secondary">
          <span
            className="h-2 w-2 rounded-sm"
            style={"outline" in it && it.outline ? { border: "1px solid var(--ink-muted)" } : { backgroundColor: it.color }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function MoodBarChart({ days }: { days: ChartDay[] }) {
  const week1 = days.slice(0, 7);
  const week2 = days.slice(7);
  return (
    <div>
      <div className="overflow-x-auto">
        <div className="flex gap-6">
          {[week1, week2].map((week, wi) => (
            <div key={wi} className="flex gap-1.5 sm:gap-2">
              {week.map((day, i) => (
                <DayColumn key={`${wi}-${i}`} day={day} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <Legend />
    </div>
  );
}
