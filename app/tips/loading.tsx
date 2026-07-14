import { AppLayout } from "@/components/AppLayout";
import { Skeleton, SkeletonPageHeader, SkeletonCard } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <AppLayout>
      <SkeletonPageHeader />
      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <div className="mx-auto w-full max-w-[540px] px-5 pt-8">
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
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
