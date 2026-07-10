import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, NIKA_MODEL } from "@/lib/anthropic";
import { createConversation, updateConversation } from "@/lib/conversations";
import { FREE_DAILY_LIMIT, isLimitReached } from "@/lib/limits";
import { buildSystemPrompt } from "@/lib/prompts";
import { checkRateLimit } from "@/lib/rate-limit";
import { ALL_SCENARIOS } from "@/lib/scenarios";
import { buildSprintContext, getActiveSprint } from "@/lib/sprint";
import { createServerComponentClient } from "@/lib/supabase";
import type { Message } from "@/types/app";
import type { Scenario } from "@/types/conversation";

export const runtime = "nodejs";

// ── Ограничения payload ───────────────────────────────────────────────────────
// Защита от раздувания счёта за токены: один запрос не может нести бесконечную
// историю или гигантские реплики. Клиент шлёт всю историю каждый раз, поэтому
// без этих cap'ов один запрос способен сжечь огромный контекст.
const MAX_MESSAGES = 50; // реплик в истории за запрос
const MAX_MESSAGE_CHARS = 4_000; // символов в одной реплике
const MAX_TOTAL_CHARS = 24_000; // суммарно по всем репликам

// ── Rate limit на пользователя ────────────────────────────────────────────────
const CHAT_RATE_LIMIT = 20; // запросов
const CHAT_RATE_WINDOW_SECONDS = 60; // за окно (1 минута)

interface ChatRequest {
  scenario: Scenario;
  messages: { role: "user" | "assistant"; content: string }[];
  conversationId?: string | null;
}

export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { scenario, messages, conversationId } = body;

  if (!ALL_SCENARIOS.includes(scenario)) {
    return Response.json({ error: "Unknown scenario" }, { status: 400 });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages is required" }, { status: 400 });
  }
  if (messages.length > MAX_MESSAGES) {
    return Response.json({ error: "Too many messages" }, { status: 400 });
  }

  // Каждая реплика должна быть валидной парой role/content разумного размера.
  let totalChars = 0;
  for (const m of messages) {
    if (
      (m.role !== "user" && m.role !== "assistant") ||
      typeof m.content !== "string"
    ) {
      return Response.json({ error: "Invalid message" }, { status: 400 });
    }
    if (m.content.length > MAX_MESSAGE_CHARS) {
      return Response.json({ error: "Message too long" }, { status: 400 });
    }
    totalChars += m.content.length;
  }
  if (totalChars > MAX_TOTAL_CHARS) {
    return Response.json({ error: "Conversation too long" }, { status: 400 });
  }

  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit по пользователю — backstop против abuse независимо от Pro-статуса.
  const allowed = await checkRateLimit(
    `chat:${user.id}`,
    CHAT_RATE_LIMIT,
    CHAT_RATE_WINDOW_SECONDS,
  );
  if (!allowed) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(CHAT_RATE_WINDOW_SECONDS) } },
    );
  }

  const limited = await isLimitReached(supabase, user.id);
  if (limited) {
    return Response.json(
      { error: "limit_reached", limit: FREE_DAILY_LIMIT },
      { status: 402 },
    );
  }

  // Определяем диалог: при отсутствии id создаём новый (так «Новый разговор»
  // даёт свежий диалог, а не дописывает в последний).
  let convId: string;
  try {
    convId = conversationId
      ? conversationId
      : (await createConversation(supabase, user.id, scenario)).id;
  } catch (err) {
    console.error("[api/chat] conversation resolve failed:", err);
    return Response.json({ error: "Conversation error" }, { status: 500 });
  }

  const anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Активный спринт — добавляем динамический <user_context> в промт.
  const activeSprint = await getActiveSprint(supabase, user.id);
  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: buildSystemPrompt(scenario),
      cache_control: { type: "ephemeral" },
    },
  ];
  if (activeSprint) {
    systemBlocks.push({ type: "text", text: buildSprintContext(activeSprint) });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantText = "";
      try {
        const anthropicStream = anthropic.messages.stream({
          model: NIKA_MODEL,
          max_tokens: 1024,
          system: systemBlocks,
          messages: anthropicMessages,
        });

        for await (const event of anthropicStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            assistantText += event.delta.text;
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }

        // Сохраняем полный ход (обмен + ответ НИКИ). Опенер не храним — он
        // подставляется из SCENARIO_META при загрузке. Ошибка сохранения не
        // должна рвать уже доставленный ответ — логируем и продолжаем.
        const now = new Date().toISOString();
        const toStore: Message[] = [
          ...messages.map((m) => ({
            role: m.role,
            content: m.content,
            timestamp: now,
          })),
          { role: "assistant" as const, content: assistantText, timestamp: now },
        ];
        try {
          await updateConversation(supabase, convId, user.id, toStore);
        } catch (saveErr) {
          console.error("[api/chat] save failed:", saveErr);
        }

        controller.close();
      } catch (err) {
        console.error("[api/chat] stream error:", err);
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Conversation-Id": convId,
      // Отключаем буферизацию у прокси, чтобы токены шли сразу.
      "X-Accel-Buffering": "no",
    },
  });
}
