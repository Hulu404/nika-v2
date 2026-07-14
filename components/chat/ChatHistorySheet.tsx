'use client';

import { useState } from 'react';
import Link from 'next/link';

export interface ConvoItem {
  href: string;
  label: string;
  time: string;
}

export function ChatHistoryButton({ convos }: { convos: ConvoItem[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        aria-label="История диалогов"
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-ink-secondary hover:bg-[var(--surface-nika)] transition-colors"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.4" />
          <path d="M7 7.5h6M7 10h4M7 12.5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-5 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-[380px] rounded-2xl bg-[var(--bg-elevated)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[var(--border-subtle)]">
              <p className="font-serif text-[17px] font-medium text-ink-primary">История диалогов</p>
              <button
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-secondary hover:bg-[var(--surface-nika)]"
                aria-label="Закрыть"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="px-2 py-2">
              {convos.length === 0 ? (
                <p className="py-6 text-center font-serif text-[14px] italic text-ink-muted">
                  Диалогов пока нет
                </p>
              ) : (
                <div className="flex flex-col">
                  {convos.map((c) => (
                    <Link
                      key={c.href}
                      href={c.href}
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between rounded-xl px-3 py-3 transition-colors hover:bg-[var(--surface-nika)]"
                    >
                      <span className="flex-1 text-[14px] text-ink-primary leading-snug line-clamp-1">{c.label}</span>
                      <span className="ml-4 shrink-0 text-[12px] text-ink-muted">{c.time}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
