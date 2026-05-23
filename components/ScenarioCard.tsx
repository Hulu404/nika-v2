import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { SCENARIO_META } from "@/lib/scenarios";
import { cn } from "@/lib/utils";
import type { Scenario } from "@/types/conversation";

export function ScenarioCard({ scenario }: { scenario: Scenario }) {
  const meta = SCENARIO_META[scenario];
  return (
    <Link
      href={`/chat/${scenario}`}
      className={cn("group block", meta.featured && "sm:col-span-2")}
    >
      <Card
        className={cn(
          "flex h-full flex-col justify-between transition-shadow group-hover:shadow-card",
          meta.featured && "ring-1 ring-accent/30",
        )}
      >
        <div>
          <h3 className="font-serif text-3xl leading-tight text-ink-primary">
            {meta.title}
          </h3>
          <p className="mt-1 text-ink-secondary">{meta.subtitle}</p>
        </div>
        <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-accent">
          Поговорить
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </span>
      </Card>
    </Link>
  );
}
