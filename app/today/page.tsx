import { redirect } from "next/navigation";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { QuoteCard } from "@/components/today/QuoteCard";
import { StreakCard } from "@/components/today/StreakCard";
import { WeekCard } from "@/components/today/WeekCard";
import { LastRunCard } from "@/components/today/LastRunCard";
import { SuggestionChips } from "@/components/today/SuggestionChips";
import { SignOutButton } from "@/components/today/SignOutButton";
import { createServerComponentClient } from "@/lib/supabase";
import { getRuns, weekSummary } from "@/lib/runs";
import { computeStreak, weekRibbon, humanDate, greeting, weekMessage } from "@/lib/today";
import { getDailyQuote } from "@/lib/quotes";

const CHIPS = ["Не хочется бежать сегодня", "Расскажу как прошло", "Перенести на вечер"];

export default async function TodayPage() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth?next=/today");

  const [{ data: userData }, runs, { data: convs }] = await Promise.all([
    supabase.from("users").select("display_name").eq("id", user.id).maybeSingle(),
    getRuns(supabase, user.id),
    supabase.from("conversations").select("updated_at").eq("user_id", user.id),
  ]);

  const name = userData?.display_name?.trim() || "друг";
  const week = weekSummary(runs);
  const ribbon = weekRibbon(runs);
  const streak = computeStreak(convs ?? []);
  const lastRun = runs[0] ?? null;
  const now = new Date();
  const quote = getDailyQuote(now);

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      {/* Шапка страницы */}
      <header className="flex shrink-0 items-center justify-between border-b border-line-default px-5 py-3 lg:px-8">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-accent">
          Сегодня · {humanDate(now)}
        </span>
        <SignOutButton />
      </header>

      {/* Дашборд */}
      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <div className="mx-auto w-full max-w-[760px] px-5 pt-8 lg:px-8 lg:pt-10 xl:max-w-[920px] 2xl:max-w-[1080px]">

          {/* Hero */}
          <section className="mb-6">
            <h1 className="font-serif text-[24px] font-normal leading-[1.25] tracking-[-0.02em] text-ink-primary lg:text-[29px]">
              {greeting(now)}, <em className="italic text-accent">{name}</em>.
              <br />
              {weekMessage(now)}
            </h1>
          </section>

          {/* Сетка карточек */}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <QuoteCard quote={quote} />
            <StreakCard days={streak} />
            <WeekCard km={week.km} days={ribbon} />
            <LastRunCard run={lastRun} />
          </div>

          {/* Ответить НИКЕ */}
          <section className="mt-6 flex flex-col gap-3.5">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              Ответить НИКЕ
            </div>
            <SuggestionChips chips={CHIPS} />
          </section>

        </div>
      </div>
    </AppLayout>
  );
}
