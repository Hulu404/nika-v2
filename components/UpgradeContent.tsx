"use client";

import Link from "next/link";

const PLANS = [
  { id: "monthly", title: "Месяц", price: "299 ₽", period: "в месяц", note: null },
  { id: "yearly", title: "Год", price: "1 990 ₽", period: "в год", note: "экономия 598 ₽" },
] as const;

const FEATURES = [
  "Безлимитные диалоги каждый день",
  "История всех разговоров",
  "Приоритетные ответы",
];

export function UpgradeContent() {
  function handlePay() {
    alert("Оплата скоро будет доступна");
  }

  return (
    <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
      <div className="mx-auto max-w-lg px-5 pt-8 lg:pt-12">

        {/* Назад */}
        <Link
          href="/day1"
          className="inline-flex items-center gap-1 text-[13px] text-ink-secondary transition-colors hover:text-ink-primary"
        >
          ← Назад
        </Link>

        {/* Заголовок */}
        <div className="mt-6 mb-8">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-[18px] w-[18px] flex-shrink-0 rounded-full bg-nika-avatar" />
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-accent">
              Pro
            </span>
          </div>
          <h1 className="font-serif text-[32px] font-normal leading-[1.15] tracking-[-0.02em] text-ink-primary">
            НИКА Pro
          </h1>
          <p className="mt-2 text-[15px] leading-[1.5] text-ink-secondary">
            Без ограничений. Всегда рядом.
          </p>
        </div>

        {/* Тарифы */}
        <div className="grid grid-cols-2 gap-3">
          {PLANS.map((plan) => (
            <button
              key={plan.id}
              onClick={handlePay}
              className="group flex flex-col items-start rounded-card border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 text-left transition-all hover:border-[#C8553D]/40"
            >
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                {plan.title}
              </span>
              <span className="mt-2 font-serif text-[26px] font-medium tracking-[-0.02em] text-ink-primary">
                {plan.price}
              </span>
              <span className="text-[12px] text-ink-secondary">{plan.period}</span>
              {plan.note && (
                <span className="mt-2 rounded-pill bg-surface-warm px-2.5 py-1 text-[11px] font-medium text-accent">
                  {plan.note}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Что входит */}
        <div className="mt-8 rounded-card border border-[var(--border-subtle)] bg-surface-warm px-5 py-5">
          <p className="mb-3 font-serif text-[16px] font-medium text-ink-primary">
            Что входит
          </p>
          <ul className="flex flex-col gap-2.5">
            {FEATURES.map((f) => (
              <li
                key={f}
                className="flex items-start gap-2.5 text-[14px] text-ink-secondary"
              >
                <span className="mt-0.5 flex-shrink-0 text-accent">✓</span>
                {f}
              </li>
            ))}
          </ul>
        </div>

      </div>
    </div>
  );
}
