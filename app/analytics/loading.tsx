import { AppLayout } from "@/components/AppLayout";
import { Skeleton, SkeletonPageHeader, SkeletonCard } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <AppLayout>
      <SkeletonPageHeader />
      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <div className="mx-auto w-full max-w-[600px] px-5 pt-8">
          <div className="flex flex-col gap-4">
            <SkeletonCard>
              <Skeleton className="mb-3 h-3 w-32 rounded" />
              <div className="flex items-end gap-1 h-24">
                {Array.from({ length: 14 }).map((_, i) => (
                  <Skeleton key={i} className="flex-1 rounded-t-sm" style={{ height: `${30 + Math.random() * 60}%` }} />
                ))}
              </div>
            </SkeletonCard>
            <SkeletonCard>
              <Skeleton className="mb-3 h-3 w-24 rounded" />
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 rounded" style={{ width: `${40 + i * 10}px` }} />
                ))}
              </div>
            </SkeletonCard>
            <SkeletonCard>
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="mt-2 h-4 w-3/4 rounded" />
            </SkeletonCard>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
