"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClientComponentClient } from "@/lib/supabase";
import { markCycleStart } from "@/lib/rhythm/cycles";

interface RhythmOnboardingProps {
  userId: string;
  todayStr: string;
}

export function RhythmOnboarding({ userId, todayStr }: RhythmOnboardingProps) {
  const router = useRouter();
  const [supabase] = useState(() => createClientComponentClient());

  // Максимум 60 дней назад
  const minDate = (() => {
    const d = new Date(todayStr);
    d.setUTCDate(d.getUTCDate() - 60);
    return d.toISOString().slice(0, 10);
  })();

  const [date, setDate] = useState(todayStr);
  const [cycleLen, setCycleLen] = useState(28);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setSaving(true);
    setError(null);
    // Insert cycle with user-provided cycle_length as default
    const { error: err } = await supabase
      .from("rhythm_cycles")
      .insert({ user_id: userId, started_at: date, cycle_length: cycleLen });
    if (err) {
      setError("Не получилось сохранить. Попробуй ещё раз.");
      setSaving(false);
      return;
    }
    router.refresh();
  }

  void markCycleStart; // used in RhythmContent

  return (
    <div className="flex-1 overflow-y-auto pb-tabbar lg:pb-10">
      <div className="mx-auto flex w-full max-w-[480px] flex-col px-5 py-10 lg:px-8">
        {/* Заголовок */}
        <div className="mb-8">
          <div className="mb-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
            Мой ритм
          </div>
          <h1 className="mb-3 font-serif text-[26px] font-normal leading-tight tracking-[-0.02em] text-ink-primary">
            Настроим ритм
          </h1>
          <p className="text-[14px] leading-[1.6] text-ink-secondary">
            Мне нужна одна дата: когда начались последние месячные. Дальше я всё посчитаю сама и буду обновлять прогноз после каждой твоей отметки.
          </p>
        </div>

        {/* Форма */}
        <div className="flex flex-col gap-5">
          {/* Дата */}
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              Начало последних месячных
            </label>
            <input
              type="date"
              value={date}
              min={minDate}
              max={todayStr}
              onChange={(e) => setDate(e.target.value)}
              className="block h-12 w-full min-w-0 appearance-none rounded-[14px] border border-line-default bg-canvas px-4 text-center text-[15px] text-ink-primary outline-none transition-colors focus:border-accent [-webkit-appearance:none] [&::-webkit-date-and-time-value]:text-center [&::-webkit-datetime-edit]:text-center [&::-webkit-datetime-edit-fields-wrapper]:justify-center"
            />
          </div>

          {/* Длина цикла */}
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              Длина цикла (дней)
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setCycleLen((v) => Math.max(21, v - 1))}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-line-default bg-canvas text-[20px] text-ink-primary transition-colors hover:bg-surface-nika"
                aria-label="Уменьшить длину цикла"
              >
                −
              </button>
              <div className="flex-1 rounded-[14px] border border-line-default bg-canvas py-2 text-center text-[20px] font-medium text-ink-primary">
                {cycleLen}
              </div>
              <button
                type="button"
                onClick={() => setCycleLen((v) => Math.min(35, v + 1))}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-line-default bg-canvas text-[20px] text-ink-primary transition-colors hover:bg-surface-nika"
              >
                +
              </button>
            </div>
            <p className="mt-2 text-[11.5px] leading-[1.5] text-ink-muted">
              Если сомневаешься, оставь 28, я уточню по твоим отметкам.
            </p>
          </div>

          {error && <p className="text-[13px] text-accent">{error}</p>}

          <button
            type="button"
            onClick={handleStart}
            disabled={saving}
            className="h-12 w-full rounded-full bg-ink-primary text-[15px] font-medium text-[var(--bg-primary)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Сохраняем…" : "Начать"}
          </button>
        </div>

        {/* Дисклеймер */}
        <p className="mt-8 text-center text-[11px] leading-[1.6] text-ink-muted">
          Мой ритм про бег и самочувствие. С медицинскими вопросами лучше к специалисту.
        </p>
      </div>
    </div>
  );
}
