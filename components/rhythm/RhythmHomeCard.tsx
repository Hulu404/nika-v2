import Link from "next/link";
import type { AdviceRecord } from "@/lib/rhythm/cycles";

interface RhythmHomeCardActiveProps {
  cycleDay: number;
  cycleLen: number;
  advice: AdviceRecord | null;
}

interface RhythmHomeCardEmptyProps {
  configured: false;
}

type RhythmHomeCardProps =
  | ({ configured: true } & RhythmHomeCardActiveProps)
  | RhythmHomeCardEmptyProps;

export function RhythmHomeCard(props: RhythmHomeCardProps) {
  if (!props.configured) {
    return (
      <Link
        href="/rhythm"
        className="block rounded-card border border-line-subtle bg-elevated p-4 transition-colors hover:border-line-default"
      >
        <div className="mb-1 font-serif text-[16px] font-medium text-ink-primary">Мой ритм</div>
        <p className="mb-3 text-[13px] leading-[1.55] text-ink-secondary">
          Отметь начало цикла, и я буду подстраивать бег под твоё тело: советы, темп и план на неделю.
        </p>
        <span className="inline-block rounded-full bg-ink-primary px-4 py-1.5 text-[13px] font-medium text-[var(--bg-primary)]">
          Настроить
        </span>
      </Link>
    );
  }

  const { cycleDay, cycleLen, advice } = props;

  return (
    <Link
      href="/rhythm"
      className="block rounded-card border border-line-subtle bg-elevated p-4 transition-colors hover:border-line-default"
    >
      <div className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
        Мой ритм · день {cycleDay} из {cycleLen}
      </div>
      {advice ? (
        <p className="text-[13px] leading-[1.55] text-ink-primary line-clamp-2">
          {advice.advice_short}
        </p>
      ) : (
        <div className="space-y-1.5">
          <div className="h-3 w-full rounded bg-surface-deep" />
          <div className="h-3 w-3/5 rounded bg-surface-deep" />
        </div>
      )}
    </Link>
  );
}
