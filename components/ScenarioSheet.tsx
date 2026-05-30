"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet } from "@/components/BottomSheet";
import { ALL_SCENARIOS, SCENARIO_META } from "@/lib/scenarios";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ReactNode> = {
  general: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M3 13V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6l-3 3v-5Z"
        stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  ),
  morning: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  after_run: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M4 10l4 4 8-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  after_skip: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 7v3.5M10 13.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  pre_race: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M10 3l1.8 3.6 3.9.6-2.8 2.7.7 3.9L10 12l-3.6 1.8.7-3.9L4.3 7.2l3.9-.6L10 3z"
        stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  ),
  after_failure: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M10 17c-4-2.5-7-5.5-7-9a7 7 0 0 1 14 0c0 3.5-3 6.5-7 9z"
        stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  ),
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function ScenarioSheet({ isOpen, onClose }: Props) {
  const router = useRouter();

  const handleSelect = useCallback((scenario: string) => {
    onClose();
    router.push(`/chat/${scenario}?new=1`);
  }, [onClose, router]);

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Новый разговор">
      <div className="flex flex-col gap-2.5">
        {ALL_SCENARIOS.map((key) => {
          const meta = SCENARIO_META[key];
          return (
            <button
              key={key}
              onClick={() => handleSelect(key)}
              className={cn(
                "flex items-center gap-4 rounded-[14px] border border-line-default bg-canvas px-4 py-4 text-left",
                "transition-all hover:border-accent/30 hover:bg-surface-warm active:scale-[0.99]",
              )}
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] bg-surface-nika text-ink-secondary">
                {ICONS[key]}
              </div>
              <div className="flex-1">
                <p className="text-[15px] font-medium text-ink-primary">{meta.title}</p>
                <p className="mt-0.5 text-[12px] text-ink-muted">{meta.subtitle}</p>
              </div>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0 text-ink-faint">
                <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}
