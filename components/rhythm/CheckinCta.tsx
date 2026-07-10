"use client";

import { RHYTHM_STRINGS } from "@/lib/rhythm-copy";

interface CheckinCtaProps {
  onOpen: () => void;
  className?: string;
}

/** Мобильная CTA-карточка: открывает отдельный экран чек-ина. */
export function CheckinCta({ onOpen, className }: CheckinCtaProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={
        "flex min-h-[44px] w-full flex-col items-start gap-1 rounded-card border border-line-default bg-surface-nika p-5 text-left transition-colors hover:border-line-strong motion-reduce:transition-none " +
        (className ?? "")
      }
    >
      <span className="font-serif text-[18px] font-medium text-ink-primary">{RHYTHM_STRINGS.ctaTitle}</span>
      <span className="text-[13.5px] text-ink-secondary">{RHYTHM_STRINGS.ctaSubtitle}</span>
    </button>
  );
}
