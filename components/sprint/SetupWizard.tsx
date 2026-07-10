"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClientComponentClient } from "@/lib/supabase";
import { ARCHETYPES, QUIZ_QUESTIONS, computeArchetype, goalMilestonePlaceholder } from "@/lib/archetypes";
import { createSprint } from "@/lib/sprint";
import { cn } from "@/lib/utils";
import type { ArchetypeId, QuizAnswer, Milestone } from "@/types/app";

// ─── Шаги ────────────────────────────────────────────────────────────────────

type Step =
  | { kind: "quiz"; index: number }
  | { kind: "reveal" }
  | { kind: "goal" }
  | { kind: "milestones" }
  | { kind: "saving" };

// ─── Вспомогательные компоненты ───────────────────────────────────────────────

function ProgressBar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-line-subtle">
      <div
        className="h-full rounded-full bg-accent transition-all duration-300"
        style={{ width: `${Math.round((value / max) * 100)}%` }}
      />
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-[13px] text-ink-muted transition-colors hover:text-ink-secondary"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Назад
    </button>
  );
}

interface OptionButtonProps {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}
function OptionButton({ selected, onClick, children }: OptionButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-2xl border px-5 py-4 text-left text-[15px] leading-snug transition-colors",
        selected
          ? "border-accent bg-surface-nika text-ink-primary"
          : "border-line-subtle bg-elevated text-ink-secondary hover:border-accent/40 hover:bg-surface-nika/50",
      )}
    >
      {children}
    </button>
  );
}

// ─── Основной компонент ───────────────────────────────────────────────────────

interface Props {
  userId: string;
}

