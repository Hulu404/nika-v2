"use client";

import { useState } from "react";
import { BottomSheet } from "@/components/BottomSheet";
import { RHYTHM_SETTINGS_STRINGS as S } from "@/lib/rhythm-copy";

interface RhythmSettingsProps {
  /** Выгрузка JSON. Возвращает текст ошибки или null. */
  onExport: () => Promise<string | null>;
  /** Полное удаление данных раздела. Возвращает текст ошибки или null. */
  onDelete: () => Promise<string | null>;
}

/**
 * Настройки раздела «Мой ритм»: дисклеймер (не мед. сервис), экспорт данных и
 * удаление в один тап с коротким подтверждением. После удаления раздел
 * возвращается в состояние «первый вход» (родитель сбрасывает состояние).
 */
export function RhythmSettings({ onExport, onDelete }: RhythmSettingsProps) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setConfirming(false);
    setError(null);
  };

  async function handleExport() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await onExport();
    setBusy(false);
    if (err) setError(err);
  }

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await onDelete();
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setOpen(false);
    setConfirming(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-pill border border-line-default px-5 text-[14px] font-medium text-ink-secondary transition-colors hover:bg-surface-nika motion-reduce:transition-none"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        {S.title}
      </button>

      <BottomSheet isOpen={open} onClose={close} title={S.title}>
        {/* Дисклеймер (не мед. сервис) */}
        <p className="rounded-card bg-surface-nika p-4 text-[13px] leading-[1.6] text-ink-secondary">
          {S.disclaimer}
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={busy}
            className="flex min-h-[48px] w-full items-center justify-between rounded-card border border-line-default px-4 text-[15px] text-ink-primary transition-colors hover:bg-surface-warm disabled:opacity-50 motion-reduce:transition-none"
          >
            {S.export}
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden className="text-ink-muted">
              <path d="M9 2v9M5 8l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 15h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>

          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={busy}
              className="flex min-h-[48px] w-full items-center rounded-card border border-line-default px-4 text-left text-[15px] text-accent transition-colors hover:bg-surface-warm disabled:opacity-50 motion-reduce:transition-none"
            >
              {S.deleteItem}
            </button>
          ) : (
            <div className="rounded-card border border-line-default p-4">
              <p className="text-[14px] leading-[1.6] text-ink-primary">{S.deleteConfirm}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="min-h-[44px] flex-1 rounded-pill border border-line-default text-[14px] font-medium text-ink-primary transition-colors hover:bg-surface-nika disabled:opacity-50 motion-reduce:transition-none"
                >
                  {S.cancel}
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={busy}
                  className="min-h-[44px] flex-[1.3] rounded-pill bg-accent text-[14px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 motion-reduce:transition-none"
                >
                  {busy ? "Удаляем…" : S.deleteYes}
                </button>
              </div>
            </div>
          )}
        </div>

        {error && <p className="mt-3 text-[13px] text-accent">{error}</p>}
      </BottomSheet>
    </>
  );
}
