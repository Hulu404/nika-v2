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
    <div className="flex h-dvh flex-col">
      <header className="shrink-0 border-b border-ink-muted/10 bg-canvas/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Link
            href="/"
            aria-label="На главную"
            className="text-ink-muted transition-colors hover:text-ink-primary"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <div>
            <h1 className="font-serif text-2xl leading-tight text-ink-primary">
              {meta.title}
            </h1>
            <p className="text-sm text-ink-secondary">{meta.subtitle}</p>
          </div>
        </div>
      </header>

      <Chat scenario={scenario} className="min-h-0 flex-1" />
    </div>
  );
}
