export function QuoteCard({ quote }: { quote: string }) {
  return (
    <div className="col-span-1 sm:col-span-2 rounded-card bg-surface-nika px-6 py-5">
      <div className="flex gap-4">
        {/* Левая вертикальная линия 2px */}
        <div className="w-[2px] flex-shrink-0 self-stretch rounded-full bg-accent/50" />

        {/* Контент */}
        <div className="min-w-0 flex-1">
          <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-accent">
            На сегодня
          </p>
          <p className="font-serif text-[22px] italic leading-[1.35] tracking-[-0.01em] text-ink-primary">
            {quote}
          </p>
        </div>
      </div>
    </div>
  );
}
