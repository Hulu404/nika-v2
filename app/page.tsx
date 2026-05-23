import { ScenarioCard } from "@/components/ScenarioCard";
import { SCENARIO_ORDER } from "@/lib/scenarios";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <header className="text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-muted">
          ментальный ассистент для бегунов
        </p>
        <h1 className="mt-4 font-serif text-7xl font-medium leading-none text-ink-primary">
          НИКА
        </h1>
        <p className="mx-auto mt-5 max-w-md text-lg text-ink-secondary">
          Я не тренер. Я рядом, чтобы ты не бросил бег.
        </p>
      </header>

      <section className="mt-16 grid gap-4 sm:grid-cols-2">
        {SCENARIO_ORDER.map((scenario) => (
          <ScenarioCard key={scenario} scenario={scenario} />
        ))}
      </section>
    </main>
  );
}
