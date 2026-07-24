import { AppLayout } from "@/components/AppLayout";
import { Skeleton, SkeletonPageHeader, SkeletonCard } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <AppLayout>
      <SkeletonPageHeader />
      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <div className="mx-auto w-full max-w-[1040px] px-5 pt-6 lg:px-8 lg:pt-10">
          {/* Герой */}
          <div className="border-b border-line-subtle pb-5 lg:pb-6">
            <Skeleton className="mb-2 h-3 w-28 rounded" />
            <Skeleton className="h-7 w-64 max-w-full rounded lg:h-9" />
          </div>

          {/* Лид */}
          <Skeleton className="mt-4 h-3.5 w-full max-w-[520px] rounded" />
          <Skeleton className="mt-2 h-3.5 w-3/5 max-w-[520px] rounded" />

          {/* Фильтр категорий */}
          <div className="mt-6 flex gap-2 overflow-hidden lg:flex-wrap">
            {[56, 88, 72, 104, 80].map((w, i) => (
              <Skeleton key={i} className="h-11 shrink-0 rounded-pill" style={{ width: w }} />
            ))}
          </div>

          {/* Лента советов */}
          <div className="mt-5 grid grid-cols-1 gap-3 pb-6 sm:grid-cols-2 lg:mt-6 lg:grid-cols-3 lg:gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i}>
                <Skeleton className="mb-2 h-4 w-3/4 rounded" />
                <Skeleton className="h-3 w-full rounded" />
                <Skeleton className="mt-1 h-3 w-1/2 rounded" />
              </SkeletonCard>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
