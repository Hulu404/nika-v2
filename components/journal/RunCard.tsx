export interface Run {
  id: string;
  date: number;
  month: string;
  distance: string;
  duration: string;
  intensity: string;
  quote: string;
  pace: string;
  /** Если задано — перед карточкой рисуется разделитель «N дней перерыв». */
  gapBefore?: string;
}

export function RunCard({ run }: { run: Run }) {
  return (
    <div className="group flex cursor-pointer items-center gap-4 rounded-xl border border-line-default bg-elevated px-4 py-3.5 shadow-soft transition-colors hover:border-line-strong">
      {/* Дата */}
      <div className="w-12 flex-shrink-0 text-center">
        <div className="text-[28px] font-bold leading-none text-ink-primary">{run.date}</div>
        <div className="mt-1 text-xs uppercase tracking-wide text-ink-secondary">{run.month}</div>
      </div>

      {/* Контент */}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink-primary">
          {run.distance} км · {run.duration} · {run.intensity}
        </div>
        <div className="mt-0.5 truncate text-xs italic text-ink-secondary">«{run.quote}»</div>
      </div>

      {/* Темп */}
      <div className="flex-shrink-0 text-right">
        <div className="text-sm font-medium text-ink-muted">{run.pace}</div>
        <span className="block text-[10px] text-ink-muted">/КМ</span>
      </div>

      {/* Стрелка */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden
        className="ml-1 flex-shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5"
      >
        <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
