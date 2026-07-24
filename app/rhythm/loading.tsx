import { AppLayout } from "@/components/AppLayout";
import { Skeleton, SkeletonPageHeader } from "@/components/ui/Skeleton";

/**
 * Скелет «Моего ритма». Повторяет каркас RhythmContent: на мобайле — одна
 * колонка (hero → Ника сегодня → цикл → впереди → чек-ин → отметка), на xl —
 * центр + правый рейл шириной 320px. Ветку онбординга (когда циклов ещё нет)
 * не моделируем: она короче и показывается только один раз в жизни аккаунта.
 */

/** Подпись фазы, заголовок в две строки, лид. */
function HeroSkeleton() {
  return (
    <section className="mb-6">
      <Skeleton className="mb-2 h-2.5 w-44 rounded" />
      <Skeleton className="mb-2 h-7 w-full rounded" />
      <Skeleton className="mb-3 h-7 w-3/5 rounded" />
      <Skeleton className="h-3 w-full rounded" />
      <Skeleton className="mt-1.5 h-3 w-4/5 rounded" />
    </section>
  );
}

/** Заголовок секции: название слева, подпись справа. */
function SectionHead({ hintClass = "w-28" }: { hintClass?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <Skeleton className="h-4 w-24 rounded" />
      <Skeleton className={`h-3 rounded ${hintClass}`} />
    </div>
  );
}

/** Карточка «Ника сегодня»: аватар, совет в три строки, кнопка в чат. */
function NikaCardSkeleton() {
  return (
    <div className="rounded-[14px] bg-surface-nika p-4">
      <div className="mb-3 flex items-start gap-3">
        <Skeleton className="mt-0.5 h-7 w-7 flex-shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="mb-1.5 h-2.5 w-28 rounded" />
          <Skeleton className="h-3 w-full rounded" />
          <Skeleton className="mt-2 h-3 w-11/12 rounded" />
          <Skeleton className="mt-2 h-3 w-3/5 rounded" />
          <Skeleton className="mt-2 h-2.5 w-52 max-w-full rounded" />
        </div>
      </div>
      <Skeleton className="h-10 w-full rounded-full" />
    </div>
  );
}

/** Сетка цикла: четыре недели по 7 дней + легенда фаз. */
function CycleGridSkeleton() {
  return (
    <div className="rounded-card border border-line-subtle bg-elevated p-4">
      {Array.from({ length: 4 }).map((_, w) => (
        <div key={w} className="mb-3 last:mb-0">
          <Skeleton className="mb-2 h-2.5 w-28 rounded" />
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: 7 }).map((_, d) => (
              <div key={d} className="flex flex-col items-center gap-1.5 py-1.5">
                <Skeleton className="h-3 w-3 rounded-full" />
                <Skeleton className="h-2.5 w-3 rounded" />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 border-t border-line-subtle pt-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-16 rounded" />
        ))}
      </div>
    </div>
  );
}

