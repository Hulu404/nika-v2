"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RHYTHM_STRINGS } from "@/lib/rhythm-copy";

interface TodayPanelProps {
  /** Текст пузыря «Ника сегодня» (короткая реплика бакета). */
  message: string;
  /** Диплинк в Чат с контекстом дня. */
  discussHref: string;
  /** Клик по «Обсудить в чате» — для аналитики (без сырого состояния). */
  onDiscuss?: () => void;
  className?: string;
}

/** Реальное время «сегодня, 9:14» — считается на клиенте после монтирования,
 *  чтобы не ловить рассинхрон гидрации между сервером и браузером. */
function useNowLabel(): string | null {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const now = new Date();
    setLabel(`сегодня, ${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`);
  }, []);
  return label;
}

/**
 * Панель «сегодня»: пузырь Ники + кнопка «Обсудить в чате». На мобайле идёт в
 * общий поток под неделей, на десктопе — в правый рейл над карточкой чек-ина.
 */
export function TodayPanel({ message, discussHref, onDiscuss, className }: TodayPanelProps) {
  const nowLabel = useNowLabel();

  return (
    <div className={className}>
      {/* Пузырь «Ника сегодня» */}
      <section className="rounded-card border border-line-default bg-elevated p-5 shadow-soft">
        <div className="mb-3 flex items-center gap-2">
          <span className="h-7 w-7 flex-shrink-0 rounded-full bg-nika-avatar" aria-hidden />
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
            {RHYTHM_STRINGS.nikaKicker}
          </span>
        </div>
        <p className="font-serif text-[16px] leading-[1.5] text-ink-primary">{message}</p>
        <p className="mt-3 text-[11px] text-ink-muted">
          Ника&nbsp;·&nbsp;{nowLabel ?? " "}
        </p>
      </section>

      {/* Обсудить в чате */}
      <Link
        href={discussHref}
        onClick={onDiscuss}
        className="mt-4 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-pill bg-ink-primary px-5 text-[15px] font-medium text-canvas transition-colors hover:bg-accent motion-reduce:transition-none"
      >
        {RHYTHM_STRINGS.discuss}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </div>
  );
}
