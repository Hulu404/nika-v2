"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HOME_HREF } from "@/lib/nav";

/**
 * Экран апсейла Free → PRO (/upgrade): полноэкранный, на всю ширину вьюпорта,
 * без хрома приложения. Крестик закрывает экран (назад по истории, иначе на
 * Главную). Сравнение тарифов: светлая карточка Free и инвертированная карточка
 * PRO (bg-ink-primary + text-canvas — корректно переворачивается в тёмной теме,
 * как кнопки/бабблы). Все цвета через токены. Кнопка PRO стартует реальную оплату
 * Robokassa через существующую точку входа (create-payment → buildPaymentUrl).
 */

const FREE_FEATURES = [
  "Все 5 сценариев разговора",
  "До 10 сообщений за один сценарий",
  "Советы по бегу открыты полностью",
];

const PRO_FEATURES = [
  "Страница советов собирается персонально под тебя",
  "До 20 сообщений за один сценарий",
  "Помнит контекст и не начинает с нуля каждый день",
  "Все сценарии без ограничений",
  "Узнаёт, что тобой движет, и держит эту нить",
];

/** Приглушённый светлый текст на тёмной карточке PRO — тоже переворачивается в тёмной теме. */
const MUTED_ON_DARK = { color: "color-mix(in srgb, var(--bg-primary) 68%, var(--ink-primary))" } as const;

function Check({ className }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden className={className}>
      <circle cx="9" cy="9" r="8" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 9l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M4 10h11M11 6l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function UpgradeContent() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push(HOME_HREF);
  }

  /**
   * Реальный старт оплаты через существующую точку входа Robokassa
   * (POST /api/robokassa/create-payment): она заводит pending-строку в
   * robokassa_payments и возвращает подписанную ссылку (buildPaymentUrl). Тариф
   * pro = первая неделя 1 ₽. Подпись/URL здесь не собираем — это делает сервер.
   */
  async function handlePay() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/robokassa/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "pro" }),
      });
      // Не залогинен — на вход принятым способом, с возвратом на /upgrade.
      if (res.status === 401) {
        window.location.href = "/auth?next=/upgrade";
        return;
      }
      const data = await res.json();
      if (!res.ok || !data.paymentUrl) {
        throw new Error(data.error ?? "Не удалось перейти к оплате.");
      }
      window.location.href = data.paymentUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка. Попробуй ещё раз.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh w-full overflow-y-auto bg-canvas-outer">
      <div className="relative mx-auto w-full max-w-[880px] px-5 py-8 sm:px-6 lg:py-12">
        {/* Крестик закрытия */}
        <button
          type="button"
          onClick={handleClose}
          aria-label="Закрыть"
          className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:text-ink-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
        >
          <CloseIcon />
        </button>

        {/* Хедер */}
        <div className="pr-12">
          <div className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-accent">
            Твой план
          </div>
          <h1 className="mt-3 max-w-[15ch] font-serif text-[28px] font-normal leading-[1.14] tracking-[-0.02em] text-ink-primary sm:text-[34px]">
            Сейчас у тебя Free. Вот что меняется в <em className="italic text-accent">PRO</em>.
          </h1>
        </div>

        {/* Карточки */}
        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
          {/* ── FREE ─────────────────────────────────────────────────── */}
          <section className="flex flex-col rounded-[20px] border border-line-strong bg-canvas p-6">
            <span className="self-start rounded-pill border border-line-default px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
              Текущий план
            </span>

            <div className="mt-4 flex items-end gap-2">
              <span className="font-mono text-[40px] font-medium leading-none tracking-[-0.02em] text-ink-primary">0 ₽</span>
            </div>
            <p className="mt-1.5 text-[13px] text-ink-muted">Навсегда</p>

            <ul className="mt-5 flex flex-1 flex-col gap-3">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 shrink-0 text-accent" />
                  <span className="text-[14px] leading-[1.4] text-ink-secondary">{f}</span>
                </li>
              ))}
            </ul>

            <p className="mt-4 text-[13px] text-ink-muted">Медитации — скоро</p>

            <button
              type="button"
              disabled
              className="mt-5 flex min-h-[48px] w-full cursor-not-allowed items-center justify-center rounded-pill border border-line-default text-[14px] font-medium text-ink-muted"
            >
              Твой текущий план
            </button>
          </section>

          {/* ── PRO ──────────────────────────────────────────────────── */}
          <section className="flex flex-col rounded-[20px] bg-ink-primary p-6">
            <span className="self-start rounded-pill bg-accent px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-canvas">
              Популярно
            </span>

            <div className="mt-4 flex items-end gap-2.5">
              <span className="font-mono text-[40px] font-medium leading-none tracking-[-0.02em] text-canvas">1 ₽</span>
              <span className="mb-1 font-serif text-[15px] italic" style={MUTED_ON_DARK}>первая неделя</span>
            </div>
            <p className="mt-1.5 text-[13px]" style={MUTED_ON_DARK}>
              Далее <span className="font-mono">249 ₽</span> / мес · отмена в любой момент
            </p>

            <ul className="mt-5 flex flex-1 flex-col gap-3">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 shrink-0 text-accent" />
                  <span className="text-[14px] leading-[1.4] text-canvas">{f}</span>
                </li>
              ))}
            </ul>

            <p className="mt-4 text-[13px]" style={MUTED_ON_DARK}>Медитации — скоро</p>

            <button
              type="button"
              onClick={handlePay}
              disabled={loading}
              className="mt-5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-pill bg-accent text-[14px] font-medium text-canvas transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-deep disabled:cursor-not-allowed disabled:opacity-70 motion-reduce:transition-none"
            >
              {loading ? "Переходим к оплате…" : "Попробовать за 1 ₽"}
              {!loading && <ArrowRight />}
            </button>

            {error && (
              <p className="mt-3 text-center text-[13px] text-canvas">{error}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
