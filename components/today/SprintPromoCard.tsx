import Link from "next/link";

export function SprintPromoCard() {
  return (
    <div className="col-span-2 rounded-card border border-accent/20 bg-surface-nika p-[18px]">
      {/* Лейбл */}
      <div className="mb-3 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-accent">
        <svg width="13" height="13" viewBox="0 0 18 18" fill="none" aria-hidden>
          <path d="M9 2v4M13.5 4.5l-3 2.5M15 9h-4M13.5 13.5l-3-2.5M9 16v-4M4.5 13.5l3-2.5M3 9h4M4.5 4.5l3 2.5"
            stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        Про · Спринт
      </div>

      {/* Заголовок */}
      <p className="mb-1 font-serif text-[18px] leading-[1.3] tracking-[-0.01em] text-ink-primary lg:text-[20px]">
        21 день с целью — <em className="italic text-accent">вместе с НИКОЙ</em>
      </p>

      {/* Описание */}
      <p className="mt-2 text-[13px] leading-[1.5] text-ink-secondary">
        Спринт помогает сфокусироваться на одной цели и не потерять её через неделю. Квиз, архетип, ориентиры — и НИКА знает, что тебе сейчас важно.
      </p>

      {/* CTA */}
      <Link
        href="/sprint/setup"
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 active:opacity-80"
      >
        Начать спринт
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </div>
  );
}
