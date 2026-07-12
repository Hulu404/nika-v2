"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { createClientComponentClient } from "@/lib/supabase";
import { tipsAnalytics } from "@/lib/tips/analytics";
import { CATEGORY_DEFS, categoryLabel, type CategoryDef, type TipCategory } from "@/lib/tips/data";
import type { PersonalTip } from "@/types/app";

/**
 * Экран «Советы» (/tips) — личная лента. Советы сюда сохраняет НИКА из разговора
 * (personal_tips), руками их не добавляют. Один совет можно удалить (крестик +
 * подтверждение, оптимистично). Все советы личные, поэтому бейджа «из твоих
 * разговоров» на карточках нет. Все цвета через токены (тёмная тема сама).
 */

/** Куда ведёт CTA из пустого состояния — свободный разговор с Никой. */
const CHAT_HREF = "/chat/general";

/** before/breathing/recovery/mindset: лёгкий accent-тон кружка; technique/gear нейтральный. */
const CATEGORY_ACCENT_TINT: Record<TipCategory, boolean> = {
  before: true,
  technique: false,
  breathing: true,
  gear: false,
  recovery: true,
  mindset: true,
};

const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
function addedLabel(createdAt: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return `добавлено ${dateFmt.format(d)}`;
}

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
    case "mindset":
      return (
        <svg {...common}>
          <path d="M10 3L11.6 7.6L16.4 8.1L12.8 11.2L13.9 16L10 13.4L6.1 16L7.2 11.2L3.6 8.1L8.4 7.6Z"
            stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      );
  }
}

function CloseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M6 6L14 14M14 6L6 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function TipCard({
  tip,
  confirming,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  tip: PersonalTip;
  confirming: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const added = addedLabel(tip.createdAt);
  return (
    <div className="relative flex flex-col gap-2.5 rounded-[16px] border border-line-subtle bg-elevated p-4 lg:p-5">
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
          onClick={onAskDelete}
          aria-label={`Удалить совет «${tip.title}»`}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-ink-faint transition-colors hover:text-ink-muted focus-visible:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
        >
          <CloseIcon />
        </button>
      </div>

      <div>
        <span className="mb-2 block font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-muted">
          {categoryLabel(tip.category)}
        </span>
        <h2 className="mb-1.5 font-serif text-[17px] font-medium leading-[1.3] tracking-[-0.01em] text-ink-primary">
          {tip.title}
        </h2>
        <p className="text-[13.5px] leading-[1.48] text-ink-secondary">{tip.body}</p>
        {added && <p className="mt-2.5 font-mono text-[10px] tracking-[0.04em] text-ink-faint">{added}</p>}
      </div>

      {/* Подтверждение удаления — оверлей поверх карточки. */}
      {confirming && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-[16px] bg-elevated px-5 text-center">
          <p className="font-serif text-[15px] leading-[1.35] text-ink-primary">Убрать этот совет?</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onConfirmDelete}
              className="inline-flex min-h-[44px] items-center rounded-pill bg-accent px-4 text-[13px] font-medium text-canvas transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-deep motion-reduce:transition-none"
            >
              Убрать
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              className="inline-flex min-h-[44px] items-center rounded-pill border border-line-default px-4 text-[13px] font-medium text-ink-secondary transition-colors hover:text-ink-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
            >
              Оставить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-8 rounded-[16px] border border-dashed border-line-default px-6 py-14 text-center">
      <p className="font-serif text-[20px] leading-[1.25] text-ink-primary">Здесь будут твои советы</p>
      <p className="mx-auto mt-3 max-w-[380px] text-[14px] leading-[1.55] text-ink-secondary">
        Когда ты спросишь у Ники совет в разговоре, она сохранит сюда самое важное для тебя. Так у тебя соберётся своя подборка, к которой всегда можно вернуться.
      </p>
      <Link
        href={CHAT_HREF}
        className="mt-6 inline-flex min-h-[44px] items-center rounded-pill bg-accent px-5 text-[13.5px] font-medium text-canvas transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-deep motion-reduce:transition-none"
      >
        Поговорить с Никой
      </Link>
    </div>
  );
}

export function TipsContent({
  initialTips,
  userId,
}: {
  initialTips: PersonalTip[];
  userId: string | null;
}) {
  const supabase = useMemo(() => createClientComponentClient(), []);
  const [tips, setTips] = useState<PersonalTip[]>(initialTips);
  const [category, setCategory] = useState<CategoryDef["id"]>("all");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    tipsAnalytics.opened();
  }, []);

  const hasAny = tips.length > 0;

  // Фильтр-чипы адаптивные: «Все» + только категории, в которых есть хоть один
  // совет. Пустые фильтры не висят. Порядок — как в CATEGORY_DEFS.
  const presentIds = useMemo(() => {
    const set = new Set(tips.map((t) => t.category));
    return CATEGORY_DEFS.filter((c) => c.id !== "all" && set.has(c.id as TipCategory));
  }, [tips]);

  // Если активная категория опустела (удалили последний совет в ней) — «Все».
  const effectiveCategory =
    category === "all" || presentIds.some((c) => c.id === category) ? category : "all";

  const visible = tips.filter((t) => effectiveCategory === "all" || t.category === effectiveCategory);

  async function deleteTip(id: string) {
    const removed = tips.find((t) => t.id === id);
    setConfirmingId(null);
    if (!removed) return;

    // Оптимистично убираем из ленты, затем мягко удаляем в БД; при ошибке возвращаем.
    setTips((prev) => prev.filter((t) => t.id !== id));
    tipsAnalytics.deleted(removed.category);

    if (!userId) return; // без входа удалять нечего (лента пустая)

    const { error } = await supabase
      .from("personal_tips")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      setTips((prev) =>
        [removed, ...prev].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1040px] px-5 pt-6 lg:px-8 lg:pt-10">
      {/* ── Герой ─────────────────────────────────────────────────────── */}
      <div className="border-b border-line-subtle pb-5 lg:pb-6">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
          Твои советы
        </div>
        <h1 className="font-serif text-[26px] font-normal leading-[1.1] tracking-[-0.02em] text-ink-primary lg:text-[34px]">
          Советы для бегунов
        </h1>
      </div>
      <p className="mt-4 max-w-[520px] text-[15px] leading-[1.5] text-ink-secondary">
        Это твои личные советы из разговоров с Никой. Она подмечает то, что важно именно тебе, и бережно сохраняет сюда.
      </p>

      {/* ── Фильтр категорий (только заполненные) ─────────────────────── */}
      {hasAny && presentIds.length > 0 && (
        <div className="scrollbar-none mt-6 flex gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible">
          {[{ id: "all", label: "Все" } as CategoryDef, ...presentIds].map((cat) => {
            const isActive = cat.id === effectiveCategory;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategory(cat.id)}
                aria-pressed={isActive}
                className={cn(
                  "inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-pill border px-3.5 text-[12.5px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none",
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
      )}

      {/* ── Лента / пустое состояние ──────────────────────────────────── */}
      {!hasAny ? (
        <EmptyState />
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3 pb-6 sm:grid-cols-2 lg:mt-6 lg:grid-cols-3 lg:gap-4">
          {visible.map((tip) => (
            <TipCard
              key={tip.id}
              tip={tip}
              confirming={confirmingId === tip.id}
              onAskDelete={() => setConfirmingId(tip.id)}
              onCancelDelete={() => setConfirmingId(null)}
              onConfirmDelete={() => deleteTip(tip.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
