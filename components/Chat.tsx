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
    <div className="flex h-dvh flex-col">
      <header className="shrink-0 border-b border-ink-muted/10 bg-canvas/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Link
            href="/"
            aria-label="На главную"
            className="shrink-0 text-ink-muted transition-colors hover:text-ink-primary"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-6 w-6"
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
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-serif text-2xl leading-tight text-ink-primary">
              {meta.title}
            </h1>
            <p className="truncate text-sm text-ink-secondary">
              {meta.subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={startNewConversation}
            disabled={pending}
            className="shrink-0 rounded-pill border border-ink-muted/30 px-3 py-1.5 text-sm text-ink-primary transition-colors hover:bg-surface-warm disabled:opacity-50"
          >
            Новый разговор
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-6">
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
    <div className="flex h-dvh animate-pulse flex-col">
      <header className="shrink-0 border-b border-ink-muted/10">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <div className="h-6 w-6 shrink-0 rounded bg-surface-warm" />
          <div className="flex-1 space-y-2">
            <div className="h-5 w-40 rounded bg-surface-warm" />
            <div className="h-3 w-24 rounded bg-surface-warm" />
          </div>
          <div className="h-8 w-32 shrink-0 rounded-pill bg-surface-warm" />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-6">
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
