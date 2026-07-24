import { AppLayout } from "@/components/AppLayout";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Скелет экрана первого дня. У day1 НЕТ PageHeader — контент начинается сразу
 * со скролл-области, поэтому SkeletonPageHeader здесь намеренно не рендерится:
 * иначе при подмене на реальную страницу шапка бы схлопывалась.
 */
export default function Loading() {
  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <div className="mx-auto w-full max-w-[680px] px-5 pt-10 lg:pt-14 xl:max-w-[900px] xl:px-8 2xl:max-w-[1120px] 2xl:px-10">

          {/* Бейдж «День 1 · мы только познакомились» */}
          <div className="mb-5 flex items-center gap-2">
            <Skeleton className="h-[18px] w-[18px] flex-shrink-0 rounded-full" />
            <Skeleton className="h-3 w-56 max-w-[70%] rounded" />
          </div>

          {/* Заголовок «Привет, {имя}. / Я тут.» — две строки */}
          <Skeleton className="mb-2 h-12 w-4/5 rounded lg:h-14" />
          <Skeleton className="mb-4 h-12 w-2/5 rounded lg:h-14" />

          {/* Лид */}
          <Skeleton className="h-3.5 w-full rounded" />
          <Skeleton className="mt-2 h-3.5 w-full rounded" />
          <Skeleton className="mb-8 mt-2 h-3.5 w-3/5 rounded" />

          {/* Карточки 2×2 (три статичные + Day1InstallCard) */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 rounded-[18px] border border-line-subtle bg-elevated px-5 py-4"
              >
                <Skeleton className="h-12 w-12 flex-shrink-0 rounded-[13px]" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-3/5 rounded" />
                  <Skeleton className="mt-2 h-3 w-4/5 rounded" />
                </div>
              </div>
            ))}
          </div>

          {/* «Или выбери момент» */}
          <div className="mb-3 mt-10">
            <Skeleton className="mb-1.5 h-5 w-44 rounded" />
            <Skeleton className="h-3 w-60 max-w-full rounded" />
          </div>

          {/* Список сценариев */}
          <div className="flex flex-col gap-2.5 pb-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-[14px] border border-line-subtle bg-elevated px-4 py-4"
              >
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-36 rounded" />
                  <Skeleton className="mt-1.5 h-3 w-48 max-w-full rounded" />
                </div>
                <Skeleton className="h-3.5 w-3.5 flex-shrink-0 rounded" />
              </div>
            ))}
          </div>

        </div>
      </div>
    </AppLayout>
  );
}
