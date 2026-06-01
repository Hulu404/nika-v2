import Link from "next/link";

export function SuggestionChips({
  chips,
  openHref = "/chat/morning",
}: {
  chips: string[];
  openHref?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Горизонтальный скролл чипов */}
      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 scrollbar-none lg:mx-0 lg:flex-wrap lg:px-0">
        {chips.map((c) => (
          <Link
            key={c}
            href={openHref}
            className="flex-shrink-0 whitespace-nowrap rounded-pill border border-line-default bg-elevated px-4 py-2.5 text-[13px] text-ink-secondary transition-all hover:border-ink-primary hover:text-ink-primary"
          >
            {c}
          </Link>
        ))}
      </div>
      {/* Кнопка "Открыть разговор" — полная ширина на мобайле, inline на десктопе */}
      <Link
        href={openHref}
        className="flex w-full items-center justify-center gap-2 rounded-pill bg-ink-primary px-5 py-3.5 text-[14px] font-medium text-canvas transition-colors hover:bg-accent lg:w-auto lg:self-start"
      >
        Открыть разговор
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </div>
  );
}
