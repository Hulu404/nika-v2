import { AppLayout } from "@/components/AppLayout";
import { Skeleton, SkeletonPageHeader } from "@/components/ui/Skeleton";

/**
 * Скелет «Медитаций». Страница — одна большая карточка-заглушка «скоро»,
 * поэтому и скелет один в один: аватар, заголовок, два абзаца.
 */
export default function Loading() {
  return (
    <AppLayout>
      <SkeletonPageHeader />
      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <div className="mx-auto w-full max-w-[640px] px-6 pt-10 lg:pt-16">
          <div className="rounded-card border border-line-default bg-surface-warm p-7 lg:p-9">
            <Skeleton className="mb-6 h-14 w-14 rounded-full" />
            <Skeleton className="h-8 w-52 rounded lg:h-10" />
            <Skeleton className="mt-4 h-3.5 w-full rounded" />
            <Skeleton className="mt-2 h-3.5 w-4/5 rounded" />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
