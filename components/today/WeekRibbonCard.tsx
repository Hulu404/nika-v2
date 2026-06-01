import { WeekRibbon } from "@/components/today/WeekRibbon";
import type { WeekDayState } from "@/lib/today";

function Cap({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
      <svg width="13" height="13" viewBox="0 0 18 18" fill="none" aria-hidden className="text-accent">
        <path d="M3 14l4-4 3 3 5-6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </div>
  );
}

export function WeekRibbonCard({
  days,
}: {
  days: { label: string; state: WeekDayState }[];
}) {
  return (
    <div className="col-span-2 rounded-2xl border border-line-subtle bg-elevated p-[18px]">
      <Cap>Эта неделя</Cap>
      <WeekRibbon days={days} />
    </div>
  );
}
