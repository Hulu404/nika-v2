import type { ReactNode } from "react";
import Link from "next/link";
import { SCENARIO_META, SCENARIO_ORDER } from "@/lib/scenarios";
import type { Scenario } from "@/types/conversation";

const SCENARIO_ICONS: Record<Scenario, ReactNode> = {
  morning: (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 3V5M11 17V19M3 11H5M17 11H19M5.636 5.636l1.414 1.414M15.95 15.95l1.414 1.414M5.636 16.364l1.414-1.414M15.95 6.05l1.414-1.414" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  after_run: (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M4 11l5 5 9-9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  after_skip: (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M11 5V17M5 11H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  pre_race: (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 7V11L13.5 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  after_failure: (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M11 18.5S3 13.5 3 8a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 5.5-8 10.5-8 10.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
};

const FEATURED: Scenario = "after_skip";

export default function Home() {
  return (
    <main className="mx-auto max-w-lg px-4 pb-16 pt-12 sm:pt-16">

      {/* Hero */}
      <header className="px-2 pb-8">
        <div className="mb-3 flex items-center gap-2">
          <span className="h-[18px] w-[18px] flex-shrink-0 rounded-full bg-nika-avatar" />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-accent">
            ментальный ассистент для бегунов
          </span>
        </div>
        <h1 className="font-serif text-[30px] font-normal leading-[1.2] tracking-[-0.02em] text-ink-primary">
          Привет.<br />
          <em className="italic text-accent">Я тут.</em>
        </h1>
        <p className="mt-3 text-[14.5px] leading-[1.55] text-ink-secondary">
          Я не тренер. Выбери момент — и просто напиши.
        </p>
      </header>

      {/* Scenario cards */}
      <div className="flex flex-col gap-3">
        {SCENARIO_ORDER.map((scenario) => {
          const meta = SCENARIO_META[scenario];
          const isFeatured = scenario === FEATURED;
          return (
            <Link
              key={scenario}
              href={`/chat/${scenario}`}
              className="group block"
            >
              <div
                className={[
                  "flex items-center gap-[14px] rounded-card border px-[18px] py-4 transition-all",
                  isFeatured
                    ? "border-[rgba(200,85,61,0.18)] bg-surface-warm hover:border-[rgba(200,85,61,0.35)]"
                    : "border-line-subtle bg-elevated hover:border-line-default",
                ].join(" ")}
              >
                {/* Icon */}
                <div
                  className={[
                    "flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[12px] text-accent",
                    isFeatured ? "bg-[rgba(255,255,255,0.5)]" : "bg-surface-nika",
                  ].join(" ")}
                >
                  {SCENARIO_ICONS[scenario]}
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="font-serif text-[15px] font-medium leading-snug text-ink-primary">
                    {meta.title}
                  </div>
                  <div className="mt-0.5 text-[12.5px] leading-[1.4] text-ink-secondary">
                    {meta.subtitle}
                  </div>
                </div>

                {/* Chevron */}
                <div className="flex-shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
