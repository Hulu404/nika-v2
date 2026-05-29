import { redirect } from "next/navigation";
import { createServerComponentClient } from "@/lib/supabase";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { MobileHeader } from "@/components/journal/MobileHeader";
import { MoodBarChart } from "@/components/analytics/MoodBarChart";
import { WordCloud } from "@/components/analytics/WordCloud";
import { PatternCard } from "@/components/analytics/PatternCard";
import { InfoNote } from "@/components/analytics/InfoNote";
import { getRuns } from "@/lib/runs";
import { buildMoodChart, buildWordCloud } from "@/lib/analytics";

const CARD = "rounded-2xl border border-line-default bg-elevated p-5";

export default async function AnalyticsPage() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth?next=/analytics");

  const since = new Date();
  since.setDate(since.getDate() - 14);

  const [runs, { data: convs }] = await Promise.all([
    getRuns(supabase, user.id),
    supabase
      .from("conversations")
      .select("messages, updated_at")
      .eq("user_id", user.id)
      .gte("updated_at", since.toISOString()),
  ]);

  const days = buildMoodChart(runs);
  const words = buildWordCloud(convs ?? []);
  const convCount = convs?.length ?? 0;

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <MobileHeader title="Аналитика" right="14 дней" />

      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <div className="mx-auto max-w-3xl px-5 pt-6 lg:pt-10">

          {/* Заголовок (десктоп) */}
          <div className="hidden lg:block">
            <p className="mb-3 text-xs uppercase tracking-widest text-accent">14 дней · наблюдения</p>
            <h1 className="text-5xl font-bold leading-tight text-ink-primary">
              Что ты говорила.<br />Без оценки.
            </h1>
            <p className="mt-4 max-w-xl text-base text-ink-secondary">
              Я не диагностирую и не сужу состояние. Просто показываю что чаще встречалось —
              на случай если хочешь это увидеть со стороны.
            </p>
          </div>

          {/* Заголовок (мобиль) */}
          <div className="lg:hidden">
            <h1 className="text-3xl font-bold leading-snug text-ink-primary">
              Что ты говорила в эти 14 дней
            </h1>
            <p className="mt-1 text-sm text-ink-secondary">Не оценка. Просто наблюдения за словами.</p>
          </div>

          {/* Инфо-блок (мобиль) */}
          <div className="mt-5 lg:hidden">
            <InfoNote />
          </div>

          {/* Как давались пробежки */}
          <section className="mt-8">
            <p className="mb-3 text-xs uppercase tracking-widest text-ink-secondary">
              Как давались пробежки
            </p>
            <div className={CARD}>
              <MoodBarChart days={days} />
            </div>
          </section>

          {/* Слова + паттерны */}
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className={CARD}>
              <p className="mb-4 text-xs uppercase tracking-widest text-ink-secondary">
                Слова которые звучали чаще всего
              </p>
              <WordCloud words={words} />
            </div>
            <div className={CARD}>
              <p className="mb-3 text-xs uppercase tracking-widest text-ink-secondary">Паттерны</p>
              <PatternCard count={convCount} topWord={words[0]?.text} />
            </div>
          </div>

        </div>
      </div>
    </AppLayout>
  );
}
