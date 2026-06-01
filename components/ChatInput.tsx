"use client";

import { useState, type KeyboardEvent } from "react";
import { useAutoResizeTextarea } from "@/hooks/useAutoResizeTextarea";
import { ScenarioSheet } from "@/components/ScenarioSheet";

export function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const [showSheet, setShowSheet] = useState(false);
  const { ref, resize } = useAutoResizeTextarea();

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (ref.current) ref.current.style.height = "auto";
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const canSend = !disabled && value.trim().length > 0;

  return (
    <>
      <div className="shrink-0 border-t border-line-subtle bg-[var(--bg-blur-strong)] px-[14px] pb-8 pt-3 backdrop-blur-[16px]">
        <div className="flex items-end gap-2.5">

          {/* Кнопка нового сценария */}
          <button
            type="button"
            aria-label="Новый разговор"
            onClick={() => setShowSheet(true)}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-surface-nika hover:text-ink-primary"
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
              <path d="M11 5V17M5 11H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>

          {/* Поле ввода */}
          <div className="flex flex-1 items-center rounded-[22px] border border-line-default bg-elevated px-[14px] transition-colors focus-within:border-ink-primary">
            <textarea
              ref={ref}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                resize();
              }}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Напиши НИКЕ…"
              className="max-h-40 flex-1 resize-none overflow-y-auto bg-transparent py-3 text-[15px] text-ink-primary outline-none placeholder:text-ink-muted"
            />
          </div>

          {/* Кнопка отправки */}
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="Отправить"
            className={[
              "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-all",
              canSend
                ? "bg-ink-primary text-canvas hover:bg-accent active:scale-95"
                : "bg-ink-faint text-canvas",
            ].join(" ")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 13V3M3 8L8 3L13 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      <ScenarioSheet isOpen={showSheet} onClose={() => setShowSheet(false)} />
    </>
  );
}
