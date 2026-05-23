"use client";

import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { useAutoResizeTextarea } from "@/hooks/useAutoResizeTextarea";

export function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const { ref, resize } = useAutoResizeTextarea();

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (ref.current) ref.current.style.height = "auto";
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter — отправить, Shift+Enter — перенос строки.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="shrink-0 border-t border-ink-muted/10 bg-canvas/80 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-end gap-2 px-4 py-3">
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
          className="max-h-40 flex-1 resize-none overflow-y-auto rounded-bubble bg-surface-warm px-4 py-3 text-[15px] text-ink-primary outline-none transition placeholder:text-ink-muted focus:ring-2 focus:ring-accent/40"
        />
        <Button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          pill
          aria-label="Отправить"
          className="h-11 w-11 shrink-0 p-0"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </Button>
      </div>
    </div>
  );
}
