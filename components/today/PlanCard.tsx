export function PlanCard({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="col-span-1 flex items-center gap-4 rounded-2xl border border-[rgba(200,85,61,0.18)] bg-surface-warm p-[18px] sm:col-span-2">
      {/* Иконка */}
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[14px] border border-[rgba(200,85,61,0.16)] bg-elevated text-accent">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M3 17l6-6 4 4 8-8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M16 7h5v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {/* Текст */}
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent-deep">
          План на сегодня
        </div>
        <div className="font-serif text-[17px] font-medium tracking-[-0.01em] text-ink-primary">
          {title}
        </div>
        <div className="mt-0.5 text-[12.5px] text-ink-secondary">{subtitle}</div>
      </div>
    </div>
  );
}
