/** Информационный блок (только мобиль). */
export function InfoNote() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[#C8553D]/30 bg-surface-nika p-4 lg:hidden">
      <svg
        width="18"
        height="18"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden
        className="mt-0.5 flex-shrink-0 text-[#E8977A]"
      >
        <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 9v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="10" cy="6.4" r="0.9" fill="currentColor" />
      </svg>
      <p className="text-sm leading-relaxed text-ink-secondary">
        Я <em className="italic">не диагностирую</em> и не сужу состояние. Просто показываю что
        чаще встречалось — на случай если хочешь это увидеть со стороны.
      </p>
    </div>
  );
}
