"use client";

import { useState } from "react";
import { ChatInput } from "@/components/ChatInput";
import { MessageBubble } from "@/components/MessageBubble";
import { TypingIndicator } from "@/components/TypingIndicator";
import { useChatScroll } from "@/hooks/useChatScroll";
import { SCENARIO_META } from "@/lib/scenarios";
import { cn } from "@/lib/utils";
import type { ChatMessage, Scenario } from "@/types/conversation";

export function Chat({
  scenario,
  className,
}: {
  scenario: Scenario;
  className?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content: SCENARIO_META[scenario].opener,
      createdAt: new Date().toISOString(),
    },
  ]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const last = messages[messages.length - 1];
  // Скроллим вниз и при добавлении сообщений, и по мере дописывания ответа.
  const scrollRef = useChatScroll(
    `${messages.length}-${last?.content.length ?? 0}-${pending}`,
  );

  // Пока ждём первый токен, последнее сообщение — реплика пользователя.
  const showTyping = pending && last?.role === "user";

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
      // API ждёт историю, начинающуюся с реплики пользователя —
      // открывающую реплику НИКИ (assistant) отбрасываем.
      const firstUser = history.findIndex((m) => m.role === "user");
      const payload = history
        .slice(firstUser)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario, messages: payload }),
      });
      if (!res.ok || !res.body) throw new Error(`status ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantId: string | null = null;
      let acc = "";

      // Читаем поток токенов и дописываем ответ НИКИ по мере прихода.
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
    <div className={cn("flex flex-col bg-canvas", className)}>
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
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
