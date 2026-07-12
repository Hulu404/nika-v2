"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { tipsAnalytics } from "@/lib/tips/analytics";
import {
  BASIC_TIPS,
  CATEGORY_DEFS,
  categoryLabel,
  type BasicTip,
  type CategoryDef,
  type TipCategory,
} from "@/lib/tips/data";
import { CategoryChip } from "@/components/tips/shared";

/**
 * Экран «Советы» (/tips) для FREE — статичная базовая подборка (BASIC_TIPS),
 * read-only: без удаления и без пополнения из диалога (это только в PRO). Сверху
 * мягкий апселл. Раскладка и токены — как в личной ленте PRO (TipsContent).
 */

function BasicTipCard({ tip }: { tip: BasicTip }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[16px] border border-line-subtle bg-elevated p-4 lg:p-5">
      <CategoryChip category={tip.category} />
      <div>
        <span className="mb-2 block font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-muted">
          {categoryLabel(tip.category)}
        </span>
        <h2 className="mb-1.5 font-serif text-[17px] font-medium leading-[1.3] tracking-[-0.01em] text-ink-primary">
          {tip.title}
        </h2>
        <p className="text-[13.5px] leading-[1.48] text-ink-secondary">{tip.body}</p>
      </div>
    </div>
  );
}

function ProUpsell() {
  return (
    <div className="mt-6 flex flex-col gap-3 rounded-[16px] border border-line-default bg-surface-nika p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-serif text-[16px] leading-[1.3] text-ink-primary">Свои советы из разговоров с Никой</p>
        <p className="mt-1 text-[13px] leading-[1.5] text-ink-secondary">
          В PRO Ника подмечает важное в ваших разговорах и бережно собирает сюда твою личную подборку.
        </p>
      </div>
      <Link
        href="/upgrade"
        className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-pill bg-accent px-5 text-[13.5px] font-medium text-canvas transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-deep motion-reduce:transition-none"
      >
        Открыть PRO
      </Link>
    </div>
  );
}

export function BasicTips() {
  const [category, setCategory] = useState<CategoryDef["id"]>("all");

  useEffect(() => {
    tipsAnalytics.opened();
  }, []);

  // Чипы: «Все» + только категории, реально представленные в базовом наборе.
  const presentIds = useMemo(() => {
    const set = new Set(BASIC_TIPS.map((t) => t.category));
    return CATEGORY_DEFS.filter((c) => c.id !== "all" && set.has(c.id as TipCategory));
  }, []);

  const visible = BASIC_TIPS.filter((t) => category === "all" || t.category === category);

  return (
    <div className="mx-auto w-full max-w-[1040px] px-5 pt-6 lg:px-8 lg:pt-10">
      {/* ── Герой ─────────────────────────────────────────────────────── */}
      <div className="border-b border-line-subtle pb-5 lg:pb-6">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">Подборка</div>
        <h1 className="font-serif text-[26px] font-normal leading-[1.1] tracking-[-0.02em] text-ink-primary lg:text-[34px]">
          Советы для бегунов
        </h1>
      </div>
      <p className="mt-4 max-w-[520px] text-[15px] leading-[1.5] text-ink-secondary">
        Базовая подборка на каждый день: перед бегом, техника, дыхание, экипировка и восстановление.
      </p>

      <ProUpsell />

      {/* ── Фильтр категорий ──────────────────────────────────────────── */}
      <div className="scrollbar-none mt-6 flex gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible">
        {[{ id: "all", label: "Все" } as CategoryDef, ...presentIds].map((cat) => {
          const isActive = cat.id === category;
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

      {/* ── Сетка карточек ────────────────────────────────────────────── */}
      <div className="mt-5 grid grid-cols-1 gap-3 pb-6 sm:grid-cols-2 lg:mt-6 lg:grid-cols-3 lg:gap-4">
        {visible.map((tip) => (
          <BasicTipCard key={tip.id} tip={tip} />
        ))}
      </div>
    </div>
  );
}
