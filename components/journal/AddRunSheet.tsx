"use client";

import { useState } from "react";
import { RunSheet } from "./RunSheet";

export function AddRunSheet({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-pill bg-ink-primary text-[15px] font-medium text-canvas transition-colors hover:bg-accent"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        Добавить пробежку
      </button>

      <RunSheet open={open} onClose={() => setOpen(false)} mode="add" userId={userId} />
    </>
  );
}
