"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClientComponentClient } from "@/lib/supabase";
import {
  fmtDateRu,
  markCycleStart,
  undoLastMark,
  deleteAllCycleData,
  exportCycleData,
  PHASE_META,
  type Phase,
  type CycleRecord,
  type AdviceRecord,
  type CheckinRecord,
} from "@/lib/rhythm/cycles";
import { CycleGrid } from "@/components/rhythm/CycleGrid";
import { Ahead } from "@/components/rhythm/Ahead";
import { BottomSheet } from "@/components/BottomSheet";
import { cn } from "@/lib/utils";

const CHECKIN_TAGS: { key: string; label: string }[] = [
  { key: "energy",      label: "энергия" },
  { key: "fatigue",     label: "усталость" },
  { key: "calm",        label: "спокойно" },
  { key: "cramps",      label: "тянет живот" },
  { key: "sensitivity", label: "чувствительность" },
  { key: "lightness",   label: "лёгкость" },
];

const DISCUSS_HREF = "/chat?context=rhythm";

interface RhythmContentProps {
  userId: string;
  todayStr: string;
  cycles: CycleRecord[];
  cycleDay: number;
  cycleLen: number;
  phase: Phase;
  isOverdue: boolean;
  checkin: CheckinRecord | null;
  advice: AdviceRecord | null;
  completedCycles: number;
  displayName: string;
}

