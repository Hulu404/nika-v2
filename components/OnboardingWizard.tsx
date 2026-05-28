"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClientComponentClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { RunnerGoal } from "@/types/app";

// ──────────────────────────────── шаги ──────────────────────────────────────

const WHY_OPTIONS = [
  { v: "health",    l: "Здоровье",           d: "Хочу чувствовать себя лучше" },
  { v: "routine",   l: "Привычка",            d: "Стабильная практика" },
  { v: "race",      l: "Соревнование",        d: "Пробежать дистанцию" },
  { v: "stress",    l: "Снять стресс",        d: "Спорт как выход" },
] as const;

type Why = (typeof WHY_OPTIONS)[number]["v"];

// Поля нового онбординга маппятся на существующий profiles.goal.
// when/тон пока не сохраняем — для них нет колонок в схеме.
const WHY_TO_GOAL: Record<Why, RunnerGoal> = {
  routine: "habit",
  race: "race",
  stress: "anxiety",
  health: "not_quit",
};

const WHEN_CHIPS = ["Утром", "Днём", "Вечером", "Когда получится"];

// ──────────────────────────────── компонент ──────────────────────────────────

export function OnboardingWizard({ userId }: { userId: string }) {
  const router = useRouter();
  const [supabase] = useState(() => createClientComponentClient());

  const [step, setStep] = useState(0); // 0..5
  const [name, setName] = useState("");
  const [why, setWhy] = useState<Why | null>(null);
  const [when, setWhen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const TOTAL = 4; // шаги 1-4 (без финала)

  function next() { setStep((s) => s + 1); }
  function back() { setStep((s) => Math.max(0, s - 1)); }

  async function finish() {
    if (!why || saving) return;
    setSaving(true);
    setError(null);

    // Гейтинг завязан на profiles.goal — его обязательно сохраняем.
    const { error: saveError } = await supabase
      .from("profiles")
      .upsert(
        { user_id: userId, goal: WHY_TO_GOAL[why] },
        { onConflict: "user_id" },
      );

    if (saveError) {
      console.error("[onboarding] save failed:", saveError);
      setSaving(false);
      setError("Не получилось сохранить. Попробуй ещё раз.");
      return;
    }

    // Имя сохраняем best-effort: ошибка не должна блокировать вход.
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

  // ──────── Экран 0: Welcome ────────
  if (step === 0) {
    return (
      <div className="min-h-dvh flex flex-col bg-[var(--bg-primary)] relative overflow-hidden">
        {/* Фоновый градиент */}
        <div className="absolute top-[-40%] right-[-30%] w-full h-[80%] bg-[radial-gradient(circle,rgba(200,85,61,0.10),transparent_60%)] pointer-events-none" />
        <div className="absolute bottom-[-30%] left-[-20%] w-[80%] h-[60%] bg-[radial-gradient(circle,rgba(31,27,22,0.06),transparent_60%)] pointer-events-none" />

        <div className="flex flex-col flex-1 px-7 pt-[60px] pb-8 relative">
          {/* Аватар */}
          <div className="w-14 h-14 rounded-full bg-nika-avatar mb-6" />

          <div className="font-serif text-[36px] font-normal tracking-[-0.025em] text-ink-primary mb-4">
            НИКА
          </div>
          <div className="font-serif text-[24px] leading-[1.32] tracking-[-0.015em] text-ink-primary max-w-[90%]">
            Я не тренер.<br />
            Я рядом, чтобы ты{" "}
            <em className="italic text-accent">не бросил бег.</em>
          </div>

          <div className="mt-auto">
            <p className="text-[12.5px] text-ink-muted leading-[1.5] mb-5">
              Пара вопросов — и я буду знать, как быть рядом именно для тебя.
              Это займёт минуту.
            </p>
            <button
              onClick={next}
              className="w-full h-[54px] bg-ink-primary text-canvas rounded-pill text-[15px] font-medium hover:bg-accent transition-colors"
            >
              Начать
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ──────── Финальный экран ────────
  if (step > TOTAL) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-[var(--bg-primary)] px-7 text-center">
        {/* Пульсирующий аватар */}
        <div
          className="w-24 h-24 rounded-full bg-nika-avatar mb-8"
          style={{ animation: "pulse 2.4s ease-in-out infinite" }}
        />
        <style>{`@keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(200,85,61,0.3), 0 0 0 0 rgba(200,85,61,0.2); }
          50% { box-shadow: 0 0 0 12px rgba(200,85,61,0.05), 0 0 0 24px rgba(200,85,61,0.03); }
        }`}</style>

        <h1 className="font-serif text-[32px] tracking-[-0.02em] text-ink-primary mb-3">
          {name ? `Привет, ${name}.` : "Привет."}<br />
          <em className="italic text-accent">Я тут.</em>
        </h1>
        <p className="text-[15px] text-ink-secondary leading-[1.45] max-w-[280px] mb-10">
          Теперь я знаю о тебе чуть больше. Напиши когда будешь готов — я здесь.
        </p>
        {error && (
          <p className="mb-3 text-[13px] text-accent">{error}</p>
        )}
        <button
          onClick={finish}
          disabled={saving}
          className="w-full max-w-xs h-[54px] bg-ink-primary text-canvas rounded-pill text-[15px] font-medium hover:bg-accent transition-colors disabled:opacity-50 disabled:pointer-events-none"
        >
          {saving ? "Сохраняем…" : "Начать с НИКОЙ"}
        </button>
      </div>
    );
  }

  // ──────── Шаги 1–4 ────────
  return (
    <div className="min-h-dvh flex flex-col bg-[var(--bg-primary)]">
      {/* Progress bars */}
      <div className="flex gap-1 px-6 pt-[72px]">
        {Array.from({ length: TOTAL }).map((_, i) => (
          <div
            key={i}
            className="flex-1 h-[2px] rounded-full transition-colors"
            style={{ background: i < step ? "var(--ink-primary)" : "var(--border-default)" }}
          />
        ))}
      </div>

      {/* Back button */}
      {step > 1 && (
        <button
          onClick={back}
          className="absolute top-[64px] left-3 w-10 h-10 flex items-center justify-center text-ink-secondary"
          aria-label="Назад"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* Контент */}
      <div className="flex-1 px-6 pt-9 pb-4">

        {/* Вопрос в пузыре НИКИ */}
        <div className="bg-[var(--surface-nika)] px-[22px] py-5 rounded-bubble rounded-bl-[6px] font-serif text-[22px] leading-[1.35] tracking-[-0.01em] text-ink-primary max-w-[92%] mb-7">
          {step === 1 && "Как тебя зовут?"}
          {step === 2 && "Зачем ты бегаешь?"}
          {step === 3 && "Когда обычно бегаешь?"}
          {step === 4 && "Как тебе удобнее, чтобы я писала?"}
        </div>

        {/* Шаг 1: имя */}
        {step === 1 && (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Твоё имя"
            autoFocus
            className="w-full border-b-[1.5px] border-[var(--border-default)] bg-transparent pb-3 pt-2 text-[19px] font-serif text-ink-primary outline-none placeholder:text-ink-faint focus:border-ink-primary transition-colors"
          />
        )}

        {/* Шаг 2: зачем бегаешь (карточки) */}
        {step === 2 && (
          <div className="flex flex-col gap-2.5">
            {WHY_OPTIONS.map((o) => (
              <button
                key={o.v}
                onClick={() => setWhy(o.v)}
                className={cn(
                  "w-full text-left px-5 py-[18px] rounded-card border-[1.5px] transition-all",
                  why === o.v
                    ? "bg-ink-primary border-ink-primary text-canvas"
                    : "bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-ink-primary hover:border-[var(--border-strong)]",
                )}
              >
                <div className={cn("text-[16px] font-medium mb-1", why === o.v ? "text-canvas" : "")}>{o.l}</div>
                <div className={cn("text-[13px]", why === o.v ? "text-canvas/70" : "text-ink-muted")}>{o.d}</div>
              </button>
            ))}
          </div>
        )}

        {/* Шаг 3: когда бегаешь (чипы, multiple) */}
        {step === 3 && (
          <div className="flex flex-wrap gap-2">
            {WHEN_CHIPS.map((chip) => (
              <button
                key={chip}
                onClick={() =>
                  setWhen((prev) =>
                    prev.includes(chip) ? prev.filter((c) => c !== chip) : [...prev, chip],
                  )
                }
                className={cn(
                  "px-4 py-[9px] rounded-pill border-[1.5px] text-[13.5px] transition-all",
                  when.includes(chip)
                    ? "bg-ink-primary border-ink-primary text-canvas"
                    : "bg-transparent border-[var(--border-default)] text-ink-primary hover:border-ink-primary",
                )}
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        {/* Шаг 4: тон (карточки) */}
        {step === 4 && (
          <div className="flex flex-col gap-2.5">
            {[
              { l: "Тепло и поддерживающе",    d: "Как разговор с другом" },
              { l: "Прямо и без лишнего",       d: "Коротко, по делу" },
              { l: "Как получится",             d: "Подстраивайся под настроение" },
            ].map((o) => (
              <button
                key={o.l}
                onClick={next}
                className="w-full text-left px-5 py-[18px] rounded-card border-[1.5px] border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-ink-primary hover:border-[var(--border-strong)] transition-all"
              >
                <div className="text-[16px] font-medium mb-1">{o.l}</div>
                <div className="text-[13px] text-ink-muted">{o.d}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Кнопки внизу */}
      <div className="px-6 pb-10 pt-4">
        {step < 4 && (
          <button
            onClick={next}
            disabled={
              (step === 1 && !name.trim()) ||
              (step === 2 && !why) ||
              (step === 3 && when.length === 0)
            }
            className="w-full h-[54px] bg-ink-primary text-canvas rounded-pill text-[15px] font-medium transition-all hover:bg-accent disabled:bg-ink-faint disabled:pointer-events-none"
          >
            Дальше
          </button>
        )}
      </div>
    </div>
  );
}
