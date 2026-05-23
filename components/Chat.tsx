"use client";

import { useState } from "react";
import { ChatInput } from "@/components/ChatInput";
import { MessageBubble } from "@/components/MessageBubble";
import { TypingIndicator } from "@/components/TypingIndicator";
import { useChatScroll } from "@/hooks/useChatScroll";
import { SCENARIO_META } from "@/lib/scenarios";
import { cn } from "@/lib/utils";
import type { Message, Scenario } from "@/types/conversation";

export function Chat({
  scenario,
  className,
}: {
  scenario: Scenario;
  className?: string;
}) {
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content: SCENARIO_META[scenario].opener,
      createdAt: new Date().toISOString(),
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useChatScroll(`${messages.length}-${isLoading}`);

  async function send(text: string) {
    if (isLoading) return;
    setError(null);

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    const next = [...messages, userMessage];
    setMessages(next);
    setIsLoading(true);

    try {
      // API ждёт историю, начинающуюся с реплики пользователя — открывающую
      // реплику НИКИ (assistant) отбрасываем.
      const firstUser = next.findIndex((m) => m.role === "user");
      const payload = next
        .slice(firstUser)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario, messages: payload }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);

      const data = (await res.json()) as { message?: string };
      if (!data.message) throw new Error("empty response");

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.message!,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      console.error("[Chat] send failed:", err);
      setError("Не получилось получить ответ. Попробуй ещё раз.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className={cn("flex flex-col", className)}>
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-6">
          {messages.map((m) => (
            <MessageBubble key={m.id} role={m.role}>
              {m.content}
            </MessageBubble>
          ))}
          {isLoading && <TypingIndicator />}
          {error && (
            <p className="px-1 text-center text-sm text-ink-muted">{error}</p>
          )}
        </div>
      </div>
      <ChatInput onSend={send} disabled={isLoading} />
    </div>
  );
}
