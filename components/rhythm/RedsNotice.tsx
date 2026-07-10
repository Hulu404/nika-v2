"use client";

import { useEffect, useState } from "react";

interface RedsNoticeProps {
  message: string;
}

const SHOWN_KEY = "nika-reds-shown";

/**
 * Одноразовая мягкая заглушка RED-S (бриф §9). Рендерится только когда сервер
 * счёл пользователя подходящим (флаг включён + сигналы), и показывается один раз
 * на устройство — без повторов и без алармизма. Не считает фаз и не прогнозирует.
 *
 * Заметка: «показано один раз» пока живёт в localStorage — когда Ali включит
 * фичу, стоит перенести факт показа в профиль, чтобы не зависеть от устройства.
 */
export function RedsNotice({ message }: RedsNoticeProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(SHOWN_KEY)) return;
    localStorage.setItem(SHOWN_KEY, "1");
    setVisible(true);
  }, []);

  if (!visible) return null;

  return (
    <section className="rounded-card border border-line-default bg-surface-nika p-5" role="note">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-7 w-7 flex-shrink-0 rounded-full bg-nika-avatar" aria-hidden />
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
          Ника
        </span>
      </div>
      <p className="font-serif text-[15px] leading-[1.55] text-ink-primary">{message}</p>
      <button
        type="button"
        onClick={() => setVisible(false)}
        className="mt-3 min-h-[44px] text-[13px] font-medium text-ink-secondary transition-colors hover:text-ink-primary motion-reduce:transition-none"
      >
        Хорошо
      </button>
    </section>
  );
}
