import Link from "next/link";

/** Шапка для мобильного: назад · заголовок · правый текст. Только < lg. */
export function MobileHeader({ title, right }: { title: string; right?: string }) {
  return (
    <header className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-line-subtle bg-[var(--bg-blur)] px-4 py-3 backdrop-blur-[16px] lg:hidden">
      <Link
        href="/day1"
        aria-label="Назад"
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center -ml-1 rounded-full text-ink-secondary transition-colors hover:bg-surface-nika hover:text-ink-primary"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
      <span className="flex-1 text-center font-semibold text-ink-primary">{title}</span>
      <span className="min-w-[3.5rem] text-right text-sm text-ink-secondary">{right ?? ""}</span>
    </header>
  );
}
