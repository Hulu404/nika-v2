import { AppLayout } from "@/components/AppLayout";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Скелет профиля. PageHeader здесь намеренно нет: app/profile/page.tsx его не
 * рендерит — ProfileContent сам открывает скролл-область с блоком идентичности.
 */
export default function Loading() {
  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-6 pb-32 pt-5">
          {/* Блок идентичности: имя + бейдж тарифа, ниже «С НИКОЙ N дней» */}
          <div className="mb-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Skeleton className="h-9 w-52 max-w-full rounded" />
              <Skeleton className="h-5 w-14 rounded-pill" />
            </div>
            <Skeleton className="mt-1 h-3.5 w-36 rounded" />
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
