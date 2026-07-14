import { AppLayout } from "@/components/AppLayout";
import { Skeleton, SkeletonPageHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <AppLayout>
      <SkeletonPageHeader />
      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <div className="mx-auto w-full max-w-[540px] px-5 pt-8">
          {/* Аватар + имя */}
          <div className="mb-8 flex flex-col items-center gap-3">
            <Skeleton className="h-20 w-20 rounded-full" />
            <Skeleton className="h-5 w-32 rounded" />
            <Skeleton className="h-3 w-44 rounded" />
          </div>

          {/* Секции настроек */}
          {Array.from({ length: 3 }).map((_, s) => (
            <div key={s} className="mb-6">
              <Skeleton className="mb-2 h-3 w-20 rounded" />
              <div className="rounded-2xl border border-line-subtle overflow-hidden">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-line-subtle px-4 py-[14px] last:border-b-0">
                    <Skeleton className="h-4 w-32 rounded" />
                    <Skeleton className="h-4 w-16 rounded" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
