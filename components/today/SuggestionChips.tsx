import Link from "next/link";

export function SuggestionChips({
  chips,
  openHref = "/chat/morning",
}: {
  chips: string[];
  openHref?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <Link
          key={c}
          href={openHref}
          className="flex-shrink-0 whitespace-nowrap rounded-pill border border-line-default bg-elevated px-4 py-2.5 text-[13px] text-ink-secondary transition-all hover:border-ink-primary hover:text-ink-primary"
        >
          {c}
        </Link>
      ))}
      <Link
        href={openHref}
        className="flex items-center gap-2 rounded-pill bg-ink-primary px-5 py-3 text-[13.5px] font-medium text-canvas transition-colors hover:bg-accent"
      >
        Открыть разговор
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </div>
  );
}
