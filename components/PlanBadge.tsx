import { cn } from "@/lib/utils";

/**
 * Бейдж тарифа пользователя (PRO / FREE). Переиспользует существующий язык
 * плашек: PRO — тёплая акцентная пилюля (как тег PRO в сценариях), FREE —
 * нейтральная обводка (как Free-бейдж в профиле). Токены theme-aware.
 *
 * Статус — эффективный план (resolveIsPro), чтобы совпадать с гейтингом функций.
 */
export function PlanBadge({ isPro, className }: { isPro: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill border px-2 py-[3px] font-mono text-[10px] font-bold uppercase tracking-[0.14em]",
        isPro
          ? "border-accent-soft bg-surface-warm text-accent"
          : "border-line-strong text-ink-muted",
        className,
      )}
    >
      {isPro ? "PRO" : "FREE"}
    </span>
  );
}
