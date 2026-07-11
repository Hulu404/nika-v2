"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { createClientComponentClient } from "@/lib/supabase";
import { tipsAnalytics } from "@/lib/tips/analytics";
import {
  CATEGORY_DEFS,
  TIP_DEFS,
  categoryLabel,
  type CategoryDef,
  type Tip,
  type TipCategory,
} from "@/lib/tips/data";

/**
 * Экран «Советы» (/tips). Одна адаптивная раскладка: мобайл это одна колонка +
 * горизонтальный скролл чипов; десктоп это сетка 2-3 колонки + чипы в обёртку.
 * Все цвета через токены (тёмная тема приезжает сама).
 *
 * Закладки: initialSavedIds приходят с сервера (saved_tips, RLS). Тоггл идёт
 * оптимистично, затем insert/delete в Supabase через браузерный клиент (RLS
 * ограничивает своими). Для гостя (userId=null) закладки живут локально до входа.
 */

/** before/breathing/recovery: лёгкий accent-тон кружка иконки; technique/gear нейтральный. */
const CATEGORY_ACCENT_TINT: Record<TipCategory, boolean> = {
  before: true,
  technique: false,
  breathing: true,
  gear: false,
  recovery: true,
};

function CatIcon({ category }: { category: TipCategory }) {
  const common = { width: 18, height: 18, viewBox: "0 0 20 20", fill: "none", "aria-hidden": true } as const;
  switch (category) {
    case "before":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 6V10L13 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "technique":
      return (
        <svg {...common}>
          <path d="M6 5L10 10L6 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M11 5L15 10L11 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "breathing":
      return (
        <svg {...common}>
          <path d="M3 7H12A2 2 0 1 0 10 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M3 10.5H14A2 2 0 1 1 12 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M3 14H9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "gear":
      return (
        <svg {...common}>
          <path d="M3 14C3 12 5 11 7 11C8 9 10 8 12 8C14 8 16 9 17 11.5V14C17 15 16.2 15.5 15.2 15.5H4.2C3.5 15.5 3 15 3 14Z"
            stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      );
    case "recovery":
      return (
        <svg {...common}>
          <path d="M14.5 4A7 7 0 1 0 14.5 16A5.5 5.5 0 0 1 14.5 4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      );
  }
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill={filled ? "currentColor" : "none"} aria-hidden>
      <path d="M5 3.5C5 2.7 5.7 2 6.5 2H13.5C14.3 2 15 2.7 15 3.5V17L10 13.5L5 17V3.5Z"
        stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function TipCard({ tip, saved, onToggle }: { tip: Tip; saved: boolean; onToggle: () => void }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[16px] border border-line-subtle bg-elevated p-4 lg:p-5">
      <div className="flex items-center justify-between">
        <span
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-accent-deep"
          style={{
            background: CATEGORY_ACCENT_TINT[tip.category]
              ? "color-mix(in srgb, var(--accent) 14%, transparent)"
              : "color-mix(in srgb, var(--ink-primary) 6%, transparent)",
          }}
          aria-hidden
        >
          <CatIcon category={tip.category} />
        </span>

        <button
          type="button"
          onClick={onToggle}
          aria-pressed={saved}
          aria-label={saved ? "Убрать из сохранённого" : "Сохранить совет"}
          className={cn(
            "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition-colors motion-reduce:transition-none",
            saved ? "text-accent" : "text-ink-faint hover:text-ink-muted",
          )}
        >
          <BookmarkIcon filled={saved} />
        </button>
      </div>

      <div>
        <div className="mb-2 flex flex-col items-start gap-1.5">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-muted">
            {categoryLabel(tip.category)}
          </span>
          {tip.personal && (
            <span className="rounded-pill bg-accent-soft px-[7px] py-[2px] font-mono text-[9px] tracking-[0.04em] text-accent-deep">
              из твоих разговоров
            </span>
          )}
        </div>
        <h2 className="mb-1.5 font-serif text-[17px] font-medium leading-[1.3] tracking-[-0.01em] text-ink-primary">
          {tip.title}
        </h2>
        <p className="text-[13.5px] leading-[1.48] text-ink-secondary">{tip.body}</p>
      </div>
    </div>
  );
}

type Scope = "all" | "saved";

export function TipsContent({
  initialSavedIds,
  userId,
}: {
  initialSavedIds: number[];
  userId: string | null;
}) {
  const supabase = useMemo(() => createClientComponentClient(), []);
  const [saved, setSaved] = useState<Set<number>>(() => new Set(initialSavedIds));
  const [scope, setScope] = useState<Scope>("all");
  const [category, setCategory] = useState<CategoryDef["id"]>("all");

  useEffect(() => {
    tipsAnalytics.opened();
  }, []);

  const savedCount = saved.size;
  const savedCountLabel = savedCount > 0 ? `сохранено: ${savedCount}` : "сохранённых пока нет";

  const tips = TIP_DEFS.filter((t) => {
    if (scope === "saved" && !saved.has(t.id)) return false;
    if (category !== "all" && t.category !== category) return false;
    return true;
  });

  async function toggleSave(id: number) {
    const wasSaved = saved.has(id);

    // Оптимистично меняем локально, затем пишем в БД; при ошибке откатываем.
    setSaved((prev) => {
      const next = new Set(prev);
      if (wasSaved) next.delete(id);
      else next.add(id);
      return next;
    });
    if (wasSaved) tipsAnalytics.unsaved(id);
    else tipsAnalytics.saved(id);

    if (!userId) return; // гость: только локально до входа

    const { error } = wasSaved
      ? await supabase.from("saved_tips").delete().eq("user_id", userId).eq("tip_id", id)
      : await supabase
          .from("saved_tips")
          .upsert({ user_id: userId, tip_id: id }, { onConflict: "user_id,tip_id", ignoreDuplicates: true });

    if (error) {
      // Откат оптимистичного апдейта.
      setSaved((prev) => {
        const next = new Set(prev);
        if (wasSaved) next.add(id);
        else next.delete(id);
        return next;
      });
    }
  }

  const SCOPES: { id: Scope; label: string }[] = [
    { id: "all", label: "Библиотека" },
    { id: "saved", label: "Сохранённые" },
  ];

  return (
    <div className="mx-auto w-full max-w-[1040px] px-5 pt-6 lg:px-8 lg:pt-10">
      {/* ── Герой ─────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-4 border-b border-line-subtle pb-5 lg:pb-6">
        <div className="min-w-0">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
            Библиотека
          </div>
          <h1 className="font-serif text-[26px] font-normal leading-[1.1] tracking-[-0.02em] text-ink-primary lg:text-[34px]">
            Советы для бегунов
          </h1>
        </div>
        <div className="shrink-0 whitespace-nowrap pb-1 font-mono text-[12px] text-ink-muted" aria-live="polite">
          {savedCountLabel}
        </div>
      </div>
      <p className="mt-4 max-w-[520px] text-[15px] leading-[1.5] text-ink-secondary">
        Ника подмечает то, что важно тебе, вот подборка на основе разговоров и общих принципов бега.
      </p>

      {/* ── Переключатель Библиотека / Сохранённые ────────────────────── */}
      <div className="mt-6 inline-flex gap-0.5 rounded-pill border border-line-default bg-surface-nika p-0.5">
        {SCOPES.map((s) => {
          const isActive = s.id === scope;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setScope(s.id)}
              aria-pressed={isActive}
              className={cn(
                "inline-flex min-h-[44px] items-center rounded-pill px-4 text-[12.5px] font-medium transition-colors motion-reduce:transition-none",
                isActive ? "bg-ink-primary text-canvas" : "text-ink-secondary hover:text-ink-primary",
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* ── Фильтр категорий ──────────────────────────────────────────── */}
      <div className="scrollbar-none mt-4 flex gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible">
        {CATEGORY_DEFS.map((cat) => {
          const isActive = cat.id === category;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategory(cat.id)}
              aria-pressed={isActive}
              className={cn(
                "inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-pill border px-3.5 text-[12.5px] font-medium transition-colors motion-reduce:transition-none",
                isActive
                  ? "border-ink-primary bg-ink-primary text-canvas"
                  : "border-line-default text-ink-secondary hover:text-ink-primary",
              )}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* ── Сетка карточек / пустое состояние ─────────────────────────── */}
      {tips.length > 0 ? (
        <div className="mt-5 grid grid-cols-1 gap-3 pb-6 sm:grid-cols-2 lg:mt-6 lg:grid-cols-3 lg:gap-4">
          {tips.map((tip) => (
            <TipCard key={tip.id} tip={tip} saved={saved.has(tip.id)} onToggle={() => toggleSave(tip.id)} />
          ))}
        </div>
      ) : (
        <div className="mt-8 rounded-[16px] border border-dashed border-line-default px-6 py-14 text-center">
          <p className="font-serif text-[18px] text-ink-primary">
            {scope === "saved" ? "Сохранённых пока нет" : "Здесь пока пусто"}
          </p>
          <p className="mx-auto mt-2 max-w-[320px] text-[13.5px] leading-[1.5] text-ink-secondary">
            {scope === "saved"
              ? "Нажми на закладку у совета, и он появится здесь."
              : "В этой категории советов пока нет."}
          </p>
        </div>
      )}
    </div>
  );
}
