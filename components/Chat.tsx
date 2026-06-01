"use client";

import { useState } from "react";
import Link from "next/link";
import { ChatInput } from "@/components/ChatInput";
import { MessageBubble } from "@/components/MessageBubble";
import { TypingIndicator } from "@/components/TypingIndicator";
import { QuickReplies } from "@/components/QuickReplies";
import { useChatScroll } from "@/hooks/useChatScroll";
import { FREE_DAILY_LIMIT } from "@/lib/limits";
import { SCENARIO_META } from "@/lib/scenarios";
import { cn } from "@/lib/utils";
import type { ChatMessage, Scenario } from "@/types/conversation";

export function Chat({
  scenario,
  initialMessages,
  conversationId: initialConversationId,
  className,
}: {
  scenario: Scenario;
  initialMessages: ChatMessage[];
  conversationId: string | null;
  className?: string;
}) {
  const meta = SCENARIO_META[scenario];
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const last = messages[messages.length - 1];
  const scrollRef = useChatScroll(
    `${messages.length}-${last?.content.length ?? 0}-${pending}`,
  );

  const showTyping = pending && last?.role === "user";
  // Быстрые ответы показываем только когда последнее сообщение — от НИКИ и не идёт запрос
  const showSuggestions = !pending && last?.role === "assistant" && messages.length <= 2;

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
      if (res.status === 402) {
        setError("limit_reached");
        return;
      }
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
            { id, role: "assistant", content: acc, createdAt: new Date().toISOString() },
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
    <div className={cn("flex flex-col overflow-hidden bg-[var(--bg-primary)]", className)}>
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-2 px-4 pb-2 pt-5">
          {messages.map((m) => (
            <MessageBubble key={m.id} role={m.role}>
              {m.content}
            </MessageBubble>
          ))}
          {showTyping && <TypingIndicator />}
          {error === "limit_reached" ? (
            <div className="mx-auto mt-2 max-w-md rounded-card border border-[#C8553D]/20 bg-surface-warm px-5 py-4 text-center">
              <p className="font-serif text-[15px] text-ink-primary">
                Ты использовал все {FREE_DAILY_LIMIT} бесплатных сообщений сегодня.
              </p>
              <Link
                href="/upgrade"
                className="mt-3 inline-block rounded-pill bg-accent px-5 py-2.5 text-[13px] font-medium text-canvas transition-colors hover:bg-accent-deep"
              >
                Перейти на НИКА Pro
              </Link>
            </div>
          ) : error ? (
            <p className="px-1 text-center text-sm text-ink-muted">{error}</p>
          ) : null}
        </div>

        {/* Быстрые ответы — показываются под сообщениями в прокручиваемой зоне */}
        {showSuggestions && (
          <div className="mx-auto max-w-2xl">
            <QuickReplies
              suggestions={meta.suggestions}
              onSelect={send}
              disabled={pending}
            />
          </div>
        )}
      </div>

      <ChatInput onSend={send} disabled={pending || error === "limit_reached"} />
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
          <div className="h-10 w-1/2 self-end rounded-bubble bg-[#C8553D]/20" />
          <div className="h-24 w-4/5 self-start rounded-bubble bg-surface-nika" />
          <div className="h-10 w-2/5 self-end rounded-bubble bg-[#C8553D]/20" />
        </div>
      </div>

      <div className="shrink-0 border-t border-line-subtle">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <div className="h-12 flex-1 rounded-bubble bg-surface-warm" />
          <div className="h-11 w-11 shrink-0 rounded-pill bg-surface-warm" />
        </div>
      </div>
    </div>
  );
}
