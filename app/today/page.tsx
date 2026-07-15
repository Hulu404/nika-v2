import Link from "next/link";
import { redirect } from "next/navigation";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { PageHeader } from "@/components/nav/PageHeader";
import { QuoteCard } from "@/components/today/QuoteCard";
import { StreakCard } from "@/components/today/StreakCard";
import { WeekCard } from "@/components/today/WeekCard";
import { WeekRibbonCard } from "@/components/today/WeekRibbonCard";
import { LastRunCard } from "@/components/today/LastRunCard";
import { SprintPromoCard } from "@/components/today/SprintPromoCard";
import { SprintActiveCard } from "@/components/today/SprintActiveCard";
import { SuggestionChips } from "@/components/today/SuggestionChips";
import { createServerComponentClient } from "@/lib/supabase";
import { getRuns, weekSummary } from "@/lib/runs";
import { computeStreak, weekRibbon, humanDate, weekdayLong, greeting, weekMessage } from "@/lib/today";
import { getDailyQuote } from "@/lib/quotes";
import { getActiveSprint } from "@/lib/sprint";
import { resolveIsPro } from "@/lib/subscription";
import type { Message } from "@/types/app";

const MONTHS = ["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"];
function fmtTime(s: string) {
  const d = new Date(s); const now = new Date();
  if (d.toDateString() === now.toDateString()) return "сегодня";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "вчера";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
const TITLE_STOP = new Set([
  "что","как","это","для","или","если","чтобы","когда","там","тут","уже","ещё","еще",
  "все","всё","меня","мне","мой","моя","мои","так","вот","нет","да","ладно","окей",
  "хм","ага","угу","был","была","было","были","есть","будет","очень","тоже","просто",
  "над","под","про","без","при","даже","чем","кто","они","она","оно","его","её","их",
  "себя","свой","своя","эта","эти","этот","того","тебя","тебе","буду","быть","этом",
  "можно","надо","нужно","хочу","могу","хорошо","привет","ника","помоги","помогите",
]);

function convoLabel(messages: Message[]): string {
  const userMsg = (messages ?? []).find(m => m.role === "user" && m.content.trim().length > 4);
  const assistantMsg = (messages ?? []).find(m => m.role === "assistant");

  let raw = (userMsg ?? assistantMsg)?.content?.trim() ?? "";
  if (!userMsg && raw) {
    // убираем приветствие из реплики ассистента
    raw = raw.replace(/^(привет[!.,]?\s+|ника[!.,]?\s+|привет,\s*)/i, "").trim();
  }
  if (!raw) return "Диалог";

  const words = raw
    .split(/[^а-яёa-z]+/i)
    .filter(w => w.length >= 3 && !TITLE_STOP.has(w.toLowerCase()));

  const label = words.length >= 2
    ? words.slice(0, 5).join(" ")
    : raw.slice(0, 48).trimEnd() + (raw.length > 48 ? "…" : "");

  return label.charAt(0).toUpperCase() + label.slice(1);
}

const CHIPS = ["Не хочется бежать сегодня", "Расскажу как прошло", "Перенести на вечер"];

export default async function TodayPage() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth?next=/today");

  const [{ data: userData }, runs, { data: convs }, activeSprint] = await Promise.all([
    supabase.from("users").select("display_name, is_pro").eq("id", user.id).maybeSingle(),
    getRuns(supabase, user.id),
    supabase.from("conversations").select("scenario, updated_at, messages").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(5),
    getActiveSprint(supabase, user.id),
  ]);

  const isPro = resolveIsPro(userData?.is_pro);

  const name = userData?.display_name?.trim() || "друг";
  const week = weekSummary(runs);
  const ribbon = weekRibbon(runs);
  const streak = computeStreak(convs ?? []);
  const lastRun = runs[0] ?? null;
  const now = new Date();
  const quote = getDailyQuote(now);

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <PageHeader title="НИКА" subtitle={humanDate(now)} />

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
            {isPro && !activeSprint && <SprintPromoCard />}
            {isPro && activeSprint && <SprintActiveCard sprint={activeSprint} />}
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

          {/* История диалогов — только на мобиле (на десктопе видна в сайдбаре) */}
          {(convs ?? []).length > 0 && (
            <section className="mt-8 lg:hidden">
              <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                Прошлые диалоги
              </div>
              <div className="flex flex-col gap-1">
                {(convs ?? []).map((c, i) => (
                  <Link
                    key={i}
                    href={`/chat/${c.scenario}`}
                    className="flex items-center justify-between rounded-[12px] border border-line-subtle bg-elevated px-4 py-3.5 transition-colors hover:border-line-default"
                  >
                    <span className="flex-1 text-[14px] text-ink-primary leading-snug line-clamp-1">
                      {convoLabel(c.messages as Message[])}
                    </span>
                    <span className="ml-3 shrink-0 text-[12px] text-ink-muted">{fmtTime(c.updated_at)}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

        </div>
      </div>
    </AppLayout>
  );
}
