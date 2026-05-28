"use client";

export function QuickReplies({
  suggestions,
  onSelect,
  disabled,
}: {
  suggestions: string[];
  onSelect: (text: string) => void;
  disabled?: boolean;
}) {
  if (!suggestions.length) return null;

  return (
    <div className="flex gap-2 overflow-x-auto px-4 py-2 scroll-smooth no-scrollbar">
      {suggestions.map((s) => (
        <button
          key={s}
          onClick={() => onSelect(s)}
          disabled={disabled}
          className="flex-shrink-0 whitespace-nowrap rounded-pill border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-[9px] text-[13px] text-ink-primary transition-all hover:border-ink-primary active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
        >
          {s}
        </button>
      ))}
      <style>{`.no-scrollbar::-webkit-scrollbar { display: none; } .no-scrollbar { scrollbar-width: none; }`}</style>
    </div>
  );
}
