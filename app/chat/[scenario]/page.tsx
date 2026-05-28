import Link from "next/link";
import { notFound } from "next/navigation";
import { Chat } from "@/components/Chat";
import { SCENARIO_META, SCENARIO_ORDER } from "@/lib/scenarios";
import type { Scenario } from "@/types/conversation";

export function generateStaticParams() {
  return SCENARIO_ORDER.map((scenario) => ({ scenario }));
}

function isScenario(value: string): value is Scenario {
  return (SCENARIO_ORDER as string[]).includes(value);
}

export default function ChatPage({
  params,
}: {
  params: { scenario: string };
}) {
  if (!isScenario(params.scenario)) {
    notFound();
  }

  const scenario = params.scenario;
  const meta = SCENARIO_META[scenario];

  return (
    <div className="flex h-dvh flex-col bg-canvas">

      {/* Nika header — sticky, как в прототипе */}
      <header className="sticky top-0 z-10 flex shrink-0 items-center gap-3 border-b border-line-subtle bg-[var(--bg-blur)] px-4 py-3 backdrop-blur-[16px]">
        <Link
          href="/"
          aria-label="На главную"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-surface-nika hover:text-ink-primary"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>

        {/* Аватар НИКИ с зелёной точкой онлайн */}
        <div className="relative h-9 w-9 flex-shrink-0 rounded-full bg-nika-avatar shadow-[0_0_0_3px_rgba(200,85,61,0.06)]">
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-canvas bg-[#7BA968]" />
        </div>

        {/* Имя и статус */}
        <div className="flex flex-1 flex-col leading-none">
          <span className="font-serif text-[17px] font-medium tracking-[-0.01em] text-ink-primary">
            НИКА
          </span>
          <span className="mt-[3px] text-[11px] tracking-[0.02em] text-ink-muted">
            {meta.subtitle}
          </span>
        </div>
      </header>

      <Chat scenario={scenario} className="min-h-0 flex-1" />
    </div>
  );
}
