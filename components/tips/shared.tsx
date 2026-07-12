import type { TipCategory } from "@/lib/tips/data";

/**
 * Общие визуальные атомы карточки совета — используются и личной лентой PRO
 * (TipsContent), и базовой лентой FREE (BasicTips). Чистая презентация.
 */

/** before/breathing/recovery/mindset: лёгкий accent-тон кружка; technique/gear нейтральный. */
export const CATEGORY_ACCENT_TINT: Record<TipCategory, boolean> = {
  before: true,
  technique: false,
  breathing: true,
  gear: false,
  recovery: true,
  mindset: true,
};

export function CatIcon({ category }: { category: TipCategory }) {
  const common = { width: 18, height: 18, viewBox: "0 0 20 20", fill: "none", "aria-hidden": true } as const;
  switch (category) {
    case "before":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 6V10L13 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "technique":
      return (
        <svg {...common}>
          <path d="M6 5L10 10L6 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M11 5L15 10L11 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "breathing":
      return (
        <svg {...common}>
          <path d="M3 7H12A2 2 0 1 0 10 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M3 10.5H14A2 2 0 1 1 12 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M3 14H9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "gear":
      return (
        <svg {...common}>
          <path d="M3 14C3 12 5 11 7 11C8 9 10 8 12 8C14 8 16 9 17 11.5V14C17 15 16.2 15.5 15.2 15.5H4.2C3.5 15.5 3 15 3 14Z"
            stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      );
    case "recovery":
      return (
        <svg {...common}>
          <path d="M14.5 4A7 7 0 1 0 14.5 16A5.5 5.5 0 0 1 14.5 4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      );
    case "mindset":
      return (
        <svg {...common}>
          <path d="M10 3L11.6 7.6L16.4 8.1L12.8 11.2L13.9 16L10 13.4L6.1 16L7.2 11.2L3.6 8.1L8.4 7.6Z"
            stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      );
  }
}

/** Кружок-иконка категории с тинтом. Общий для карточек обеих лент. */
export function CategoryChip({ category }: { category: TipCategory }) {
  return (
    <span
      className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-accent-deep"
      style={{
        background: CATEGORY_ACCENT_TINT[category]
          ? "color-mix(in srgb, var(--accent) 14%, transparent)"
          : "color-mix(in srgb, var(--ink-primary) 6%, transparent)",
      }}
      aria-hidden
    >
      <CatIcon category={category} />
    </span>
  );
}