/** Таймлайн «Впереди»: вертикальная линия и две вехи. */
function AheadSkeleton() {
  return (
    <div className="relative pl-6">
      <div className="absolute bottom-1.5 left-2 top-1.5 w-0.5 bg-line-default" />
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="relative mb-4 last:mb-0">
          <Skeleton className="absolute -left-6 top-0.5 h-4 w-4 rounded-full" />
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Skeleton className="h-3 w-40 max-w-full rounded" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <div className="rounded-[14px] border border-line-subtle bg-elevated p-3.5">
            <Skeleton className="h-3 w-full rounded" />
            <Skeleton className="mt-2 h-3 w-4/5 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Чек-ин: теги, поле заметки, кнопка сохранения. */
function CheckinSkeleton() {
  return (
    <div className="rounded-card border border-line-subtle bg-elevated p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <Skeleton className="h-4 w-36 rounded" />
        <Skeleton className="h-3 w-20 rounded" />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {[64, 84, 76, 92, 112, 68].map((w, i) => (
          <Skeleton key={i} className="h-7 rounded-full" style={{ width: w }} />
        ))}
      </div>
      <Skeleton className="mb-3 h-[62px] w-full rounded-[14px]" />
      <Skeleton className="h-10 w-full rounded-full lg:w-44" />
    </div>
  );
}

/** Карточка «Месячные начались?». */
function MarkCardSkeleton() {
  return (
    <div className="rounded-card border border-line-subtle bg-surface-warm p-4">
      <Skeleton className="mb-1 h-4 w-44 rounded" />
      <Skeleton className="mb-3 h-3 w-60 max-w-full rounded" />
      <Skeleton className="h-10 w-full rounded-full" />
    </div>
  );
}

export default function Loading() {
  return (
    <AppLayout>
      <SkeletonPageHeader />

      <div className="flex-1 overflow-y-auto pb-tabbar lg:pb-10">
        <div className="mx-auto w-full max-w-[1080px] px-5 py-8 lg:px-8 lg:py-10">

          {/* ── MOBILE ───────────────────────────────────────────────── */}
          <div className="flex flex-col gap-5 xl:hidden">
            <HeroSkeleton />
            <NikaCardSkeleton />

            <section>
              <SectionHead />
              <CycleGridSkeleton />
            </section>

            <section>
              <div className="mb-3">
                <Skeleton className="h-4 w-24 rounded" />
              </div>
              <AheadSkeleton />
            </section>

            <section>
              <CheckinSkeleton />
            </section>

            <MarkCardSkeleton />

            {/* Футноут */}
            <div className="flex flex-col items-center gap-1.5">
              <Skeleton className="h-2.5 w-4/5 rounded" />
              <Skeleton className="h-2.5 w-1/2 rounded" />
            </div>
          </div>

          {/* ── DESKTOP ──────────────────────────────────────────────── */}
          <div className="hidden xl:flex xl:gap-10">
            <div className="min-w-0 flex-1">
              <HeroSkeleton />

              <section className="mb-6">
                <SectionHead hintClass="w-72" />
                <CycleGridSkeleton />
              </section>

              <section className="mb-6">
                <div className="mb-3">
                  <Skeleton className="h-4 w-24 rounded" />
                </div>
                <AheadSkeleton />
              </section>

              <div className="grid grid-cols-2 gap-5">
                <section>
                  <SectionHead hintClass="w-20" />
                  <CheckinSkeleton />
                </section>
                <section>
                  <SectionHead hintClass="w-24" />
                  <div className="rounded-[14px] bg-surface-nika p-4">
                    <div className="flex gap-3">
                      <Skeleton className="mt-0.5 h-7 w-7 flex-shrink-0 rounded-full" />
                      <div className="min-w-0 flex-1">
                        <Skeleton className="mb-1 h-2.5 w-28 rounded" />
                        <Skeleton className="h-3 w-full rounded" />
                        <Skeleton className="mt-2 h-3 w-11/12 rounded" />
                        <Skeleton className="mt-2 h-3 w-2/3 rounded" />
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>

            {/* Правый рейл */}
            <aside className="w-[320px] flex-shrink-0 space-y-5">
              <NikaCardSkeleton />
              <MarkCardSkeleton />
              <div className="rounded-card border border-line-subtle bg-elevated p-4">
                <Skeleton className="mb-1 h-4 w-28 rounded" />
                <div className="border-b border-line-subtle py-2.5">
                  <Skeleton className="h-3 w-40 rounded" />
                </div>
                <div className="py-2.5">
                  <Skeleton className="h-3 w-48 rounded" />
                </div>
                <div className="mt-3 border-t border-line-subtle pt-3">
                  <Skeleton className="h-2.5 w-full rounded" />
                  <Skeleton className="mt-1.5 h-2.5 w-3/4 rounded" />
                </div>
              </div>
            </aside>
          </div>

        </div>
      </div>
    </AppLayout>
  );
}
