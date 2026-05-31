function Cap({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
      <svg width="13" height="13" viewBox="0 0 18 18" fill="none" aria-hidden className="text-accent">
        <path d="M9 2l2 4.6 5 .5-3.7 3.5 1 5L9 13l-4.4 2.6 1-5L2 7.1l5-.5L9 2Z"
          stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      {children}
    </div>
  );
}

function plural(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return "дней";
  if (m10 === 1) return "день";
  if (m10 >= 2 && m10 <= 4) return "дня";
  return "дней";
}

export function StreakCard({ days }: { days: number }) {
  return (
    <div className="rounded-2xl border border-line-subtle bg-elevated p-[18px]">
      <Cap>Стрик</Cap>
      <div className="font-serif text-[34px] font-medium leading-none tracking-[-0.02em] text-ink-primary">
        {days}<small className="text-[14px] font-normal text-ink-muted"> {plural(days)}</small>
      </div>
      <div className="mt-2 text-[12.5px] leading-[1.45] text-ink-secondary">
        {days > 0
          ? "Ты пишешь НИКЕ почти каждый день. Это и есть привычка."
          : "Пока без стрика. Напиши — и счётчик пойдёт."}
      </div>
    </div>
  );
}
