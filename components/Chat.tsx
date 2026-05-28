"use client";

import { useState } from "react";
import Link from "next/link";
import { ChatInput } from "@/components/ChatInput";
import { MessageBubble } from "@/components/MessageBubble";
import { TypingIndicator } from "@/components/TypingIndicator";
import { useChatScroll } from "@/hooks/useChatScroll";
import { SCENARIO_META } from "@/lib/scenarios";
import type { ChatMessage, Scenario } from "@/types/conversation";

function makeOpener(scenario: Scenario): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content: SCENARIO_META[scenario].opener,
    createdAt: new Date().toISOString(),
  };
}

export function Chat({
  scenario,
  initialMessages,
  conversationId: initialConversationId,
}: {
  scenario: Scenario;
  initialMessages: ChatMessage[];
  conversationId: string | null;
}) {
  const meta = SCENARIO_META[scenario];
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const last = messages[messages.length - 1];
  // Скроллим вниз и при добавлении сообщений, и по мере дописывания ответа.
  const scrollRef = useChatScroll(
    `${messages.length}-${last?.content.length ?? 0}-${pending}`,
  );

  // Пока ждём первый токен, последнее сообщение — реплика пользователя.
  const showTyping = pending && last?.role === "user";

  function startNewConversation() {
    if (pending) return;
    setError(null);
    setConversationId(null);
    setMessages([makeOpener(scenario)]);
  }

  async function send(text: string) {
    if (pending) return;
    setError(null);

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    const history = [...messages, userMessage];
    setMessages(history);
    setPending(true);

    try {
      // API ждёт историю с реплики пользователя — опенер НИКИ отбрасываем.
      const firstUser = history.findIndex((m) => m.role === "user");
      const payload = history
        .slice(firstUser)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario, messages: payload, conversationId }),
      });
      if (!res.ok || !res.body) throw new Error(`status ${res.status}`);

      // Запоминаем id диалога (важно для только что созданного нового диалога).
      const returnedId = res.headers.get("X-Conversation-Id");
      if (returnedId && returnedId !== conversationId) {
        setConversationId(returnedId);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantId: string | null = null;
      let acc = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        if (!acc) continue;

        if (assistantId === null) {
          const id = crypto.randomUUID();
          assistantId = id;
          setMessages((prev) => [
            ...prev,
            {
              id,
              role: "assistant",
              content: acc,
              createdAt: new Date().toISOString(),
            },
          ]);
        } else {
          const id = assistantId;
          setMessages((prev) =>
            prev.map((m) => (m.id === id ? { ...m, content: acc } : m)),
          );
        }
      }

      if (assistantId === null) throw new Error("empty stream");
    } catch (err) {
      console.error("[Chat] send failed:", err);
      setError("Не получилось получить ответ. Попробуй ещё раз.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      {/* Nika header — sticky, как в прототипе */}
      <header className="sticky top-0 z-10 flex shrink-0 items-center gap-3 border-b border-line-subtle bg-[var(--bg-blur)] px-4 py-3 backdrop-blur-[16px]">
        <Link
          href="/"
          aria-label="На главную"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-surface-nika hover:text-ink-primary"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>

        {/* Аватар НИКИ с зелёной точкой онлайн */}
        <div className="relative h-9 w-9 flex-shrink-0 rounded-full bg-nika-avatar shadow-[0_0_0_3px_rgba(200,85,61,0.06)]">
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-canvas bg-[#7BA968]" />
        </div>

        {/* Имя и статус */}
        <div className="flex min-w-0 flex-1 flex-col leading-none">
          <span className="font-serif text-[17px] font-medium tracking-[-0.01em] text-ink-primary">
            НИКА
          </span>
          <span className="mt-[3px] truncate text-[11px] tracking-[0.02em] text-ink-muted">
            {meta.subtitle}
          </span>
        </div>

        <button
          type="button"
          onClick={startNewConversation}
          disabled={pending}
          className="shrink-0 rounded-pill border border-ink-muted/30 px-3 py-1.5 text-sm text-ink-primary transition-colors hover:bg-surface-warm disabled:opacity-50"
        >
          Новый разговор
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-2 px-4 py-5">
          {messages.map((m) => (
            <MessageBubble key={m.id} role={m.role}>
              {m.content}
            </MessageBubble>
          ))}
          {showTyping && <TypingIndicator />}
          {error && (
            <p className="px-1 text-center text-sm text-ink-muted">{error}</p>
          )}
        </div>
      </div>

      <ChatInput onSend={send} disabled={pending} />
    </div>
  );
}

/** Скелет-лоадер чата — показывается, пока серверный компонент грузит историю. */
export function ChatSkeleton() {
  return (
    <div className="flex h-dvh animate-pulse flex-col bg-canvas">
      <header className="sticky top-0 z-10 flex shrink-0 items-center gap-3 border-b border-line-subtle px-4 py-3">
        <div className="h-9 w-9 shrink-0 rounded-full bg-surface-warm" />
        <div className="h-9 w-9 shrink-0 rounded-full bg-surface-warm" />
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="h-4 w-20 rounded bg-surface-warm" />
          <div className="h-3 w-32 rounded bg-surface-warm" />
        </div>
        <div className="h-8 w-32 shrink-0 rounded-pill bg-surface-warm" />
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex max-w-2xl flex-col gap-2 px-4 py-5">
          <div className="h-16 w-3/4 self-start rounded-bubble bg-surface-nika" />
          <div className="h-10 w-1/2 self-end rounded-bubble bg-accent/20" />
          <div className="h-24 w-4/5 self-start rounded-bubble bg-surface-nika" />
          <div className="h-10 w-2/5 self-end rounded-bubble bg-accent/20" />
        </div>
      </div>

      <div className="shrink-0 border-t border-ink-muted/10">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <div className="h-12 flex-1 rounded-bubble bg-surface-warm" />
          <div className="h-11 w-11 shrink-0 rounded-pill bg-surface-warm" />
        </div>
      </div>
    </div>
  );
}
