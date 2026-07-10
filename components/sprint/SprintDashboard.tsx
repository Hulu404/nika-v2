"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClientComponentClient } from "@/lib/supabase";
import { ARCHETYPES } from "@/lib/archetypes";
import {
  sprintDay,
  sprintWeek,
  currentWeeklyFocus,
  toggleMilestone,
  updateSprintGoal,
  saveWeeklyFocus,
  closeSprint,
} from "@/lib/sprint";
import { cn } from "@/lib/utils";
import type { Sprint } from "@/types/app";

const TOTAL_DAYS = 21;

// ─── Маленькие компоненты ────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
      {children}
    </p>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-card border border-line-subtle bg-elevated p-[18px]", className)}>
      {children}
    </div>
  );
}

function ProgressDots({ filled, total }: { filled: number; total: number }) {
  return (
    <div className="flex flex-wrap gap-[3px]">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={i < filled
            ? "h-[6px] w-[6px] rounded-full bg-accent"
            : "h-[6px] w-[6px] rounded-full bg-line-subtle"}
        />
      ))}
    </div>
  );
}

// ─── Основной компонент ───────────────────────────────────────────────────────

interface Props {
  sprint: Sprint;
  userId: string;
}

export function SprintDashboard({ sprint: initialSprint, userId }: Props) {
  const router = useRouter();
  const [supabase] = useState(() => createClientComponentClient());
  const [sprint, setSprint] = useState<Sprint>(initialSprint);

  const day = sprintDay(sprint);
  const clampedDay = Math.min(day, TOTAL_DAYS);
  const week = sprintWeek(day);
  const arch = ARCHETYPES[sprint.archetype_id];
  const focus = currentWeeklyFocus(sprint);

  // ── Редактирование цели ──────────────────────────────────────────────────────

  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState(sprint.goal_text);
  const [goalSaving, setGoalSaving] = useState(false);

  const saveGoal = useCallback(async () => {
    const trimmed = goalDraft.trim();
    if (!trimmed || trimmed === sprint.goal_text) { setEditingGoal(false); return; }
    setGoalSaving(true);
    try {
      await updateSprintGoal(supabase, sprint.id, trimmed);
      setSprint((s) => ({ ...s, goal_text: trimmed }));
      setEditingGoal(false);
    } finally {
      setGoalSaving(false);
    }
  }, [goalDraft, sprint.goal_text, sprint.id, supabase]);

  // ── Ориентиры ────────────────────────────────────────────────────────────────

  const handleToggleMilestone = useCallback(async (milestoneId: string) => {
    await toggleMilestone(supabase, sprint, milestoneId);
    setSprint((s) => ({
      ...s,
      milestones: s.milestones.map((m) =>
        m.id === milestoneId
          ? { ...m, achieved_at: m.achieved_at ? null : new Date().toISOString() }
          : m,
      ),
    }));
  }, [supabase, sprint]);

  // ── Еженедельный чек-ин ──────────────────────────────────────────────────────

  // Показываем чек-ин на день 8 (неделя 2) и день 15 (неделя 3), если фокус этой
  // недели ещё не установлен.
  const checkinWeek: 2 | 3 | null =
    day >= 8 && day < 15 && !sprint.weekly_focus.find((f) => f.week_number === 2) ? 2
    : day >= 15 && !sprint.weekly_focus.find((f) => f.week_number === 3) ? 3
    : null;

  const [checkinText, setCheckinText] = useState("");
  const [checkinSaving, setCheckinSaving] = useState(false);

  const handleCheckin = useCallback(async () => {
    if (!checkinText.trim() || checkinWeek === null) return;
    setCheckinSaving(true);
    try {
      await saveWeeklyFocus(supabase, sprint, checkinText.trim(), checkinWeek);
      setSprint((s) => ({
        ...s,
        weekly_focus: [
          ...s.weekly_focus.filter((f) => f.week_number !== checkinWeek),
          { week_number: checkinWeek, focus_text: checkinText.trim(), set_at: new Date().toISOString() },
        ],
      }));
      setCheckinText("");
    } finally {
      setCheckinSaving(false);
    }
  }, [supabase, sprint, checkinText, checkinWeek]);

  // ── Закрытие спринта ─────────────────────────────────────────────────────────

  const [showClose, setShowClose] = useState(false);
  const [closingReflection, setClosingReflection] = useState("");
  const [closingSaving, setClosingSaving] = useState(false);

  const handleClose = useCallback(async () => {
    setClosingSaving(true);
    try {
      await closeSprint(supabase, sprint.id, closingReflection.trim() || null);
      router.push("/today");
      router.refresh();
    } finally {
      setClosingSaving(false);
    }
  }, [supabase, sprint.id, closingReflection, router]);

  // ── Рендер ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5">

      {/* Прогресс */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <SectionLabel>Прогресс</SectionLabel>
          <span className="font-mono text-[11px] text-ink-muted">День {clampedDay} из {TOTAL_DAYS} · неделя {week}</span>
        </div>
        <Card>
          <ProgressDots filled={clampedDay} total={TOTAL_DAYS} />
        </Card>
      </section>

      {/* Еженедельный чек-ин */}
      {checkinWeek !== null && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <SectionLabel>Чек-ин · неделя {checkinWeek}</SectionLabel>
            <span className="mb-2 rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-accent">
              Новое
            </span>
          </div>
          <Card className="border-accent/30 bg-surface-nika">
            <p className="mb-3 text-[14px] leading-[1.5] text-ink-secondary">
              Начинается новая неделя спринта. На чём сосредоточишься?
            </p>
            <textarea
              value={checkinText}
              onChange={(e) => setCheckinText(e.target.value)}
              placeholder="Мой фокус на эту неделю..."
              rows={2}
              className="w-full resize-none rounded-xl border border-line-subtle bg-elevated px-3 py-2.5 text-[14px] text-ink-primary placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
            <button
              onClick={handleCheckin}
              disabled={checkinSaving || !checkinText.trim()}
              className="mt-3 rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40"
            >
              Сохранить фокус
            </button>
          </Card>
        </section>
      )}

      {/* Цель */}
      <section>
        <SectionLabel>Цель спринта</SectionLabel>
        <Card>
          {editingGoal ? (
            <div>
              <textarea
                autoFocus
                value={goalDraft}
                onChange={(e) => setGoalDraft(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-xl border border-line-subtle bg-surface-warm px-3 py-2.5 text-[15px] text-ink-primary focus:border-accent focus:outline-none"
              />
              <div className="mt-3 flex gap-2">
                <button
                  onClick={saveGoal}
                  disabled={goalSaving || !goalDraft.trim()}
                  className="rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
                >
                  Сохранить
                </button>
                <button
                  onClick={() => { setEditingGoal(false); setGoalDraft(sprint.goal_text); }}
                  className="rounded-full border border-line-subtle px-4 py-2 text-[13px] text-ink-secondary"
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <p className="font-serif text-[17px] leading-[1.4] text-ink-primary">{sprint.goal_text}</p>
              <button
                onClick={() => { setGoalDraft(sprint.goal_text); setEditingGoal(true); }}
                className="flex-shrink-0 text-[12px] text-ink-muted underline-offset-2 hover:underline"
              >
                Изменить
              </button>
            </div>
          )}
        </Card>
      </section>

      {/* Фокус недели */}
      <section>
        <SectionLabel>Фокус недели {week}</SectionLabel>
        <Card>
          <p className="font-serif text-[16px] italic leading-[1.5] text-ink-primary">
            {focus}
          </p>
        </Card>
      </section>

      {/* Ориентиры */}
      {sprint.milestones_enabled && sprint.milestones.length > 0 && (
        <section>
          <SectionLabel>Ориентиры</SectionLabel>
          <Card className="flex flex-col divide-y divide-line-subtle p-0">
            {sprint.milestones.map((m) => (
              <button
                key={m.id}
                onClick={() => handleToggleMilestone(m.id)}
                className="flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-warm"
              >
                <span className={cn(
                  "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border transition-colors",
                  m.achieved_at
                    ? "border-accent bg-accent text-white"
                    : "border-line-default bg-transparent",
                )}>
                  {m.achieved_at && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className={cn(
                  "flex-1 text-[14px] leading-snug",
                  m.achieved_at ? "text-ink-muted line-through" : "text-ink-primary",
                )}>
                  {m.label}
                </span>
              </button>
            ))}
          </Card>
        </section>
      )}

      {/* Советы архетипа */}
      <section>
        <SectionLabel>Советы для тебя</SectionLabel>
        <div className="flex flex-col gap-2">
          {arch.tips.map((tip, i) => (
            <Card key={i}>
              <p className="text-[14px] leading-[1.5] text-ink-secondary">{tip}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Экран завершения на день 21 */}
      {day >= TOTAL_DAYS ? (
        <section>
          <Card className="border-accent/30 bg-surface-nika">
            <p className="mb-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-accent">
              Спринт завершён · день 21
            </p>
            <h3 className="mb-3 font-serif text-[20px] leading-[1.3] text-ink-primary">
              Ты дошёл(шла) до конца. Это уже много.
            </h3>
            <p className="mb-4 text-[13px] leading-[1.5] text-ink-secondary">
              Можешь оставить пару слов — что было важным, что изменилось. Или просто закрыть.
            </p>
            <textarea
              value={closingReflection}
              onChange={(e) => setClosingReflection(e.target.value)}
              placeholder="Необязательно..."
              rows={3}
              className="w-full resize-none rounded-xl border border-line-subtle bg-elevated px-3 py-2.5 text-[14px] text-ink-primary placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={handleClose}
                disabled={closingSaving}
                className="rounded-full bg-accent py-3 text-[14px] font-semibold text-white disabled:opacity-40"
              >
                Закрыть спринт
              </button>
              <button
                onClick={async () => {
                  await handleClose();
                  router.push("/sprint/setup");
                }}
                disabled={closingSaving}
                className="rounded-full border border-accent/40 py-3 text-[14px] font-semibold text-accent disabled:opacity-40"
              >
                Закрыть и начать новый
              </button>
            </div>
          </Card>
        </section>
      ) : (
        /* Досрочное закрытие */
        <section className="mt-2">
          {!showClose ? (
            <button
              onClick={() => setShowClose(true)}
              className="text-[13px] text-ink-muted underline-offset-2 hover:underline"
            >
              Закрыть спринт досрочно
            </button>
          ) : (
            <Card>
              <p className="mb-3 text-[14px] text-ink-secondary">
                Хочешь закрыть спринт? Можешь оставить заметку — что было важным.
              </p>
              <textarea
                value={closingReflection}
                onChange={(e) => setClosingReflection(e.target.value)}
                placeholder="Необязательно..."
                rows={3}
                className="w-full resize-none rounded-xl border border-line-subtle bg-surface-warm px-3 py-2.5 text-[14px] text-ink-primary placeholder:text-ink-faint focus:border-accent focus:outline-none"
              />
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleClose}
                  disabled={closingSaving}
                  className="rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
                >
                  Закрыть спринт
                </button>
                <button
                  onClick={() => setShowClose(false)}
                  className="rounded-full border border-line-subtle px-4 py-2 text-[13px] text-ink-secondary"
                >
                  Отмена
                </button>
              </div>
            </Card>
          )}
        </section>
      )}

    </div>
  );
}