export function SetupWizard({ userId }: Props) {
  const router = useRouter();
  const [supabase] = useState(() => createClientComponentClient());

  // Состояние ответов
  const [quizAnswers, setQuizAnswers] = useState<QuizAnswer[]>([]);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [archetype, setArchetype] = useState<ArchetypeId | null>(null);

  // Состояние цели
  const [goalText, setGoalText] = useState("");
  const [customGoal, setCustomGoal] = useState("");
  const [goalMode, setGoalMode] = useState<"preset" | "custom">("preset");

  // Состояние ориентиров
  const [milestonesEnabled, setMilestonesEnabled] = useState(false);
  const [milestoneInputs, setMilestoneInputs] = useState<string[]>(["", "", ""]);

  // Текущий шаг
  const [step, setStep] = useState<Step>({ kind: "quiz", index: 0 });

  const totalSteps = 4 + 1 + 1; // 4 вопроса + reveal + goal (ориентиры опциональны)

  // ── Квиз ────────────────────────────────────────────────────────────────────

  const handleQuizNext = useCallback(() => {
    if (selectedOption === null) return;
    const quizIndex = (step as { kind: "quiz"; index: number }).index;
    const vote = QUIZ_QUESTIONS[quizIndex].options[selectedOption].archetype;
    const newAnswers: QuizAnswer[] = [...quizAnswers, { question_index: quizIndex as 0 | 1 | 2 | 3, archetype_vote: vote }];
    setQuizAnswers(newAnswers);
    setSelectedOption(null);

    if (quizIndex < QUIZ_QUESTIONS.length - 1) {
      setStep({ kind: "quiz", index: quizIndex + 1 });
    } else {
      const result = computeArchetype(newAnswers.map((a) => a.archetype_vote));
      setArchetype(result);
      setStep({ kind: "reveal" });
    }
  }, [step, selectedOption, quizAnswers]);

  const handleQuizBack = useCallback(() => {
    const quizIndex = (step as { kind: "quiz"; index: number }).index;
    if (quizIndex === 0) return; // первый вопрос — нет возврата
    setQuizAnswers((prev) => prev.slice(0, -1));
    setSelectedOption(null);
    setStep({ kind: "quiz", index: quizIndex - 1 });
  }, [step]);

  // ── Цель ────────────────────────────────────────────────────────────────────

  const effectiveGoal = goalMode === "custom" ? customGoal.trim() : goalText;

  const handleGoalNext = useCallback(() => {
    if (!effectiveGoal) return;
    const arch = ARCHETYPES[archetype!];
    if (arch.structural) {
      setMilestonesEnabled(false);
      setMilestoneInputs(["", "", ""]);
      setStep({ kind: "milestones" });
    } else {
      saveSprint(false, []);
    }
  }, [effectiveGoal, archetype]);

  // ── Ориентиры ───────────────────────────────────────────────────────────────

  const handleMilestonesNext = useCallback(() => {
    const milestones: Milestone[] = milestonesEnabled
      ? milestoneInputs
          .filter((t) => t.trim())
          .map((label, i) => ({ id: String(i + 1), label: label.trim(), achieved_at: null }))
      : [];
    saveSprint(milestonesEnabled, milestones);
  }, [milestonesEnabled, milestoneInputs, effectiveGoal]);

  // ── Сохранение ──────────────────────────────────────────────────────────────

  async function saveSprint(mEnabled: boolean, milestones: Milestone[]) {
    setStep({ kind: "saving" });
    try {
      await createSprint(supabase, {
        userId,
        archetypeId: archetype!,
        goalText: effectiveGoal,
        milestonesEnabled: mEnabled,
        milestones,
        quizAnswers,
      });
      router.push("/sprint");
    } catch {
      setStep({ kind: "goal" });
    }
  }

  // ── Рендер ──────────────────────────────────────────────────────────────────

  const wrapper = (children: React.ReactNode, progressValue: number, showBack?: () => void) => (
    <div className="flex min-h-screen flex-col bg-bg-base px-5 pt-safe-top">
      {/* Шапка */}
      <div className="flex items-center gap-4 pb-4 pt-6">
        <div className="flex-1">
          <ProgressBar value={progressValue} max={totalSteps} />
        </div>
        {showBack && <BackButton onClick={showBack} />}
      </div>

      {/* Контент */}
      <div className="flex-1 pb-10">{children}</div>
    </div>
  );

  // Квиз
  if (step.kind === "quiz") {
    const q = QUIZ_QUESTIONS[step.index];
    return wrapper(
      <div className="mx-auto max-w-[540px] pt-6">
        <p className="mb-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-accent">
          Вопрос {step.index + 1} из {QUIZ_QUESTIONS.length}
        </p>
        <h2 className="mb-8 font-serif text-[22px] leading-[1.3] tracking-[-0.01em] text-ink-primary lg:text-[26px]">
          {q.text}
        </h2>
        <div className="flex flex-col gap-3">
          {q.options.map((opt, i) => (
            <OptionButton key={i} selected={selectedOption === i} onClick={() => setSelectedOption(i)}>
              {opt.text}
            </OptionButton>
          ))}
        </div>
        <button
          onClick={handleQuizNext}
          disabled={selectedOption === null}
          className="mt-6 w-full rounded-full bg-accent py-3.5 text-[15px] font-semibold text-white transition-opacity disabled:opacity-40"
        >
          Дальше
        </button>
      </div>,
      step.index + 1,
      step.index > 0 ? handleQuizBack : undefined,
    );
  }

  // Раскрытие архетипа
  if (step.kind === "reveal") {
    const arch = ARCHETYPES[archetype!];
    return wrapper(
      <div className="mx-auto max-w-[540px] pt-8">
        <p className="mb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-accent">
          Твой архетип
        </p>
        <h2 className="mb-6 font-serif text-[28px] leading-[1.2] tracking-[-0.02em] text-ink-primary">
          {arch.name}
        </h2>
        <div className="mb-8 rounded-2xl border border-accent/20 bg-surface-nika px-6 py-5">
          <p className="font-serif text-[17px] italic leading-[1.5] text-ink-primary">
            {arch.reveal}
          </p>
        </div>
        <button
          onClick={() => { setGoalText(""); setGoalMode("preset"); setStep({ kind: "goal" }); }}
          className="w-full rounded-full bg-accent py-3.5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          Поставим цель
        </button>
      </div>,
      5,
    );
  }

  // Цель
  if (step.kind === "goal") {
    const arch = ARCHETYPES[archetype!];
    return wrapper(
      <div className="mx-auto max-w-[540px] pt-6">
        <p className="mb-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-accent">
          Цель спринта
        </p>
        <h2 className="mb-6 font-serif text-[22px] leading-[1.3] tracking-[-0.01em] text-ink-primary">
          {arch.goalQuestion}
        </h2>
        <div className="flex flex-col gap-3">
          {arch.goalOptions.map((opt) => (
            <OptionButton
              key={opt}
              selected={goalMode === "preset" && goalText === opt}
              onClick={() => { setGoalText(opt); setGoalMode("preset"); }}
            >
              {opt}
            </OptionButton>
          ))}
          <OptionButton
            selected={goalMode === "custom"}
            onClick={() => setGoalMode("custom")}
          >
            Своя цель
          </OptionButton>
        </div>
        {goalMode === "custom" && (
          <textarea
            autoFocus
            value={customGoal}
            onChange={(e) => setCustomGoal(e.target.value)}
            placeholder="Напиши свою цель..."
            rows={3}
            className="mt-3 w-full resize-none rounded-2xl border border-line-subtle bg-elevated px-4 py-3 text-[15px] text-ink-primary placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
        )}
        <button
          onClick={handleGoalNext}
          disabled={!effectiveGoal}
          className="mt-6 w-full rounded-full bg-accent py-3.5 text-[15px] font-semibold text-white transition-opacity disabled:opacity-40"
        >
          {ARCHETYPES[archetype!].structural ? "Дальше" : "Начать спринт"}
        </button>
      </div>,
      6,
      () => setStep({ kind: "reveal" }),
    );
  }

  // Ориентиры
  if (step.kind === "milestones") {
    const arch = ARCHETYPES[archetype!];
    const placeholder = archetype === "goal"
      ? goalMilestonePlaceholder(effectiveGoal)
      : "Ориентир...";

    return wrapper(
      <div className="mx-auto max-w-[540px] pt-6">
        <p className="mb-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-accent">
          Ориентиры
        </p>
        <h2 className="mb-2 font-serif text-[22px] leading-[1.3] tracking-[-0.01em] text-ink-primary">
          {arch.milestoneQuestion}
        </h2>
        <p className="mb-6 text-[13px] text-ink-secondary">
          Ориентиры помогают видеть путь внутри спринта. Это не обязательно.
        </p>

        {/* Тоггл */}
        <div className="mb-6 flex items-center justify-between rounded-2xl border border-line-subtle bg-elevated px-4 py-4">
          <span className="text-[15px] text-ink-primary">Добавить ориентиры</span>
          <button
            role="switch"
            aria-checked={milestonesEnabled}
            onClick={() => setMilestonesEnabled((v) => !v)}
            className={cn(
              "relative h-7 w-[50px] flex-shrink-0 rounded-full transition-colors duration-200",
              milestonesEnabled ? "bg-accent" : "bg-line-default",
            )}
          >
            <span className={cn(
              "absolute left-0 top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow transition-transform duration-200",
              milestonesEnabled ? "translate-x-[25px]" : "translate-x-[3px]",
            )} />
          </button>
        </div>

        {milestonesEnabled && (
          <div className="flex flex-col gap-3">
            {milestoneInputs.map((val, i) => (
              <input
                key={i}
                value={val}
                onChange={(e) => setMilestoneInputs((prev) => prev.map((v, j) => j === i ? e.target.value : v))}
                placeholder={i === 0 ? placeholder : `Ориентир ${i + 1}...`}
                className="w-full rounded-2xl border border-line-subtle bg-elevated px-4 py-3.5 text-[15px] text-ink-primary placeholder:text-ink-faint focus:border-accent focus:outline-none"
              />
            ))}
          </div>
        )}

        <button
          onClick={handleMilestonesNext}
          className="mt-6 w-full rounded-full bg-accent py-3.5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          Начать спринт
        </button>
      </div>,
      6,
      () => setStep({ kind: "goal" }),
    );
  }

  // Сохранение
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-base">
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <p className="text-[14px] text-ink-secondary">Создаём спринт...</p>
      </div>
    </div>
  );
}
