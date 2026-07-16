"use client";

import { useState, useCallback, useMemo } from "react";
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
  type RhythmDay,
  type WeekRecap,
  type SprintSummary,
} from "@/lib/sprint";
import { cn } from "@/lib/utils";
import type { Sprint, WeeklyFocus } from "@/types/app";
import { INTENSITY_COLORS, tokenize, type WordFreq } from "@/lib/analytics";
import { WordCloud } from "@/components/analytics/WordCloud";
import { PatternCard } from "@/components/analytics/PatternCard";
import { InfoNote } from "@/components/analytics/InfoNote";

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

// ─── Хронология: рекапы и чек-ины ─────────────────────────────────────────────

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function formatCheckinDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}

/** Мини-рекап недели: пробежки / тяжёлые / пропуски / частое слово. */
function RecapLine({ recap }: { recap?: WeekRecap }) {
  if (!recap) return null;
  const { week, runs, hard, skipped, topWord } = recap;
  return (
    <p className="text-[13px] leading-[1.5] text-ink-secondary">
      Неделя {week}: {runs} {plural(runs, "пробежка", "пробежки", "пробежек")}
      {hard > 0 && `, из них ${hard} ${plural(hard, "тяжёлая", "тяжёлые", "тяжёлых")}`}
      {" · "}
      {skipped} {plural(skipped, "день", "дня", "дней")} без пробежки
      {topWord && ` · чаще всего «${topWord}»`}
    </p>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden
      className={cn("flex-shrink-0 text-ink-muted", open && "rotate-180")}
    >
      <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Свёрнутый (прошедший) чек-ин: аккордеон рекап + зафиксированный тогда фокус. */
function CollapsedCheckin({
  weekNumber, recap, focusEntry,
}: { weekNumber: 2 | 3; recap?: WeekRecap; focusEntry?: WeeklyFocus }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-[18px] py-3.5 text-left"
      >
        <span className="min-w-0">
          <span className="block font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
            Чек-ин · неделя {weekNumber}
          </span>
          <span className="mt-0.5 block truncate text-[14px] text-ink-primary">
            {focusEntry ? focusEntry.focus_text : <span className="text-ink-muted">Фокус не был задан</span>}
          </span>
        </span>
        <Chevron open={open} />
      </button>
      {open && (
        <div className="border-t border-line-subtle px-[18px] py-3.5">
          <RecapLine recap={recap} />
          {focusEntry && (
            <p className="mt-2 text-[13px] leading-[1.5] text-ink-secondary">
              <span className="text-ink-muted">{formatCheckinDate(focusEntry.set_at)} · </span>
              выбранный фокус: <span className="text-ink-primary">«{focusEntry.focus_text}»</span>
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/** Развёрнутый (текущий) чек-ин: рекап прошлой недели + поле фокуса. */
function ActiveCheckinCard({
  weekNumber, recap, value, onChange, onSave, saving,
}: {
  weekNumber: 2 | 3;
  recap?: WeekRecap;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <Card className="border-accent/30 bg-surface-nika">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
          Чек-ин · неделя {weekNumber}
        </span>
        <span className="rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-accent">
          Сейчас
        </span>
      </div>
      {recap && <div className="mb-3">
        <RecapLine recap={recap} />
      </div>}
      <p className="mb-3 text-[14px] leading-[1.5] text-ink-secondary">
        Начинается новая неделя спринта. На чём сосредоточишься?
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Мой фокус на эту неделю..."
        rows={2}
        className="w-full resize-none rounded-xl border border-line-subtle bg-elevated px-3 py-2.5 text-[14px] text-ink-primary placeholder:text-ink-faint focus:border-accent focus:outline-none"
      />
      <button
        onClick={onSave}
        disabled={saving || !value.trim()}
        className="mt-3 rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40"
      >
        Сохранить фокус
      </button>
    </Card>
  );
}

/** Строка вертикального таймлайна: маркер + коннектор + контент. */
function TimelineRow({
  marker, last, children,
}: { marker: React.ReactNode; last?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex w-3 flex-shrink-0 flex-col items-center pt-1.5">
        {marker}
        {!last && <span className="mt-1.5 w-px flex-1 bg-line-subtle" />}
      </div>
      <div className={cn("min-w-0 flex-1", !last && "pb-3")}>{children}</div>
    </div>
  );
}

function TimelineMarker({ variant }: { variant: "done" | "active" | "locked" }) {
  return (
    <span
      className={cn(
        "h-3 w-3 rounded-full",
        variant === "active" && "bg-accent ring-2 ring-accent/25",
        variant === "done" && "bg-accent/40",
        variant === "locked" && "border border-line-default bg-elevated",
      )}
    />
  );
}

/** Тёплый итог спринта над полем рефлексии (день 21 и досрочное закрытие). */
function ClosingSummary({ summary }: { summary: SprintSummary }) {
  const { totalRuns, runsByWeek, achievedMilestones, topWords } = summary;
  return (
    <div className="mb-4 rounded-xl border border-line-subtle bg-surface-warm p-4">
      <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
        Итог спринта
      </p>
      <p className="text-[15px] leading-[1.5] text-ink-primary">
        Всего пробежек: <span className="font-semibold text-accent">{totalRuns}</span>
        {totalRuns > 0 && (
          <span className="text-ink-secondary"> · по неделям {runsByWeek.join(" · ")}</span>
        )}
      </p>
      {achievedMilestones.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
            Что получилось отметить
          </p>
          <ul className="flex flex-col gap-1">
            {achievedMilestones.map((label, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px] leading-[1.5] text-ink-secondary">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden className="mt-[3px] flex-shrink-0 text-accent">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {label}
              </li>
            ))}
          </ul>
        </div>
      )}
      {topWords.length > 0 && (
        <p className="mt-3 text-[13px] leading-[1.5] text-ink-secondary">
          Чаще всего звучало: {topWords.map((w) => `«${w}»`).join(", ")}
        </p>
      )}
    </div>
  );
}

// Кольцо-подсветка сегодняшнего дня (offset под цвет карточки).
const TODAY_RING = "ring-2 ring-accent ring-offset-2 ring-offset-[var(--bg-elevated)]";

function RhythmDot({ day }: { day: RhythmDay }) {
  const ring = day.state === "today" ? TODAY_RING : "";
  // Есть пробежка → заливка цветом интенсивности.
  if (day.intensity) {
    return (
      <span
        title={`День ${day.dayNumber}`}
        className={cn("h-6 w-6 rounded-full", ring)}
        style={{ backgroundColor: INTENSITY_COLORS[day.intensity] }}
      />
    );
  }
  // Пробежки не было: будущий день — приглушённый пунктир, прошедший — сплошной контур.
  return (
    <span
      title={`День ${day.dayNumber}`}
      className={cn(
        "h-6 w-6 rounded-full border",
        day.state === "future" ? "border-dashed border-line-subtle" : "border-ink-muted",
        ring,
      )}
    />
  );
}

function RhythmGrid({ rhythm }: { rhythm: RhythmDay[] }) {
  const weeks: RhythmDay[][] = [rhythm.slice(0, 7), rhythm.slice(7, 14), rhythm.slice(14, 21)];
  return (
    <div className="flex flex-col gap-2.5">
      {weeks.map((week, wi) => (
        <div key={wi} className="flex items-center gap-3">
          <span className="w-6 flex-shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
            Н{wi + 1}
          </span>
          <div className="flex gap-2 sm:gap-2.5">
            {week.map((day) => (
              <RhythmDot key={day.dayNumber} day={day} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RhythmLegend() {
  const items = [
    { label: "легко", color: INTENSITY_COLORS.easy },
    { label: "средне", color: INTENSITY_COLORS.medium },
    { label: "тяжело", color: INTENSITY_COLORS.hard },
    { label: "не было", outline: true as const },
  ];
  return (
    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-xs text-ink-secondary">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={"outline" in it ? { border: "1px solid var(--ink-muted)" } : { backgroundColor: it.color }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ─── Основной компонент ───────────────────────────────────────────────────────

interface Props {
  sprint: Sprint;
  userId: string;
  sprintRhythm: RhythmDay[];
  weekRecaps: WeekRecap[];
  summary: SprintSummary;
  wordFreqs: WordFreq[];
  convCount: number;
}

export function SprintDashboard({ sprint: initialSprint, userId, sprintRhythm, weekRecaps, summary, wordFreqs, convCount }: Props) {
  const router = useRouter();
  const [supabase] = useState(() => createClientComponentClient());
  const [sprint, setSprint] = useState<Sprint>(initialSprint);

  const day = sprintDay(sprint);
  const clampedDay = Math.min(day, TOTAL_DAYS);
  const week = sprintWeek(day);
  const arch = ARCHETYPES[sprint.archetype_id];
  const focus = currentWeeklyFocus(sprint);

  // Хронология: рекап недели, зафиксированный фокус недели, текущий фокус-состояние.
  const recapForWeek = (w: 1 | 2 | 3) => weekRecaps.find((r) => r.week === w);
  const focusByWeek = (w: 2 | 3) => sprint.weekly_focus.find((f) => f.week_number === w);
  const daysLeft = TOTAL_DAYS - day; // N в «через N дней» до финиша (день 21)
  const currentFocusEntry = sprint.weekly_focus.length
    ? sprint.weekly_focus[sprint.weekly_focus.length - 1]
    : null;

  // Слова цели + текущего фокуса — для подсветки в облаке (тот же tokenize).
  const goalWordSet = useMemo(
    () => new Set([...tokenize(sprint.goal_text), ...tokenize(focus)]),
    [sprint.goal_text, focus],
  );

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

      {/* Прогресс — ритм спринта 3×7, окрашен по реальной интенсивности пробежек */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <SectionLabel>Прогресс</SectionLabel>
          <span className="font-mono text-[11px] text-ink-muted">День {clampedDay} из {TOTAL_DAYS} · неделя {week}</span>
        </div>
        <Card>
          <RhythmGrid rhythm={sprintRhythm} />
          <RhythmLegend />
        </Card>
      </section>

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
              <p className="font-serif italic text-[17px] leading-[1.4] text-accent">{sprint.goal_text}</p>
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

      {/* Фокус сейчас — состояние (ввод живёт в чек-ине хронологии) */}
      <section>
        <SectionLabel>Фокус сейчас</SectionLabel>
        <Card>
          <p className="font-serif text-[16px] italic leading-[1.5] text-ink-primary">
            {focus}
          </p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
            {currentFocusEntry
              ? `задан на чек-ине недели ${currentFocusEntry.week_number} · ${formatCheckinDate(currentFocusEntry.set_at)}`
              : `фокус недели ${week} · по умолчанию`}
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

      {/* Наблюдения */}
      <section>
        <SectionLabel>Наблюдения · с начала спринта</SectionLabel>
        <p className="mb-3 text-[14px] leading-[1.6] text-ink-secondary">
          Что происходило. <em className="italic text-accent">Без оценки.</em>
        </p>
        <div className="flex flex-col gap-3">
          {wordFreqs.length > 0 && (
            <Card>
              <p className="mb-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                Облако слов
              </p>
              <WordCloud words={wordFreqs} highlight={goalWordSet} />
            </Card>
          )}
          <Card>
            <PatternCard count={convCount} topWord={wordFreqs[0]?.text} />
          </Card>
          <InfoNote />
        </div>
      </section>

      {/* Хронология — чек-ины и финиш спринта */}
      <section>
        <SectionLabel>Хронология</SectionLabel>
        <div className="flex flex-col">

          {/* Чек-ин недели 2 — открывается на дне 8 */}
          {day >= 8 && (
            <TimelineRow marker={<TimelineMarker variant={checkinWeek === 2 ? "active" : "done"} />}>
              {checkinWeek === 2 ? (
                <ActiveCheckinCard
                  weekNumber={2}
                  recap={recapForWeek(1)}
                  value={checkinText}
                  onChange={setCheckinText}
                  onSave={handleCheckin}
                  saving={checkinSaving}
                />
              ) : (
                <CollapsedCheckin weekNumber={2} recap={recapForWeek(1)} focusEntry={focusByWeek(2)} />
              )}
            </TimelineRow>
          )}

          {/* Чек-ин недели 3 — открывается на дне 15 */}
          {day >= 15 && (
            <TimelineRow marker={<TimelineMarker variant={checkinWeek === 3 ? "active" : "done"} />}>
              {checkinWeek === 3 ? (
                <ActiveCheckinCard
                  weekNumber={3}
                  recap={recapForWeek(2)}
                  value={checkinText}
                  onChange={setCheckinText}
                  onSave={handleCheckin}
                  saving={checkinSaving}
                />
              ) : (
                <CollapsedCheckin weekNumber={3} recap={recapForWeek(2)} focusEntry={focusByWeek(3)} />
              )}
            </TimelineRow>
          )}

          {/* Финиш — запертая превью-карточка до дня 21, форма закрытия на дне 21 */}
          <TimelineRow last marker={<TimelineMarker variant={day >= TOTAL_DAYS ? "active" : "locked"} />}>
            {day >= TOTAL_DAYS ? (
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
                <ClosingSummary summary={summary} />
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
            ) : (
              <Card>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                  Итоги спринта · день 21
                </p>
                <p className="mt-2 text-[14px] leading-[1.5] text-ink-secondary">
                  Итоги появятся здесь, когда спринт завершится.
                </p>
                <p className="mt-1 text-[13px] text-ink-muted">
                  через {daysLeft} {plural(daysLeft, "день", "дня", "дней")}
                </p>
              </Card>
            )}
          </TimelineRow>
        </div>

        {/* Досрочное закрытие — доступно до дня 21 */}
        {day < TOTAL_DAYS && (
          <div className="mt-3 pl-6">
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
                <ClosingSummary summary={summary} />
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
          </div>
        )}
      </section>

    </div>
  );
}
