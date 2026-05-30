"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// ─── данные ──────────────────────────────────────────────────────────────────

const FEATURES = [
  { text: "Долгая память диалогов",       soon: false },
  { text: "Все 5 сценариев",              soon: false },
  { text: "Аналитика по словам",          soon: false },
  { text: "Strava и Garmin",             soon: true  },
  { text: "Без ограничений на сообщения", soon: false },
];

type Plan = "monthly" | "6months";

const PLANS: Record<Plan, { label: string; price: string; crossed?: string; sub: string; badge?: string }> = {
  monthly: {
    label: "Месяц",
    price: "299 ₽",
    sub: "в месяц",
  },
  "6months": {
    label: "6 месяцев",
    price: "1 490 ₽",
    crossed: "1 794 ₽",
    sub: "за 6 месяцев · ≈ 248 ₽/мес",
    badge: "−17%",
  },
};

// ─── иконка ──────────────────────────────────────────────────────────────────

function Check() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <circle cx="9" cy="9" r="8" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 9l2 2 4-4" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── компонент ───────────────────────────────────────────────────────────────

export function UpgradeContent() {
  const [plan, setPlan] = useState<Plan>("6months");
  const current = PLANS[plan];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[720px] px-6 pb-20 pt-10">

        {/* Назад */}
        <Link
          href="/day1"
          className="inline-flex items-center gap-1.5 text-[13px] text-ink-secondary transition-colors hover:text-ink-primary"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M10 3L6 8L10 13" stroke="currentColor" strokeWidth="1.4"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Назад
        </Link>

        {/* Шапка */}
        <div className="mt-8 mb-8">
          <div className="mb-4 inline-flex items-center gap-2 rounded-pill border border-accent/25 bg-surface-warm px-3 py-1.5">
            <div className="h-3.5 w-3.5 flex-shrink-0 rounded-full bg-nika-avatar" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-accent">PRO</span>
          </div>

          <h1 className="font-serif text-[38px] font-normal leading-[1.1] tracking-[-0.025em] text-ink-primary">
            НИКА<br />
            <em className="italic text-accent">без ограничений</em>
          </h1>

          <p className="mt-3 text-[15px] leading-[1.55] text-ink-secondary">
            Память диалогов, все сценарии и полная свобода — чтобы ты не бросил.
          </p>
        </div>

        {/* Переключатель тарифов */}
        <div className="mb-6 flex rounded-pill border border-line-default bg-elevated p-1">
          {(["monthly", "6months"] as Plan[]).map((p) => (
            <button
              key={p}
              onClick={() => setPlan(p)}
              className={cn(
                "flex-1 rounded-pill py-2.5 text-[13px] font-medium transition-all duration-200",
                plan === p
                  ? "bg-ink-primary text-canvas shadow-soft"
                  : "text-ink-secondary hover:text-ink-primary",
              )}
            >
              {PLANS[p].label}
            </button>
          ))}
        </div>

        {/* Карточка цены */}
        <div className="mb-6 rounded-card border border-accent/30 bg-surface-nika p-6">
          <div className="flex items-end gap-3">
            <div className="font-serif text-[44px] font-medium leading-none tracking-[-0.02em] text-ink-primary">
              {current.price}
            </div>
            {current.crossed && (
              <div className="mb-1 text-[18px] text-ink-faint line-through">{current.crossed}</div>
            )}
            {current.badge && (
              <div className="mb-1 rounded-pill bg-accent/15 px-2.5 py-1 text-[12px] font-semibold text-accent">
                {current.badge}
              </div>
            )}
          </div>
          <p className="mt-1.5 text-[13px] text-ink-muted">{current.sub}</p>

          <Link
            href={`/upgrade?plan=${plan}`}
            className="mt-5 block w-full rounded-pill bg-ink-primary py-[13px] text-center text-[14px] font-medium text-canvas transition-colors hover:bg-accent"
          >
            {plan === "monthly" ? "Попробовать 7 дней бесплатно" : "Подключить PRO на 6 месяцев"}
          </Link>
        </div>

        {/* Что входит */}
        <div className="mb-5 rounded-card border border-line-default bg-elevated px-5 py-5">
          <p className="mb-4 font-serif text-[17px] font-medium text-ink-primary">
            Что входит в PRO
          </p>
          <ul className="flex flex-col gap-3.5">
            {FEATURES.map((f) => (
              <li key={f.text} className="flex items-center gap-3 text-accent">
                <Check />
                <span className="flex-1 text-[14px] text-ink-secondary">{f.text}</span>
                {f.soon && (
                  <span className="font-mono text-[9px] uppercase tracking-widest text-ink-faint">скоро</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* Мелкий текст */}
        <p className="text-center text-[12px] leading-[1.6] text-ink-muted">
          Оплата через ЮKassa. Отмена подписки — в любой момент.
        </p>

      </div>
    </div>
  );
}
