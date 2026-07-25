import { AppLayout } from "@/components/AppLayout";
import { Skeleton, SkeletonPageHeader, SkeletonCard } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <AppLayout>
      <SkeletonPageHeader />
      <div className="flex-1 overflow-y-auto pb-tabbar lg:pb-10">
        <div className="mx-auto w-full max-w-[760px] px-5 pt-8 lg:px-8 lg:pt-10 xl:max-w-[920px] 2xl:max-w-[1080px]">
          {/* Hero */}
          <section className="mb-6">
            <Skeleton className="mb-2.5 h-3 w-32 rounded" />
            <Skeleton className="h-7 w-3/4 rounded" />
            <Skeleton className="mt-2 h-7 w-1/2 rounded" />
          </section>

          {/* Карточки */}
          <div className="grid grid-cols-2 gap-3.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>

          {/* Чипсы */}
          <section className="mt-6 flex flex-col gap-2.5">
            <Skeleton className="h-3 w-24 rounded" />
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-40 rounded-full" />
              ))}
            </div>
          </section>
        </div>
      </div>
    </AppLayout>
  );
}
