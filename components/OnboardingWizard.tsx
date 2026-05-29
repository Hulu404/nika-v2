"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClientComponentClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { RunnerLevel, RunnerGoal, RunnerFear } from "@/types/app";

// ─── данные шагов ────────────────────────────────────────────────────────────

const LEVEL_OPTIONS: { v: RunnerLevel; l: string; d: string }[] = [
  { v: "beginner",  l: "Только начинаю",             d: "Первые шаги в беге" },
  { v: "irregular", l: "Бегаю нерегулярно",           d: "Иногда выхожу, но без системы" },
  { v: "returning", l: "Возвращаюсь после перерыва",  d: "Был опыт, но выпал из ритма" },
];

const GOAL_OPTIONS: { v: RunnerGoal; l: string; d: string }[] = [
  { v: "habit",    l: "Войти в привычку",         d: "Бегать стабильно и регулярно" },
  { v: "not_quit", l: "Не бросить",               d: "Удержаться и не сдаться" },
  { v: "race",     l: "Подготовиться к забегу",   d: "Есть конкретная дистанция" },
  { v: "anxiety",  l: "Справиться с тревогой",    d: "Бег как поддержка" },
];

const WHEN_OPTIONS = ["Утром", "Вечером", "По-разному"] as const;
type When = (typeof WHEN_OPTIONS)[number];

const FEAR_OPTIONS: { v: RunnerFear; l: string }[] = [
  { v: "shame",   l: "Стыд после пропуска" },
  { v: "tired",   l: "Нет сил" },
  { v: "slow",    l: "Боюсь выглядеть медленным" },
  { v: "doubt",   l: "Не верю что смогу" },
  { v: "injury",  l: "Травма или боль" },
];

const TOTAL_STEPS = 5; // шаги 1–5 (0 = приветствие)

// ─── вспомогательные компоненты ──────────────────────────────────────────────

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-[var(--surface-nika)] hover:text-ink-primary"
      aria-label="Назад"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path
          d="M13 4L7 10L13 16"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function ProgressDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex items-center gap-[5px]">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "rounded-full transition-all duration-300",
            i < current
              ? "h-2 w-2 bg-ink-primary"
              : i === current
                ? "h-2.5 w-2.5 bg-accent"
                : "h-1.5 w-1.5 bg-[var(--border-strong)]",
          )}
        />
      ))}
    </div>
  );
}

// ─── карточки-варианты ────────────────────────────────────────────────────────

function OptionCard({
  label,
  desc,
  selected,
  onClick,
}: {
  label: string;
  desc?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-card border-[1.5px] px-5 py-[18px] text-left transition-all duration-150",
        selected
          ? "border-ink-primary bg-ink-primary"
          : "border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)]",
      )}
    >
      <div className={cn("text-[16px] font-medium", selected ? "text-canvas" : "text-ink-primary")}>
        {label}
      </div>
      {desc && (
        <div className={cn("mt-0.5 text-[13px]", selected ? "text-canvas/70" : "text-ink-muted")}>
          {desc}
        </div>
      )}
    </button>
  );
}

// ─── основной компонент ───────────────────────────────────────────────────────

