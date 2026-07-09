import { redirect } from "next/navigation";
import { createServerComponentClient } from "@/lib/supabase";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { PageHeader } from "@/components/nav/PageHeader";
import { MoodBarChart } from "@/components/analytics/MoodBarChart";
import { WordCloud } from "@/components/analytics/WordCloud";
import { PatternCard } from "@/components/analytics/PatternCard";
import { InfoNote } from "@/components/analytics/InfoNote";
import { getRuns } from "@/lib/runs";
import { buildMoodChart, buildWordCloud } from "@/lib/analytics";
import type { Gender } from "@/types/app";

export default async function AnalyticsPage() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth?next=/analytics");

  const since = new Date();
  since.setDate(since.getDate() - 14);

  const [runs, { data: convs }, { data: profileData }] = await Promise.all([
    getRuns(supabase, user.id),
    supabase
      .from("conversations")
      .select("messages, updated_at")
      .eq("user_id", user.id)
      .gte("updated_at", since.toISOString()),
    supabase
      .from("profiles")
      .select("gender")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const days = buildMoodChart(runs);
  const words = buildWordCloud(convs ?? []);
  const convCount = convs?.length ?? 0;
  const gender = (profileData?.gender ?? null) as Gender | null;

  const verb =
    gender === "male" ? "говорил" :
    gender === "female" ? "говорила" :
    "писал/а";

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <PageHeader title="Аналитика" subtitle="14 дней" />

      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <div className="mx-auto w-full max-w-[720px] px-6 pt-6 lg:pt-10 xl:max-w-[960px] xl:px-8 2xl:max-w-[1200px] 2xl:px-10">

          {/* Заголовок */}
          <div className="mb-8">
            <p className="mb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.15em] text-ink-muted">
              14 дней · наблюдения
            </p>
            <h1 className="font-serif text-[36px] lg:text-[44px] font-normal leading-[1.1] tracking-[-0.025em] text-ink-primary">
              Что ты {verb}.<br />
              <em className="italic text-accent">Без оценки.</em>
            </h1>
            <p className="mt-3 text-[14px] leading-[1.6] text-ink-secondary">
              Я не диагностирую и не сужу состояние. Просто показываю что чаще встречалось —
              на случай если хочешь это увидеть со стороны.
            </p>
          </div>

          {/* Как давались пробежки */}
          <section className="mb-4">
            <p className="mb-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.15em] text-ink-muted">
              Как давались пробежки
            </p>
            <div className="rounded-[16px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5">
              <MoodBarChart days={days} />
            </div>
          </section>

          {/* Слова + паттерны */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-[16px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5">
              <p className="mb-4 font-mono text-[10.5px] font-semibold uppercase tracking-[0.15em] text-ink-muted">
                Слова которые звучали чаще всего
              </p>
              <WordCloud words={words} />
            </div>
            <div className="rounded-[16px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5">
              <p className="mb-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.15em] text-ink-muted">
                Паттерны
              </p>
              <PatternCard count={convCount} topWord={words[0]?.text} />
            </div>
          </div>

          {/* Инфо-блок */}
          <div className="mt-4">
            <InfoNote />
          </div>

        </div>
      </div>
    </AppLayout>
  );
}
