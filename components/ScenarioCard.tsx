import { Card } from "@/components/ui/Card";
import { SCENARIO_META } from "@/lib/scenarios";
import { cn } from "@/lib/utils";
import type { Scenario } from "@/types/conversation";

export function ScenarioCard({ scenario }: { scenario: Scenario }) {
  const meta = SCENARIO_META[scenario];
  return (
    <Card
      className={cn(
        "flex flex-col justify-between transition-shadow hover:shadow-soft",
        meta.featured && "ring-1 ring-accent/30 sm:col-span-2",
      )}
    >
      <div>
        <h3 className="font-serif text-3xl leading-tight text-ink-primary">
          {meta.title}
        </h3>
        <p className="mt-1 text-ink-secondary">{meta.subtitle}</p>
      </div>
    </Card>
  );
}
