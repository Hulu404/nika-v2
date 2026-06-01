import { redirect } from "next/navigation";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { QuoteCard } from "@/components/today/QuoteCard";
import { StreakCard } from "@/components/today/StreakCard";
import { WeekCard } from "@/components/today/WeekCard";
import { WeekRibbonCard } from "@/components/today/WeekRibbonCard";
import { LastRunCard } from "@/components/today/LastRunCard";
import { SuggestionChips } from "@/components/today/SuggestionChips";
import { createServerComponentClient } from "@/lib/supabase";
import { getRuns, weekSummary } from "@/lib/runs";
import { computeStreak, weekRibbon, humanDate, weekdayLong, greeting, weekMessage } from "@/lib/today";
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
      <header className="flex shrink-0 items-center gap-3 border-b border-line-default px-5 py-3 lg:px-8">
        {/* Аватар НИКИ со статусом */}
        <div className="relative h-9 w-9 flex-shrink-0 rounded-full bg-nika-avatar">
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg-primary)] bg-[#7BA968]" />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="font-serif text-[17px] font-medium tracking-[-0.01em] text-ink-primary">
            Сегодня
          </div>
          <div className="mt-0.5 text-[11.5px] text-ink-muted">{humanDate(now)}</div>
        </div>
        {/* Колокольчик */}
        <button
          type="button"
          aria-label="Уведомления"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-surface-nika hover:text-ink-primary"
        >
          <svg width="19" height="19" viewBox="0 0 22 22" fill="none" aria-hidden>
            <path d="M11 3a5 5 0 0 0-5 5c0 5-2 6-2 6h14s-2-1-2-6a5 5 0 0 0-5-5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9.5 18a1.8 1.8 0 0 0 3 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      {/* Дашборд */}
      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <div className="mx-auto w-full max-w-[760px] px-5 pt-8 lg:px-8 lg:pt-10 xl:max-w-[920px] 2xl:max-w-[1080px]">

          {/* Hero */}
          <section className="mb-6">
            <div className="mb-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
              Сегодня · {weekdayLong(now)}
            </div>
            <h1 className="font-serif text-[24px] font-normal leading-[1.25] tracking-[-0.02em] text-ink-primary lg:text-[29px]">
              {greeting(now)}, <em className="italic text-accent">{name}</em>.
              <br />
              {weekMessage(now)}
            </h1>
          </section>

          {/* Сетка карточек */}
          <div className="grid grid-cols-2 gap-3.5">
            <QuoteCard quote={quote} />
            <StreakCard days={streak} />
            <WeekCard km={week.km} />
            <WeekRibbonCard days={ribbon} />
            <LastRunCard run={lastRun} />
          </div>

          {/* Ответить НИКЕ */}
          <section className="mt-6 flex flex-col gap-2.5">
            <div className="px-0 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              Ответить НИКЕ
            </div>
            <SuggestionChips chips={CHIPS} />
          </section>

        </div>
      </div>
    </AppLayout>
  );
}
