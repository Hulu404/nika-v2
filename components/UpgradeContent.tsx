"use client";

import Link from "next/link";

// ─── данные ──────────────────────────────────────────────────────────────────

const FEATURES = [
  { text: "Долгая память диалогов",          soon: false },
  { text: "Все 5 сценариев",                 soon: false },
  { text: "Аналитика по словам",             soon: false },
  { text: "Strava и Garmin",                 soon: true  },
  { text: "Без ограничений на сообщения",    soon: false },
];

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
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-md px-5 pb-20 pt-10">

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
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-accent">
              PRO
            </span>
          </div>

          <h1 className="font-serif text-[38px] font-normal leading-[1.1] tracking-[-0.025em] text-ink-primary">
            НИКА<br />
            <em className="italic text-accent">без ограничений</em>
          </h1>

          <p className="mt-3 text-[15px] leading-[1.55] text-ink-secondary">
            Память диалогов, все сценарии и полная свобода — чтобы ты не бросил.
          </p>
        </div>

        {/* Тарифы */}
        <div className="mb-8 grid grid-cols-2 gap-3">

          {/* Базовый */}
          <Link
            href="/upgrade?plan=monthly"
            className="flex flex-col rounded-card border border-line-default bg-elevated p-5 transition-all hover:border-accent/30"
          >
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
              Базовый
            </span>
            <div className="mt-4">
              <div className="font-serif text-[32px] font-medium leading-none tracking-[-0.02em] text-ink-primary">
                299 ₽
              </div>
              <div className="mt-1 text-[12px] text-ink-muted">в месяц</div>
            </div>
          </Link>

          {/* Популярный */}
          <Link
            href="/upgrade?plan=6months"
            className="relative flex flex-col rounded-card border border-accent/35 bg-surface-nika p-5 transition-all hover:border-accent/60"
          >
            {/* Бейдж */}
            <span className="absolute -top-[13px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-pill bg-accent px-3 py-[3px] font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-canvas shadow-soft">
              Популярно
            </span>

            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
              6 месяцев
            </span>
            <div className="mt-4">
              <div className="font-serif text-[32px] font-medium leading-none tracking-[-0.02em] text-ink-primary">
                1490 ₽
              </div>
              <div className="mt-1 text-[12px] text-ink-muted">за 6 месяцев</div>
              <div className="mt-2.5 inline-block rounded-pill bg-accent/10 px-2 py-[3px] text-[11px] font-medium text-accent">
                ≈ 248 ₽/мес
              </div>
            </div>
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
                  <span className="font-mono text-[9px] uppercase tracking-widest text-ink-faint">
                    скоро
                  </span>
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
