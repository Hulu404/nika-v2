"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { createClientComponentClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { RunnerFear, RunnerGoal, RunnerLevel } from "@/types/app";

type Step = 1 | 2 | 3;

const LEVELS: { value: RunnerLevel; label: string }[] = [
  { value: "beginner", label: "Только начинаю" },
  { value: "irregular", label: "Бегаю, но нерегулярно" },
  { value: "returning", label: "Возвращаюсь после перерыва" },
];

const GOALS: { value: RunnerGoal; label: string }[] = [
  { value: "habit", label: "Хочу сделать это привычкой" },
  { value: "not_quit", label: "Хочу не бросить" },
  { value: "race", label: "Готовлюсь к забегу" },
  { value: "anxiety", label: "Помогает с тревогой и стрессом" },
];

const FEARS: { value: RunnerFear; label: string }[] = [
  { value: "shame", label: "Стыдно — я слишком медленный" },
  { value: "tired", label: "Нет сил и энергии" },
  { value: "slow", label: "Не хватает мотивации" },
  { value: "doubt", label: "Сомневаюсь, что у меня получится" },
  { value: "injury", label: "Боюсь травм" },
];

const QUESTION: Record<Step, string> = {
  1: "Как давно ты бегаешь?",
  2: "Зачем тебе бег?",
  3: "Что мешает бегать?",
};

function OptionCard({
  selected,
  onClick,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-card border-2 p-5 text-left text-lg leading-snug transition-colors",
        selected
          ? "border-accent bg-surface-nika text-ink-primary"
          : "border-transparent bg-surface-warm text-ink-primary hover:border-ink-muted/25",
      )}
    >
      <span>{label}</span>
      {selected && (
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5 shrink-0 text-accent"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      )}
    </button>
  );
}

export function OnboardingFlow({ userId }: { userId: string }) {
  const router = useRouter();
  const [supabase] = useState(() => createClientComponentClient());

  const [step, setStep] = useState<Step>(1);
  const [level, setLevel] = useState<RunnerLevel | null>(null);
  const [goal, setGoal] = useState<RunnerGoal | null>(null);
  const [fears, setFears] = useState<RunnerFear[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectLevel(value: RunnerLevel) {
    setLevel(value);
    setStep(2);
  }

  function selectGoal(value: RunnerGoal) {
    setGoal(value);
    setStep(3);
  }

  function toggleFear(value: RunnerFear) {
    setFears((prev) =>
      prev.includes(value) ? prev.filter((f) => f !== value) : [...prev, value],
    );
  }

  function back() {
    setError(null);
    setStep((s) => (s > 1 ? ((s - 1) as Step) : s));
  }

  async function save() {
    if (!level || !goal || saving) return;
    setSaving(true);
    setError(null);

    const { error: saveError } = await supabase
      .from("profiles")
      .upsert({ user_id: userId, level, goal, fears }, { onConflict: "user_id" });

    if (saveError) {
      console.error("[onboarding] save failed:", saveError);
      setSaving(false);
      setError("Не получилось сохранить. Попробуй ещё раз.");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 py-10">
      {/* Шапка: назад + прогресс */}
      <div className="flex items-center gap-4">
        {step > 1 ? (
          <button
            type="button"
            onClick={back}
            className="shrink-0 text-sm text-ink-muted transition-colors hover:text-ink-primary"
          >
            ← Назад
          </button>
        ) : (
          <span className="shrink-0 text-sm text-transparent" aria-hidden>
            ←
          </span>
        )}
        <div className="flex flex-1 gap-1.5">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={cn(
                "h-1 flex-1 rounded-pill transition-colors",
                n <= step ? "bg-accent" : "bg-surface-warm",
              )}
            />
          ))}
        </div>
      </div>

      {/* Шаг (перерисовывается с fade при смене step) */}
      <div key={step} className="mt-10 flex flex-1 animate-fade-in flex-col">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-muted">
          Шаг {step} из 3
        </p>
        <h1 className="mt-3 font-serif text-4xl leading-tight text-ink-primary">
          {QUESTION[step]}
        </h1>
        {step === 3 && (
          <p className="mt-2 text-ink-secondary">Можно выбрать несколько.</p>
        )}

        <div className="mt-8 flex flex-col gap-3">
          {step === 1 &&
            LEVELS.map((o) => (
              <OptionCard
                key={o.value}
                label={o.label}
                selected={level === o.value}
                onClick={() => selectLevel(o.value)}
              />
            ))}
          {step === 2 &&
            GOALS.map((o) => (
              <OptionCard
                key={o.value}
                label={o.label}
                selected={goal === o.value}
                onClick={() => selectGoal(o.value)}
              />
            ))}
          {step === 3 &&
            FEARS.map((o) => (
              <OptionCard
                key={o.value}
                label={o.label}
                selected={fears.includes(o.value)}
                onClick={() => toggleFear(o.value)}
              />
            ))}
        </div>

        {step === 3 && (
          <div className="mt-auto pt-8">
            {error && (
              <p className="mb-3 text-center text-sm text-accent">{error}</p>
            )}
            <Button onClick={save} disabled={saving} className="w-full">
              {saving ? "Сохраняем…" : "Сохранить и начать"}
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
