"use client";

import { useEffect } from "react";
import type { MoodKey } from "@/types/app";
import { CHECKIN_STRINGS } from "@/lib/rhythm-copy";
import { MoodChips } from "@/components/rhythm/MoodChips";

interface CheckinScreenProps {
  selected: Set<MoodKey>;
  onToggle: (key: MoodKey) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  error: string | null;
}

/**
 * Чек-ин как отдельный полноэкранный экран (мобайл) с кнопкой «назад».
 * Перекрывает таб-бар; чипы скроллятся, «Сохранить» закреплён снизу.
 */
export function CheckinScreen({ selected, onToggle, onSave, onClose, saving, error }: CheckinScreenProps) {
  // Закрытие по Esc — как у нативного «назад».
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[var(--bg-primary)]">
      <header className="sticky top-0 flex shrink-0 items-center gap-2 border-b border-line-default bg-[var(--bg-blur)] px-2 py-2 backdrop-blur-[16px]">
        <button
          type="button"
          onClick={onClose}
          aria-label={CHECKIN_STRINGS.back}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-surface-nika hover:text-ink-primary motion-reduce:transition-none"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <span className="font-serif text-[17px] font-medium text-ink-primary">{CHECKIN_STRINGS.title}</span>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <p className="max-w-[42ch] text-[15px] leading-[1.6] text-ink-secondary">{CHECKIN_STRINGS.hintMobile}</p>
        <div className="mt-6">
          <MoodChips selected={selected} onToggle={onToggle} disabled={saving} />
        </div>
        {error && <p className="mt-4 text-[14px] text-accent">{error}</p>}
      </div>

      <div className="shrink-0 border-t border-line-subtle px-6 pb-safe pt-4">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="mb-4 flex min-h-[48px] w-full items-center justify-center rounded-pill bg-accent px-5 text-[15px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 motion-reduce:transition-none"
        >
          {saving ? CHECKIN_STRINGS.saving : CHECKIN_STRINGS.save}
        </button>
      </div>
    </div>
  );
}
