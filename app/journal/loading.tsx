import { AppLayout } from "@/components/AppLayout";
import { Skeleton, SkeletonPageHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <AppLayout>
      <SkeletonPageHeader />
      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <div className="mx-auto w-full max-w-[720px] px-6 pt-6 lg:pt-10">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="mb-4 flex gap-4">
              <div className="flex flex-col items-center">
                <Skeleton className="h-10 w-10 rounded-full" />
                {i < 4 && <Skeleton className="mt-1 h-16 w-0.5 rounded" />}
              </div>
              <div className="flex-1 pb-4">
                <Skeleton className="mb-2 h-4 w-24 rounded" />
                <Skeleton className="h-[72px] w-full rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
