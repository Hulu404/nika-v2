"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClientComponentClient } from "@/lib/supabase";
import { ChatInput } from "@/components/ChatInput";
import { MessageBubble } from "@/components/MessageBubble";
import { TypingIndicator } from "@/components/TypingIndicator";
import { QuickReplies } from "@/components/QuickReplies";
import { useChatScroll } from "@/hooks/useChatScroll";
import { SCENARIO_META } from "@/lib/scenarios";
import { cn } from "@/lib/utils";
import type { ChatMessage, ChatAction, Scenario } from "@/types/conversation";
import { parseAction } from "@/lib/chat-actions";

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
  const pathname = usePathname();
  const [supabase] = useState(() => createClientComponentClient());
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Сессия окончательно потеряна: и тихий рефреш, и повтор вернули 401.
  const [authLost, setAuthLost] = useState(false);
  // Черновик, который надо вернуть в поле ввода (ChatInput очищает его при
  // отправке). Растущий id заставляет ChatInput перечитать текст — в том числе
  // когда второй раз восстанавливаем тот же самый текст.
  const [restoreDraft, setRestoreDraft] = useState<{ id: number; text: string } | null>(null);
  const [limitInfo, setLimitInfo] = useState<{
    reason: "messages" | "dialogs";
    limit: number;
    canUpgrade: boolean;
  } | null>(null);

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
    setLimitInfo(null);
    setAuthLost(false);

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    const history = [...messages, userMessage];
    setMessages(history);
    setPending(true);

    // id реплики НИКИ, если стрим успел что-то напечатать. Нужен снаружи try:
    // по нему в catch отличаем «не начали отвечать» от «оборвались на полпути».
    let assistantId: string | null = null;

    // Откат неудачной отправки: убираем реплику из ленты и возвращаем текст в
    // поле ввода. Без этого каждый повтор дописывает ещё одну копию — и в
    // ленту, и в payload следующего запроса (клиент шлёт всю историю целиком),
    // так что после трёх попыток в Claude уезжает сообщение в трёх экземплярах.
    // Если НИКА уже начала отвечать — не откатываем, иначе ответ осиротеет.
    const rollback = () => {
      if (assistantId !== null) return;
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
      setRestoreDraft((prev) => ({ id: (prev?.id ?? 0) + 1, text }));
    };

    try {
      // Историю больше не шлём: она лежит в БД, и сервер сам её читает.
      // clientMessageId делает повтор идемпотентным — ретрай на 401 ниже
      // переиспользует этот же id и не создаёт вторую реплику.
      const request = () =>
        fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scenario,
            text,
            clientMessageId: userMessage.id,
            conversationId,
          }),
        });

      let res = await request();

      // 401 — сессия истекла или слетела. Не пугаем пользователя сразу:
      // форсируем клиентский рефреш (getUser() сходит в Supabase и, если
      // access-токен протух, обновит его и перезапишет cookies) и повторяем
      // запрос РОВНО ОДИН раз. Счётчика не нужно: повтор здесь ровно один,
      // рекурсии нет, поэтому зациклиться невозможно.
      if (res.status === 401) {
        try {
          await supabase.auth.getUser();
        } catch (refreshErr) {
          // Рефреш не удался — повтор ниже всё равно делаем: он даст честный
          // 401, и мы покажем мягкое предложение войти заново.
          console.warn("[Chat] session refresh failed:", refreshErr);
        }

        res = await request();

        if (res.status === 401) {
          // Текст возвращаем в поле — после повторного входа его можно
          // отправить снова, не набирая заново.
          setAuthLost(true);
          rollback();
          return;
        }
      }

      if (res.status === 402) {
        const data = await res.json().catch(() => ({}));
        const canUpgrade = data.canUpgrade !== false;
        setLimitInfo({
          reason: data.reason === "dialogs" ? "dialogs" : "messages",
          limit: typeof data.limit === "number" ? data.limit : 0,
          canUpgrade,
        });
        // Добавляем реплику от Ники в её голосе
        const nikaMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: canUpgrade
            ? "На сегодня у меня закончилось пространство для разговора. Это не конец — просто граница дня. В Про его намного больше, если хочется продолжать без ограничений."
            : "На сегодня лимит диалогов закончился. Вернётся завтра.",
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, nikaMsg]);
        setError("limit_reached");
        return;
      }
      if (res.status === 429) {
        rollback();
        setError("Слишком быстро 🙂 Подожди немного и попробуй снова.");
        return;
      }
      if (res.status === 413) {
        rollback();
        setError("Сообщение слишком длинное — сократи и отправь ещё раз.");
        return;
      }

      // Прочие не-ok. Разделяем 5xx и остальное: одинаковый текст на все случаи
      // не давал понять по скриншоту от тестера, что вообще произошло.
      if (!res.ok || !res.body) {
        console.error("[Chat] request failed:", res.status, res.statusText);
        rollback();
        setError(
          res.status >= 500
            ? "У меня сбой на сервере. Попробуй ещё раз через минуту."
            : `Не получилось отправить (${res.status}). Попробуй ещё раз.`,
        );
        return;
      }

      // Запоминаем id диалога (важно для только что созданного нового диалога).
      const returnedId = res.headers.get("X-Conversation-Id");
      if (returnedId && returnedId !== conversationId) {
        setConversationId(returnedId);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        if (!acc) continue;

        // Во время стриминга не показываем action-маркер — он в конце стрима.
        const displayText = acc.replace(/\n⟪ACTION:\{.*?\}⟫$/, "");

        if (assistantId === null) {
          const id = crypto.randomUUID();
          assistantId = id;
          setMessages((prev) => [
            ...prev,
            { id, role: "assistant", content: displayText, createdAt: new Date().toISOString() },
          ]);
        } else {
          const id = assistantId;
          setMessages((prev) =>
            prev.map((m) => (m.id === id ? { ...m, content: displayText } : m)),
          );
        }
      }

      // Когда стрим завершён — парсим финальный action и прикрепляем к сообщению.
      if (assistantId !== null) {
        const { text: finalText, action } = parseAction(acc);
        if (action) {
          const id = assistantId;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id ? { ...m, content: finalText, action } : m,
            ),
          );
        }
      }

      if (assistantId === null) throw new Error("empty stream");
    } catch (err) {
      // Сюда попадают обрыв сети и падение уже начатого стрима (сервер зовёт
      // controller.error, и reader.read() бросает).
      console.error("[Chat] send failed:", err);
      const started = assistantId !== null;
      rollback(); // no-op, если НИКА уже начала отвечать
      setError(
        started
          ? "Ответ оборвался на полпути. Попробуй ещё раз."
          : "Не получилось получить ответ. Попробуй ещё раз.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={cn("flex flex-col overflow-hidden bg-[var(--bg-primary)]", className)}>
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex max-w-2xl flex-col gap-2 px-4 pb-2 pt-5">
          {messages.map((m) => (
            <div key={m.id} className={cn(m.role === "assistant" ? "self-start" : "self-end", "w-full")}>
              <MessageBubble role={m.role}>
                {m.content}
              </MessageBubble>
              {m.role === "assistant" && m.action && (
                <div className="mt-2 pl-1">
                  <Link
                    href={m.action.href}
                    className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-surface-nika px-3.5 py-2 text-[13px] font-medium text-accent transition-colors hover:bg-accent/10"
                  >
                    {m.action.label}
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                      <path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                </div>
              )}
            </div>
          ))}
          {showTyping && <TypingIndicator />}
          {authLost ? (
            <div className="px-1 pt-1 text-center">
              <p className="text-sm text-ink-muted">
                Кажется, тебя разлогинило. Зайди заново — и продолжим, я никуда не денусь.
              </p>
              <Link
                href={`/auth?next=${encodeURIComponent(pathname)}`}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-surface-nika px-3.5 py-2 text-[13px] font-medium text-accent transition-colors hover:bg-accent/10"
              >
                Войти заново
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </div>
          ) : error === "limit_reached" ? null : error ? (
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

      {/* Нейтральная заглушка для Про при исчерпании лимита */}
      {error === "limit_reached" && !limitInfo?.canUpgrade && (
        <div className="shrink-0 border-t border-line-subtle bg-[var(--bg-primary)] px-4 py-3 text-center text-[13px] text-ink-muted">
          Лимит на сегодня исчерпан. Вернётся завтра.
        </div>
      )}

      <ChatInput
        onSend={send}
        disabled={pending || error === "limit_reached"}
        restore={restoreDraft}
      />

      {/* Апгрейд-модал (только для Free при исчерпании лимита) */}
      {error === "limit_reached" && limitInfo?.canUpgrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-5">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
          <div className="relative w-full max-w-[360px] rounded-[20px] bg-elevated px-6 py-7 shadow-2xl text-center">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-surface-nika">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h3 className="mb-2 font-serif text-[20px] leading-tight text-ink-primary">
              Больше пространства для разговора
            </h3>
            <p className="mb-6 text-[13.5px] leading-[1.55] text-ink-secondary">
              В Про лимит намного выше и больше инструментов — журнал пробежек, советы, спринт.
            </p>
            <Link
              href="/upgrade"
              className="block w-full rounded-pill bg-accent py-3.5 text-[14px] font-medium text-canvas transition-opacity hover:opacity-90"
            >
              Открыть НИКА Про
            </Link>
            <button
              onClick={() => setError(null)}
              className="mt-3 block w-full text-[13px] text-ink-muted transition-colors hover:text-ink-primary"
            >
              Не сейчас
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Скелет-лоадер чата — показывается, пока серверный компонент грузит историю. */
export function ChatSkeleton() {
  return (
    <div className="flex h-dvh animate-pulse flex-col bg-canvas">
      <header className="sticky top-0 z-10 flex shrink-0 items-center gap-3 border-b border-line-subtle px-4 pb-3 pt-header-top-lg">
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