export function RhythmContent({
  userId,
  todayStr,
  cycles,
  cycleDay,
  cycleLen,
  phase,
  isOverdue,
  checkin: initialCheckin,
  advice: initialAdvice,
  completedCycles,
}: RhythmContentProps) {
  const router = useRouter();
  const [supabase] = useState(() => createClientComponentClient());

  const meta = PHASE_META[phase];
  const latestCycle = cycles[0];
  const prevCycle = cycles[1] ?? null;

  // ── Advice ───────────────────────────────────────────────────────────────────
  const [advice, setAdvice] = useState<AdviceRecord | null>(initialAdvice);
  const [adviceLoading, setAdviceLoading] = useState(!initialAdvice && !isOverdue);

  useEffect(() => {
    if (initialAdvice || isOverdue) return;
    let cancelled = false;
    fetch("/api/rhythm/advice", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { advice_short: string; advice_full: string } | null) => {
        if (d && !cancelled) {
          setAdvice({ advice_short: d.advice_short, advice_full: d.advice_full });
          setAdviceLoading(false);
        }
      })
      .catch(() => { if (!cancelled) setAdviceLoading(false); });
    return () => { cancelled = true; };
  }, [initialAdvice, isOverdue]);

  // ── Check-in ─────────────────────────────────────────────────────────────────
  const [tags, setTags] = useState<Set<string>>(
    () => new Set(initialCheckin?.tags ?? []),
  );
  const [note, setNote] = useState(initialCheckin?.note ?? "");
  const [checkinSaving, setCheckinSaving] = useState(false);
  const [checkinSaved, setCheckinSaved] = useState(false);
  const [checkinError, setCheckinError] = useState<string | null>(null);

  const toggleTag = (key: string) =>
    setTags((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const saveCheckin = useCallback(async () => {
    setCheckinSaving(true);
    setCheckinError(null);
    const { error } = await supabase.from("rhythm_checkins").upsert(
      { user_id: userId, date: todayStr, tags: [...tags], note: note || null },
      { onConflict: "user_id,date" },
    );
    setCheckinSaving(false);
    if (error) {
      setCheckinError("Не получилось сохранить. Попробуй ещё раз.");
      return;
    }
    setCheckinSaved(true);
    setTimeout(() => setCheckinSaved(false), 2000);
  }, [supabase, userId, todayStr, tags, note]);

  // ── Отметка месячных ─────────────────────────────────────────────────────────
  const alreadyMarkedToday = latestCycle?.started_at === todayStr;
  const canUndo =
    alreadyMarkedToday &&
    latestCycle.created_at &&
    Date.now() - new Date(latestCycle.created_at).getTime() < 86_400_000;

  const [markSaving, setMarkSaving] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);

  const handleMark = useCallback(async () => {
    if (markSaving) return;
    setMarkSaving(true);
    setMarkError(null);
    const err = await markCycleStart(
      supabase, userId, todayStr,
      prevCycle?.id ?? null,
      prevCycle?.started_at ?? null,
    );
    setMarkSaving(false);
    if (err) { setMarkError(err); return; }
    router.refresh();
  }, [supabase, userId, todayStr, prevCycle, markSaving, router]);

  const handleUndo = useCallback(async () => {
    if (!latestCycle || markSaving) return;
    setMarkSaving(true);
    setMarkError(null);
    const err = await undoLastMark(supabase, userId, latestCycle.id, prevCycle?.id ?? null);
    setMarkSaving(false);
    if (err) { setMarkError(err); return; }
    router.refresh();
  }, [supabase, userId, latestCycle, prevCycle, markSaving, router]);

  // ── Данные / удаление ────────────────────────────────────────────────────────
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const handleExport = async () => {
    setSettingsBusy(true);
    try {
      const data = await exportCycleData(supabase, userId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `nika-rhythm-${todayStr}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { setSettingsError("Не удалось выгрузить данные."); }
    setSettingsBusy(false);
  };

  const handleDelete = async () => {
    setSettingsBusy(true);
    const err = await deleteAllCycleData(supabase, userId);
    setSettingsBusy(false);
    if (err) { setSettingsError(err); return; }
    setSettingsOpen(false);
    router.refresh();
  };

  // ── Hero (нейтральный если цикл просрочен) ───────────────────────────────────
  const heroBlock = isOverdue ? (
    <section className="mb-6">
      <div className="mb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
        Мой ритм
      </div>
      <h1 className="mb-3 font-serif text-[26px] font-normal leading-tight tracking-[-0.02em] text-ink-primary">
        Жду отметку нового цикла.
      </h1>
      <p className="text-[13.5px] leading-[1.6] text-ink-secondary">
        Прошло больше времени, чем обычно. Как только отметишь начало, прогноз обновится.
      </p>
    </section>
  ) : (
    <section className="mb-6">
      <div className="mb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
        Мой ритм · день {cycleDay} из {cycleLen}
      </div>
      <h1 className="mb-3 font-serif text-[26px] font-normal leading-tight tracking-[-0.02em] text-ink-primary">
        {meta.heroBefore}
        <em className="italic text-accent">{meta.heroEm}</em>
        {meta.heroAfter}
      </h1>
      <p className="text-[13.5px] leading-[1.6] text-ink-secondary">{meta.lede}</p>
    </section>
  );

  // ── Карточка «Ника сегодня» ──────────────────────────────────────────────────
  const nikaCard = (
    <div className="rounded-[14px] bg-surface-nika p-4">
      <div className="mb-3 flex items-start gap-3">
        <span className="mt-0.5 h-7 w-7 flex-shrink-0 rounded-full bg-nika-avatar" aria-hidden />
        <div className="min-w-0">
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-accent">
            Ника сегодня
          </div>
          {adviceLoading ? (
            <div className="space-y-2">
              <div className="h-3 w-4/5 rounded bg-surface-deep animate-pulse" />
              <div className="h-3 w-full rounded bg-surface-deep animate-pulse" />
              <div className="h-3 w-3/5 rounded bg-surface-deep animate-pulse" />
            </div>
          ) : advice ? (
            <p className="text-[13px] leading-[1.6] text-ink-primary">{advice.advice_full}</p>
          ) : isOverdue ? (
            <p className="text-[13px] leading-[1.6] text-ink-primary">
              Отмечу твоё самочувствие, как только обновим цикл.
            </p>
          ) : null}
          {!adviceLoading && (
            <div className="mt-2 text-[10px] text-ink-faint">
              Обновляется каждое утро · фаза + твой журнал
            </div>
          )}
        </div>
      </div>
      <Link
        href={DISCUSS_HREF}
        className="block w-full rounded-full bg-ink-primary py-2.5 text-center text-[13.5px] font-medium text-[var(--bg-primary)] transition-opacity hover:opacity-90"
      >
        Обсудить в чате
      </Link>
    </div>
  );

  // ── Карточка «Месячные начались?» ────────────────────────────────────────────
  const markCard = (
    <div className="rounded-card border border-line-subtle bg-surface-warm p-4">
      <div className="mb-1 font-serif text-[15.5px] font-medium text-ink-primary">
        Месячные начались?
      </div>
      <div className="mb-3 text-[12px] leading-[1.5] text-ink-secondary">
        Одно нажатие в месяц, и прогноз остаётся точным.
      </div>
      {markError && <p className="mb-2 text-[12px] text-accent">{markError}</p>}
      {alreadyMarkedToday ? (
        <div className="flex flex-col gap-1">
          <span className="text-[14px] font-medium text-ink-secondary opacity-60">
            Отмечено · {fmtDateRu(todayStr)}
          </span>
          {canUndo && (
            <button
              type="button"
              onClick={handleUndo}
              disabled={markSaving}
              className="text-left text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink-secondary disabled:opacity-50"
            >
              Отменить
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={handleMark}
          disabled={markSaving}
          className="w-full rounded-full border border-ink-primary py-2.5 text-[14px] font-medium text-ink-primary transition-colors hover:bg-surface-deep disabled:opacity-50"
        >
          {markSaving ? "Сохраняем…" : "Отметить начало"}
        </button>
      )}
    </div>
  );

  // ── Чек-ин ───────────────────────────────────────────────────────────────────
  const checkinBlock = (
    <div className="rounded-card border border-line-subtle bg-elevated p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="font-serif text-[17px] font-medium text-ink-primary">Как ты сегодня?</span>
        <span className="text-[11.5px] text-ink-muted">я подстроюсь</span>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {CHECKIN_TAGS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => toggleTag(key)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[12.5px] transition-all",
              tags.has(key)
                ? "border-ink-primary bg-ink-primary text-[var(--bg-primary)]"
                : "border-line-default bg-canvas text-ink-secondary hover:border-line-strong",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Пара слов, если хочется"
        rows={2}
        className="mb-3 w-full resize-none rounded-[14px] border border-line-default bg-canvas px-3.5 py-2.5 text-[13.5px] leading-[1.5] text-ink-primary placeholder:text-ink-faint outline-none transition-colors focus:border-accent"
      />
      {checkinError && <p className="mb-2 text-[12px] text-accent">{checkinError}</p>}
      <button
        type="button"
        onClick={saveCheckin}
        disabled={checkinSaving}
        className="h-10 w-full rounded-full bg-ink-primary text-[14px] font-medium text-[var(--bg-primary)] transition-opacity hover:opacity-90 disabled:opacity-50 lg:w-44"
      >
        {checkinSaved ? "Сохранено" : checkinSaving ? "Сохраняем…" : "Сохранить"}
      </button>
    </div>
  );

  // ── Ника заметила (≥ 2 завершённых цикла) ────────────────────────────────────
  const nikaObservation = completedCycles >= 2 ? (
    <div className="rounded-[14px] bg-surface-nika p-4">
      <div className="flex gap-3">
        <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-elevated text-accent">
          <svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden>
            <path d="M2 14C4 8 7 6 9 9C11 12 14 10 16 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-accent">
            Ника заметила
          </div>
          <p className="text-[13px] leading-[1.55] text-ink-primary">
            В фазе подъёма твои длинные пробежки стабильно быстрее, а слово «лёгкость» звучит чаще. Твоё тело уже знает свой ритм. Я помогу его услышать.
          </p>
        </div>
      </div>
    </div>
  ) : null;

  // ── Настройки / Мои данные ───────────────────────────────────────────────────
  const settingsModal = (
    <BottomSheet isOpen={settingsOpen} onClose={() => { setSettingsOpen(false); setConfirmDelete(false); setSettingsError(null); }} title="Мои данные">
      <p className="mb-4 rounded-card bg-surface-nika p-4 text-[13px] leading-[1.6] text-ink-secondary">
        Мой ритм про бег и самочувствие. Это подсказки, а за врачебной помощью лучше обратиться к специалисту. Данные хранятся только у тебя в профиле и работают на подстройку Ники.
      </p>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={handleExport}
          disabled={settingsBusy}
          className="flex min-h-[48px] w-full items-center justify-between rounded-card border border-line-default px-4 text-[15px] text-ink-primary hover:bg-surface-warm disabled:opacity-50"
        >
          Скачать мои данные
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden className="text-ink-muted">
            <path d="M9 2v9M5 8l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 15h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={settingsBusy}
            className="min-h-[48px] w-full rounded-card border border-line-default px-4 text-left text-[15px] text-accent hover:bg-surface-warm disabled:opacity-50"
          >
            Удалить мои данные ритма
          </button>
        ) : (
          <div className="rounded-card border border-line-default p-4">
            <p className="mb-3 text-[14px] leading-[1.6] text-ink-primary">Удалить все данные ритма? Это нельзя отменить.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)} disabled={settingsBusy} className="min-h-[44px] flex-1 rounded-full border border-line-default text-[14px] font-medium text-ink-primary hover:bg-surface-nika disabled:opacity-50">
                Отмена
              </button>
              <button type="button" onClick={handleDelete} disabled={settingsBusy} className="min-h-[44px] flex-[1.3] rounded-full bg-accent text-[14px] font-medium text-white hover:opacity-90 disabled:opacity-50">
                {settingsBusy ? "Удаляем…" : "Удалить"}
              </button>
            </div>
          </div>
        )}
      </div>
      {settingsError && <p className="mt-3 text-[13px] text-accent">{settingsError}</p>}
    </BottomSheet>
  );

  return (
    <div className="flex-1 overflow-y-auto pb-tabbar lg:pb-10">
      <div className="mx-auto w-full max-w-[1080px] px-5 py-8 lg:px-8 lg:py-10">

        {/* ── MOBILE ───────────────────────────────────────────────── */}
        <div className="flex flex-col gap-5 xl:hidden">
          {heroBlock}

          {/* Ника сегодня */}
          {!isOverdue && nikaCard}

          {/* Цикл */}
          {!isOverdue && (
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <span className="font-serif text-[17px] font-medium text-ink-primary">Цикл</span>
                <span className="text-[11.5px] text-ink-muted">{cycleLen} дней · прогноз</span>
              </div>
              <CycleGrid cycleLen={cycleLen} cycleDay={cycleDay} />
            </section>
          )}

          {/* Впереди */}
          {!isOverdue && (
            <section>
              <div className="mb-3">
                <span className="font-serif text-[17px] font-medium text-ink-primary">Впереди</span>
              </div>
              <Ahead
                latestCycleStartedAt={latestCycle.started_at}
                cycleDay={cycleDay}
                cycleLen={cycleLen}
                phase={phase}
              />
            </section>
          )}

          {/* Чек-ин */}
          <section>
            <div className="mb-3 sr-only">Как ты сегодня?</div>
            {checkinBlock}
          </section>

          {/* Отметить месячные (или поднять наверх если просрочено) */}
          {markCard}

          {/* Футноут */}
          <p className="text-center text-[11px] leading-[1.6] text-ink-muted">
            Мой ритм про бег и самочувствие. С медицинскими вопросами лучше к специалисту.{" "}
            <button type="button" onClick={() => setSettingsOpen(true)} className="underline underline-offset-2 hover:text-ink-secondary">
              Настройки ритма
            </button>
          </p>
        </div>

        {/* ── DESKTOP ──────────────────────────────────────────────── */}
        <div className="hidden xl:flex xl:gap-10">

          {/* Центр */}
          <div className="min-w-0 flex-1">
            {heroBlock}

            {!isOverdue && (
              <>
                {/* Цикл */}
                <section className="mb-6">
                  <div className="mb-3 flex items-baseline justify-between">
                    <span className="font-serif text-[17px] font-medium text-ink-primary">Цикл</span>
                    <span className="text-[11.5px] text-ink-muted">{cycleLen} дней · прогноз обновляется после каждой отметки</span>
                  </div>
                  <CycleGrid cycleLen={cycleLen} cycleDay={cycleDay} />
                </section>

                {/* Впереди — span full */}
                <section className="mb-6">
                  <div className="mb-3">
                    <span className="font-serif text-[17px] font-medium text-ink-primary">Впереди</span>
                  </div>
                  <Ahead
                    latestCycleStartedAt={latestCycle.started_at}
                    cycleDay={cycleDay}
                    cycleLen={cycleLen}
                    phase={phase}
                  />
                </section>

                {/* 2-колоночная сетка: чек-ин + наблюдение */}
                <div className="grid grid-cols-2 gap-5">
                  <section>
                    <div className="mb-3 flex items-baseline justify-between">
                      <span className="font-serif text-[17px] font-medium text-ink-primary">Как ты сегодня?</span>
                      <span className="text-[11.5px] text-ink-muted">я подстроюсь</span>
                    </div>
                    {checkinBlock}
                  </section>
                  {nikaObservation && (
                    <section>
                      <div className="mb-3 flex items-baseline justify-between">
                        <span className="font-serif text-[17px] font-medium text-ink-primary">Наблюдение</span>
                        <span className="text-[11.5px] text-ink-muted">за два цикла</span>
                      </div>
                      {nikaObservation}
                    </section>
                  )}
                </div>
              </>
            )}

            {isOverdue && (
              <div className="mt-4">{markCard}</div>
            )}
          </div>

          {/* Правый рейл */}
          <aside className="w-[320px] flex-shrink-0 space-y-5">
            {!isOverdue && nikaCard}
            {!isOverdue && markCard}

            {/* Мои данные */}
            <div className="rounded-card border border-line-subtle bg-elevated p-4">
              <div className="mb-1 text-[15px] font-semibold text-ink-primary">Мои данные</div>
              <button
                type="button"
                onClick={handleExport}
                className="flex w-full items-center justify-between border-b border-line-subtle py-2.5 text-[13px] text-ink-primary hover:text-ink-secondary"
              >
                Скачать мои данные
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M8 2v8m0 0 3-3M8 10 5 7M3 13h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <button
                type="button"
                onClick={() => { setSettingsOpen(true); }}
                className="py-2.5 text-[13px] text-accent hover:opacity-80"
              >
                Удалить мои данные ритма
              </button>
              <p className="mt-3 border-t border-line-subtle pt-3 text-[11px] leading-[1.55] text-ink-muted">
                Мой ритм про бег и самочувствие. Это подсказки, а за врачебной помощью лучше обратиться к специалисту.
              </p>
            </div>
          </aside>
        </div>
      </div>

      {settingsModal}
    </div>
  );
}
