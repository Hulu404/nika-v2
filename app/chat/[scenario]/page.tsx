import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Chat } from "@/components/Chat";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { createConversation, getLastConversation } from "@/lib/conversations";
import { ALL_SCENARIOS, SCENARIO_META } from "@/lib/scenarios";
import { createServerComponentClient } from "@/lib/supabase";
import type { ChatMessage, Scenario } from "@/types/conversation";
import type { Message } from "@/types/app";

function isScenario(value: string): value is Scenario {
  return (ALL_SCENARIOS as string[]).includes(value);
}

function pluralDays(n: number): string {
  const m10 = n % 10; const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return "дней";
  if (m10 === 1) return "день";
  if (m10 >= 2 && m10 <= 4) return "дня";
  return "дней";
}

// ── Контекст-панель (десктоп) ─────────────────────────────────────────────────

interface ContextPanelProps {
  weekConvCount: number;
  daysWithNika: number;
  savedQuote: string | null;
}

function ContextPanel({ weekConvCount, daysWithNika, savedQuote }: ContextPanelProps) {
  const STATS = [
    { v: String(weekConvCount),                          l: "эта неделя" },
    { v: String(daysWithNika),                           l: `${pluralDays(daysWithNika)} с НИКОЙ` },
    { v: "0 км",                                         l: "пробежал" },
  ];

  return (
    <aside className="hidden xl:flex w-[320px] flex-shrink-0 flex-col border-l border-[var(--border-default)] bg-[var(--bg-canvas)] overflow-y-auto">

      {/* Статистика */}
      <div className="px-6 py-5 border-b border-[var(--border-default)]">
        <div className="text-[10.5px] font-mono uppercase tracking-[0.14em] text-ink-muted font-semibold mb-4">
          Контекст
        </div>
        <div className="grid grid-cols-3 gap-3">
          {STATS.map(({ v, l }) => (
            <div key={l} className="text-center">
              <div className="font-serif text-[22px] font-medium tracking-[-0.02em] text-ink-primary leading-none">
                {v}
              </div>
              <div className="text-[10px] text-ink-muted mt-1 uppercase tracking-[0.08em] font-medium leading-tight">
                {l}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Последние пробежки — заглушка */}
      <div className="px-6 py-5 border-b border-[var(--border-default)]">
        <div className="text-[10.5px] font-mono uppercase tracking-[0.14em] text-ink-muted font-semibold mb-3">
          Последние пробежки
        </div>
        <p className="font-serif text-[13px] italic text-ink-muted leading-[1.5]">
          Пока нет пробежек. Добавь первую в журнале.
        </p>
        <Link href="/journal" className="mt-2 inline-block text-[12px] text-accent hover:underline">
          Открыть журнал →
        </Link>
      </div>

      {/* Сохранено НИКОЙ */}
      {savedQuote && (
        <div className="px-6 py-5">
          <div className="text-[10.5px] font-mono uppercase tracking-[0.14em] text-ink-muted font-semibold mb-3">
            Сохранено НИКОЙ
          </div>
          <blockquote className="border-l-2 border-[#C8553D]/40 pl-3 font-serif text-[13.5px] leading-[1.55] text-ink-secondary italic">
            {savedQuote.length > 200 ? savedQuote.slice(0, 200) + "…" : savedQuote}
          </blockquote>
        </div>
      )}
    </aside>
  );
}

// ── Страница ─────────────────────────────────────────────────────────────────

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: { scenario: string };
  searchParams: { new?: string };
}) {
  if (!isScenario(params.scenario)) notFound();

  const scenario = params.scenario;
  const meta = SCENARIO_META[scenario];
  const forceNew = searchParams.new === "1";

  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/auth?next=/chat/${scenario}`);

  // Загружаем (или создаём) диалог
  const conversation = forceNew
    ? await createConversation(supabase, user.id, scenario)
    : await getLastConversation(supabase, user.id, scenario);

  // Данные для контекст-панели
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [{ data: userData }, { data: weekConvs }] = await Promise.all([
    supabase.from("users").select("created_at").eq("id", user.id).maybeSingle(),
    supabase
      .from("conversations")
      .select("id")
      .eq("user_id", user.id)
      .gte("created_at", sevenDaysAgo.toISOString()),
  ]);

  const weekConvCount = weekConvs?.length ?? 0;
  const daysWithNika = userData?.created_at
    ? Math.max(1, Math.floor((Date.now() - new Date(userData.created_at).getTime()) / (1000 * 60 * 60 * 24)))
    : 1;

  // Последняя длинная реплика НИКИ из текущего диалога
  const savedQuote =
    (conversation?.messages as Message[] | undefined)
      ?.filter((m) => m.role === "assistant" && m.content.length > 100)
      .at(-1)?.content ?? null;

  // Опенер НИКИ
  const opener: ChatMessage = {
    id: "opener",
    role: "assistant",
    content: SCENARIO_META[scenario].opener,
    createdAt: new Date().toISOString(),
  };

  const initialMessages: ChatMessage[] = conversation
    ? [
        opener,
        ...(conversation.messages as Message[]).map((m, i) => ({
          id: `${conversation.id}-${i}`,
          role: m.role,
          content: m.content,
          createdAt: m.timestamp,
        })),
      ]
    : [opener];

  return (
    <AppLayout hideBottomNav sidebarSlot={<SidebarData />}>
      {/* Шапка чата */}
      <header className="sticky top-0 z-10 flex shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-blur)] px-4 py-3 backdrop-blur-[16px]">
        <Link
          href="/day1"
          aria-label="Назад"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-[var(--surface-nika)] hover:text-ink-primary"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <div className="relative h-9 w-9 flex-shrink-0 rounded-full bg-nika-avatar shadow-[0_0_0_3px_rgba(200,85,61,0.06)]">
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg-primary)] bg-[#7BA968]" />
        </div>
        <div className="flex flex-1 flex-col leading-none">
          <span className="font-serif text-[17px] font-medium tracking-[-0.01em] text-ink-primary">НИКА</span>
          <span className="mt-[3px] text-[11px] tracking-[0.02em] text-ink-muted">{meta.subtitle}</span>
        </div>
        <button aria-label="Ещё" className="flex h-9 w-9 items-center justify-center rounded-full text-ink-secondary hover:bg-[var(--surface-nika)] transition-colors">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <circle cx="4" cy="10" r="1.6" />
            <circle cx="10" cy="10" r="1.6" />
            <circle cx="16" cy="10" r="1.6" />
          </svg>
        </button>
      </header>

      {/* Чат + контекст */}
      <div className="flex flex-1 min-h-0">
        <Chat
          scenario={scenario}
          initialMessages={initialMessages}
          conversationId={conversation?.id ?? null}
          className="flex-1 min-w-0 min-h-0"
        />
        <ContextPanel
          weekConvCount={weekConvCount}
          daysWithNika={daysWithNika}
          savedQuote={savedQuote}
        />
      </div>
    </AppLayout>
  );
}
