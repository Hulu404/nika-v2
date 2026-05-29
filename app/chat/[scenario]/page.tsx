import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Chat } from "@/components/Chat";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { getLastConversation } from "@/lib/conversations";
import { SCENARIO_META, SCENARIO_ORDER } from "@/lib/scenarios";
import { createServerComponentClient } from "@/lib/supabase";
import type { ChatMessage, Scenario } from "@/types/conversation";

function isScenario(value: string): value is Scenario {
  return (SCENARIO_ORDER as string[]).includes(value);
}

// Контекст-панель — правая колонка на десктопе
function ContextPanel({ scenario }: { scenario: Scenario }) {
  const STATS = [
    { v: "3",       l: "эта неделя" },
    { v: "47",      l: "дней с НИКОЙ" },
    { v: "12.4 км", l: "пробежал" },
  ];

  const RUNS = [
    { date: "12 мая", dist: "4.2 км", time: "28 мин", note: "было тяжело первые 10 минут" },
    { date: "10 мая", dist: "3.5 км", time: "24 мин", note: "первый раз без остановок!" },
    { date: "08 мая", dist: "4.7 км", time: "31 мин", note: "дождь, но было даже хорошо" },
  ];

  const SAVED_QUOTE =
    "Тяжесть в начале — не значит что ты не в форме. Это значит что тело ещё не верит что ты правда вышел.";

  return (
    <aside className="hidden xl:flex w-[340px] flex-shrink-0 flex-col border-l border-[var(--border-default)] bg-[var(--bg-canvas)] overflow-y-auto">

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
              <div className="text-[10px] text-ink-muted mt-1 uppercase tracking-[0.08em] font-medium">
                {l}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Последние пробежки */}
      <div className="px-6 py-5 border-b border-[var(--border-default)]">
        <div className="text-[10.5px] font-mono uppercase tracking-[0.14em] text-ink-muted font-semibold mb-3">
          Последние пробежки
        </div>
        <div className="flex flex-col gap-3">
          {RUNS.map((r) => (
            <div key={r.date} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-ink-muted uppercase tracking-[0.06em]">
                  {r.date}
                </span>
                <span className="text-[12px] font-medium text-ink-secondary">
                  {r.dist} · {r.time}
                </span>
              </div>
              <p className="text-[12.5px] text-ink-secondary font-serif italic leading-[1.4]">
                «{r.note}»
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Сохранено НИКОЙ */}
      <div className="px-6 py-5">
        <div className="text-[10.5px] font-mono uppercase tracking-[0.14em] text-ink-muted font-semibold mb-3">
          Сохранено НИКОЙ
        </div>
        <blockquote className="border-l-2 border-accent/40 pl-3 font-serif text-[13.5px] leading-[1.55] text-ink-secondary italic">
          {SAVED_QUOTE}
        </blockquote>
      </div>
    </aside>
  );
}

export default async function ChatPage({
  params,
}: {
  params: { scenario: string };
}) {
  if (!isScenario(params.scenario)) notFound();

  const scenario = params.scenario;
  const meta = SCENARIO_META[scenario];

  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/auth?next=/chat/${scenario}`);
  }

  const conversation = await getLastConversation(supabase, user.id, scenario);

  // Опенер НИКИ всегда из SCENARIO_META; в БД он не хранится.
  const opener: ChatMessage = {
    id: "opener",
    role: "assistant",
    content: SCENARIO_META[scenario].opener,
    createdAt: new Date().toISOString(),
  };

  const initialMessages: ChatMessage[] = conversation
    ? [
        opener,
        ...conversation.messages.map((m, i) => ({
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

        {/* Аватар НИКИ */}
        <div className="relative h-9 w-9 flex-shrink-0 rounded-full bg-nika-avatar shadow-[0_0_0_3px_rgba(200,85,61,0.06)]">
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg-primary)] bg-[#7BA968]" />
        </div>

        <div className="flex flex-1 flex-col leading-none">
          <span className="font-serif text-[17px] font-medium tracking-[-0.01em] text-ink-primary">
            НИКА
          </span>
          <span className="mt-[3px] text-[11px] tracking-[0.02em] text-ink-muted">
            {meta.subtitle}
          </span>
        </div>

        {/* Кнопка "···" */}
        <button
          aria-label="Ещё"
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink-secondary hover:bg-[var(--surface-nika)] transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <circle cx="4" cy="10" r="1.6" />
            <circle cx="10" cy="10" r="1.6" />
            <circle cx="16" cy="10" r="1.6" />
          </svg>
        </button>
      </header>

      {/* Основная область: чат + контекст-панель */}
      <div className="flex flex-1 min-h-0">
        <Chat
          scenario={scenario}
          initialMessages={initialMessages}
          conversationId={conversation?.id ?? null}
          className="flex-1 min-w-0 min-h-0"
        />
        <ContextPanel scenario={scenario} />
      </div>
    </AppLayout>
  );
}
