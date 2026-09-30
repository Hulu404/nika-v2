"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Отдельный экран согласия на сведения о здоровье (ч. 1 ст. 10 152-ФЗ).
 * Показывается перед первым вводом данных цикла и самочувствия. Чекбокс не
 * отмечен по умолчанию; без него раздел недоступен, остальной сервис работает.
 */
export function HealthConsentGate({ hadData = false }: { hadData?: boolean }) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    if (!agreed || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/consents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ entries: [{ type: "health", granted: true }], source: "health_gate" }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setError("Не получилось сохранить согласие. Попробуй ещё раз.");
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto pb-tabbar lg:pb-10">
      <div className="mx-auto flex w-full max-w-[480px] flex-col px-5 py-10 lg:px-8">
        <div className="mb-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
          Мой ритм
        </div>
        <h1 className="mb-3 font-serif text-[26px] font-normal leading-tight tracking-[-0.02em] text-ink-primary">
          Сначала отдельное согласие
        </h1>
        <p className="text-[14px] leading-[1.6] text-ink-secondary">
          {hadData
            ? "Раздел закрыт, пока нет действующего согласия на сведения о здоровье. Твои прежние записи сохранены и не используются."
            : "Раздел работает с датами цикла и самочувствием. Это сведения о здоровье, и по закону для них нужно отдельное согласие."}
        </p>
        <p className="mt-3 text-[14px] leading-[1.6] text-ink-secondary">
          Они нужны только для этого раздела и для ответов Ники, не используются для рекламы. Без согласия остальной сервис
          работает как обычно. Отозвать согласие можно в профиле в любой момент.
        </p>

        <label className="mt-6 flex min-h-[44px] cursor-pointer items-start gap-3 py-2 text-[14px] leading-[1.5] text-ink-primary">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-[1px] h-5 w-5 flex-shrink-0 cursor-pointer accent-[var(--accent)]"
          />
          <span>
            Даю согласие на обработку сведений о здоровье. Условия в{" "}
            <a
              href="/legal/consent#c4"
              target="_blank"
              rel="noopener"
              className="underline underline-offset-2"
            >
              разделе 4 согласия
            </a>
            .
          </span>
        </label>

        {error && <p className="mt-3 text-[13px] text-accent">{error}</p>}

        <button
          type="button"
          onClick={handleContinue}
          disabled={!agreed || saving}
          className="mt-5 flex h-12 w-full items-center justify-center rounded-full bg-ink-primary text-[15px] font-medium text-[var(--bg-primary)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Сохраняем…" : "Продолжить"}
        </button>
        <Link
          href="/"
          className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-full border border-line-default text-[15px] font-medium text-ink-primary transition-colors hover:bg-surface-nika"
        >
          Не сейчас
        </Link>
      </div>
    </div>
  );
}
