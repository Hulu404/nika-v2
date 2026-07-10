"use client";

import type { MoodKey } from "@/types/app";
import { CHECKIN_STRINGS } from "@/lib/rhythm-copy";
import { MoodChips } from "@/components/rhythm/MoodChips";

interface CheckinCardProps {
  selected: Set<MoodKey>;
  onToggle: (key: MoodKey) => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  className?: string;
}

/** Чек-ин как карточка правого рейла (десктоп). */
export function CheckinCard({ selected, onToggle, onSave, saving, error, className }: CheckinCardProps) {
  return (
    <section className={className}>
      <div className="rounded-card border border-line-default bg-elevated p-5 shadow-soft">
        <h2 className="font-serif text-[18px] font-medium text-ink-primary">{CHECKIN_STRINGS.title}</h2>
        <p className="mt-1.5 text-[13.5px] leading-[1.5] text-ink-secondary">{CHECKIN_STRINGS.hintDesktop}</p>

        <div className="mt-4">
          <MoodChips selected={selected} onToggle={onToggle} disabled={saving} />
        </div>

        {error && <p className="mt-3 text-[13px] text-accent">{error}</p>}

        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="mt-5 flex min-h-[44px] w-full items-center justify-center rounded-pill bg-accent px-5 text-[15px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 motion-reduce:transition-none"
        >
          {saving ? CHECKIN_STRINGS.saving : CHECKIN_STRINGS.save}
        </button>
      </div>
    </section>
  );
}
