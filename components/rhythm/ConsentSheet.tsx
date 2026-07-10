"use client";

import { CONSENT_STRINGS } from "@/lib/rhythm-copy";

interface ConsentSheetProps {
  onAccept: () => void;
  onDismiss: () => void;
  busy?: boolean;
}

/**
 * Одноразовое согласие на хранение чувствительных данных раздела (152-ФЗ).
 * Показывается перед первой записью. «Хорошо, храни» → фиксируем согласие и
 * пишем; «Не сейчас» → закрываем без записи (раздел остаётся в режиме просмотра).
 */
export function ConsentSheet({ onAccept, onDismiss, busy }: ConsentSheetProps) {
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" role="dialog" aria-modal aria-labelledby="rhythm-consent-title">
      <div className="absolute inset-0 bg-black/40" onClick={() => !busy && onDismiss()} />

      <div className="relative z-10 w-full max-w-md rounded-t-3xl bg-elevated p-6 shadow-card sm:rounded-3xl">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong sm:hidden" />

        <h2 id="rhythm-consent-title" className="font-serif text-xl font-medium text-ink-primary">
          {CONSENT_STRINGS.title}
        </h2>
        <p className="mt-3 text-[15px] leading-[1.6] text-ink-secondary">{CONSENT_STRINGS.body}</p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={onAccept}
            disabled={busy}
            className="flex min-h-[44px] w-full items-center justify-center rounded-pill bg-accent px-5 text-[15px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 motion-reduce:transition-none"
          >
            {CONSENT_STRINGS.accept}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="flex min-h-[44px] w-full items-center justify-center rounded-pill border border-line-default px-5 text-[15px] font-medium text-ink-primary transition-colors hover:bg-surface-nika disabled:opacity-50 motion-reduce:transition-none"
          >
            {CONSENT_STRINGS.dismiss}
          </button>
        </div>
      </div>
    </div>
  );
}
