import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      className={cn("animate-pulse rounded-lg bg-line-subtle", className)}
      style={style}
    />
  );
}

/** Шапка-заглушка — повторяет PageHeader без интерактива. */
export function SkeletonPageHeader() {
  return (
    <header className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-line-default bg-[var(--bg-blur)] px-4 pb-2 pt-header-top backdrop-blur-[16px] lg:px-8">
      <div className="flex min-h-[44px] flex-1 items-center gap-3 pl-1">
        <Skeleton className="h-9 w-9 flex-shrink-0 rounded-full" />
        <Skeleton className="h-4 w-28 rounded" />
      </div>
      <Skeleton className="h-8 w-8 rounded-full" />
    </header>
  );
}

/** Карточка-заглушка. Без children — показывает дефолтные плашки. */
export function SkeletonCard({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={cn("rounded-card border border-line-subtle bg-elevated p-[18px]", className)}>
      {children ?? (
        <>
          <Skeleton className="mb-2 h-3 w-16 rounded" />
          <Skeleton className="h-6 w-3/4 rounded" />
        </>
      )}
    </div>
  );
}