export function OnboardingWizard({ userId }: { userId: string }) {
  const router = useRouter();
  const [supabase] = useState(() => createClientComponentClient());

  const [step, setStep]   = useState(0);
  const [name, setName]   = useState("");
  const [level, setLevel] = useState<RunnerLevel | null>(null);
  const [goal, setGoal]   = useState<RunnerGoal | null>(null);
  const [when, setWhen]   = useState<When | null>(null);
  const [fears, setFears] = useState<RunnerFear[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  function next() { setStep((s) => s + 1); }
  function back() { setStep((s) => Math.max(0, s - 1)); }

  function toggleFear(f: RunnerFear) {
    setFears((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f],
    );
  }

  async function finish() {
    if (saving) return;
    setSaving(true);
    setError(null);

    const { error: profileError } = await supabase
      .from("profiles")
      .upsert(
        {
          user_id: userId,
          ...(level && { level }),
          ...(goal  && { goal }),
          fears,
        },
        { onConflict: "user_id" },
      );

    if (profileError) {
      console.error("[onboarding] profile save failed:", profileError);
      setSaving(false);
      setError("Не получилось сохранить. Попробуй ещё раз.");
      return;
    }

    // display_name — best-effort, не блокируем вход при ошибке
    const trimmed = name.trim();
    if (trimmed) {
      const { error: nameError } = await supabase
        .from("users")
        .update({ display_name: trimmed })
        .eq("id", userId);
      if (nameError) {
        console.error("[onboarding] display_name update failed:", nameError);
      }
    }

    router.push("/day1");
    router.refresh();
  }

  // ── Шаг 0: Welcome ───────────────────────────────────────────────────────────
  if (step === 0) {
    return (
      <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[var(--bg-primary)]">
        {/* Фоновые градиенты */}
        <div className="pointer-events-none absolute right-[-30%] top-[-40%] h-[80%] w-full bg-[radial-gradient(circle,rgba(200,85,61,0.10),transparent_60%)]" />
        <div className="pointer-events-none absolute bottom-[-30%] left-[-20%] h-[60%] w-[80%] bg-[radial-gradient(circle,rgba(31,27,22,0.06),transparent_60%)]" />

        <div className="relative flex flex-1 flex-col px-7 pb-10 pt-16 animate-fade-in">
          {/* Аватар */}
          <div className="mb-8 h-[72px] w-[72px] rounded-full bg-nika-avatar shadow-card" />

          <h1 className="mb-6 font-serif text-[42px] font-normal leading-none tracking-[-0.03em] text-ink-primary">
            НИКА
          </h1>

          <p className="font-serif text-[24px] leading-[1.38] tracking-[-0.015em] text-ink-primary">
            Я не тренер.<br />
            Не план.<br />
            Я рядом —{" "}
            <em className="italic text-accent">чтобы ты не бросил.</em>
          </p>

          <div className="mt-auto">
            <p className="mb-6 text-[13px] leading-[1.55] text-ink-muted">
              Пара вопросов — и я буду знать, как быть рядом именно для тебя. Займёт минуту.
            </p>
            <button
              onClick={next}
              className="h-[54px] w-full rounded-pill bg-ink-primary text-[15px] font-medium text-canvas transition-colors hover:bg-accent"
            >
              Познакомиться
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Шаги 1–5 ─────────────────────────────────────────────────────────────────

  const nextDisabled =
    (step === 1 && !name.trim()) ||
    (step === 2 && !level)       ||
    (step === 3 && !goal)        ||
    (step === 4 && !when);

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--bg-primary)]">

      {/* Шапка: кнопка назад + точки прогресса */}
      <div className="flex items-center justify-between px-5 pt-[52px]">
        <BackButton onClick={back} />
        <ProgressDots total={TOTAL_STEPS} current={step - 1} />
        <div className="w-9" /> {/* балансировочный спейсер */}
      </div>

      {/* Контент шага — ключ вызывает re-mount → анимация fade-in на каждом шаге */}
      <div key={step} className="flex flex-1 flex-col px-6 pb-4 pt-8 animate-fade-in">

        {/* Вопрос НИКИ в пузыре */}
        <div className="mb-7 max-w-[92%] rounded-bubble rounded-bl-[6px] bg-[var(--surface-nika)] px-[22px] py-5 font-serif text-[22px] leading-[1.35] tracking-[-0.01em] text-ink-primary">
          {step === 1 && "Как тебя зовут?"}
          {step === 2 && "Как ты себя описываешь?"}
          {step === 3 && "Зачем ты здесь?"}
          {step === 4 && "Когда обычно бегаешь?"}
          {step === 5 && "Что мешает больше всего?"}
        </div>

        {/* Шаг 1: Имя */}
        {step === 1 && (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && next()}
            placeholder="Твоё имя"
            autoFocus
            className="w-full border-b-[1.5px] border-[var(--border-default)] bg-transparent pb-3 pt-2 font-serif text-[22px] text-ink-primary outline-none placeholder:text-ink-faint focus:border-ink-primary transition-colors"
          />
        )}

        {/* Шаг 2: Уровень */}
        {step === 2 && (
          <div className="flex flex-col gap-2.5">
            {LEVEL_OPTIONS.map((o) => (
              <OptionCard
                key={o.v}
                label={o.l}
                desc={o.d}
                selected={level === o.v}
                onClick={() => setLevel(o.v)}
              />
            ))}
          </div>
        )}

        {/* Шаг 3: Цель */}
        {step === 3 && (
          <div className="flex flex-col gap-2.5">
            {GOAL_OPTIONS.map((o) => (
              <OptionCard
                key={o.v}
                label={o.l}
                desc={o.d}
                selected={goal === o.v}
                onClick={() => setGoal(o.v)}
              />
            ))}
          </div>
        )}

        {/* Шаг 4: Время */}
        {step === 4 && (
          <div className="flex flex-col gap-2.5">
            {WHEN_OPTIONS.map((w) => (
              <OptionCard
                key={w}
                label={w}
                selected={when === w}
                onClick={() => setWhen(w)}
              />
            ))}
          </div>
        )}

        {/* Шаг 5: Страхи (мультиселект — чипы) */}
        {step === 5 && (
          <div className="flex flex-wrap gap-2">
            {FEAR_OPTIONS.map((f) => (
              <button
                key={f.v}
                onClick={() => toggleFear(f.v)}
                className={cn(
                  "rounded-pill border-[1.5px] px-4 py-[10px] text-[13.5px] font-medium transition-all duration-150",
                  fears.includes(f.v)
                    ? "border-ink-primary bg-ink-primary text-canvas"
                    : "border-[var(--border-default)] bg-transparent text-ink-primary hover:border-ink-primary",
                )}
              >
                {f.l}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Кнопки снизу */}
      <div className="px-6 pb-10 pt-2">
        {error && (
          <p className="mb-3 text-center text-[13px] text-accent">{error}</p>
        )}

        {step === 5 ? (
          <button
            onClick={finish}
            disabled={saving}
            className="h-[54px] w-full rounded-pill bg-ink-primary text-[15px] font-medium text-canvas transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
          >
            {saving ? "Сохраняем…" : "Готово"}
          </button>
        ) : (
          <button
            onClick={next}
            disabled={nextDisabled}
            className="h-[54px] w-full rounded-pill bg-ink-primary text-[15px] font-medium text-canvas transition-all hover:bg-accent disabled:pointer-events-none disabled:bg-ink-faint"
          >
            Дальше
          </button>
        )}
      </div>
    </div>
  );
}
