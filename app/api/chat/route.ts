import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, NIKA_MODEL } from "@/lib/anthropic";
import { createConversation, updateConversation } from "@/lib/conversations";
import { FREE_DAILY_LIMIT, isLimitReached } from "@/lib/limits";
import { buildSystemPrompt } from "@/lib/prompts";
import { ALL_SCENARIOS } from "@/lib/scenarios";
import { createServerComponentClient } from "@/lib/supabase";
import type { Message } from "@/types/app";
import type { Scenario } from "@/types/conversation";

export const runtime = "nodejs";

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

  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantText = "";
      try {
        const anthropicStream = anthropic.messages.stream({
          model: NIKA_MODEL,
          max_tokens: 1024,
          system: [
            {
              type: "text",
              text: buildSystemPrompt(scenario),
              cache_control: { type: "ephemeral" },
            },
          ],
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
          await updateConversation(supabase, convId, toStore);
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
