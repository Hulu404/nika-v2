import { AppLayout } from "@/components/AppLayout";
import { Skeleton, SkeletonPageHeader, SkeletonCard } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <AppLayout>
      <SkeletonPageHeader />
      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <div className="mx-auto w-full max-w-[760px] px-5 pt-8 lg:px-8 lg:pt-10 xl:max-w-[920px] 2xl:max-w-[1080px]">
          <div className="flex flex-col gap-5">
            {/* Прогресс */}
            <section>
              <Skeleton className="mb-3 h-3 w-20 rounded" />
              <SkeletonCard className="!p-[18px]">
                <div className="flex flex-wrap gap-[3px]">
                  {Array.from({ length: 21 }).map((_, i) => (
                    <Skeleton key={i} className="h-[6px] w-[6px] rounded-full" />
                  ))}
                </div>
              </SkeletonCard>
            </section>

            {/* Цель */}
            <section>
              <Skeleton className="mb-3 h-3 w-24 rounded" />
              <SkeletonCard>
                <Skeleton className="h-5 w-full rounded" />
                <Skeleton className="mt-2 h-5 w-2/3 rounded" />
              </SkeletonCard>
            </section>

            {/* Фокус */}
            <section>
              <Skeleton className="mb-3 h-3 w-28 rounded" />
              <SkeletonCard>
                <Skeleton className="h-5 w-4/5 rounded" />
              </SkeletonCard>
            </section>

            {/* Советы */}
            <section>
              <Skeleton className="mb-3 h-3 w-24 rounded" />
              {Array.from({ length: 2 }).map((_, i) => (
                <SkeletonCard key={i} className="mb-2">
                  <Skeleton className="h-4 w-full rounded" />
                  <Skeleton className="mt-2 h-4 w-3/4 rounded" />
                </SkeletonCard>
              ))}
            </section>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
