import Link from "next/link";
import { sprintDay } from "@/lib/sprint";
import type { Sprint } from "@/types/app";

interface Props {
  sprint: Sprint;
}

const TOTAL_DAYS = 21;

function DayDots({ day }: { day: number }) {
  return (
    <div className="flex flex-wrap gap-[3px]">
      {Array.from({ length: TOTAL_DAYS }, (_, i) => (
        <span
          key={i}
          className={
            i < day
              ? "h-[6px] w-[6px] rounded-full bg-accent"
              : "h-[6px] w-[6px] rounded-full bg-line-subtle"
          }
        />
      ))}
    </div>
  );
}

export function SprintActiveCard({ sprint }: Props) {
  const day = sprintDay(sprint);
  const clampedDay = Math.min(day, TOTAL_DAYS);

  const achieved = sprint.milestones_enabled
    ? sprint.milestones.filter((m) => m.achieved_at).length
    : null;
  const total = sprint.milestones_enabled ? sprint.milestones.length : null;

  return (
    <Link href="/sprint" className="col-span-2 block rounded-card border border-accent/20 bg-surface-nika p-[18px] transition-opacity hover:opacity-90">
      {/* Лейбл + день */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-accent">
          <svg width="13" height="13" viewBox="0 0 18 18" fill="none" aria-hidden>
            <path d="M9 2v4M13.5 4.5l-3 2.5M15 9h-4M13.5 13.5l-3-2.5M9 16v-4M4.5 13.5l3-2.5M3 9h4M4.5 4.5l3 2.5"
              stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          Спринт
        </div>
        <span className="font-mono text-[11px] text-ink-muted">
          День {clampedDay}/{TOTAL_DAYS}
        </span>
      </div>

      {/* Цель */}
      <p className="mb-3 font-serif text-[17px] leading-[1.35] tracking-[-0.01em] text-ink-primary">
        {sprint.goal_text}
      </p>

      {/* Точки прогресса */}
      <DayDots day={clampedDay} />

      {/* Ориентиры */}
      {achieved !== null && total !== null && total > 0 && (
        <p className="mt-3 text-[12px] text-ink-secondary">
          Ориентиры: {achieved} из {total}
        </p>
      )}
    </Link>
  );
}
