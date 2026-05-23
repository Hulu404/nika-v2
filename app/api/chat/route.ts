import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, NIKA_MODEL } from "@/lib/anthropic";
import { buildSystemPrompt } from "@/lib/prompts";
import { SCENARIO_ORDER } from "@/lib/scenarios";
import type { Scenario } from "@/types/conversation";

export const runtime = "nodejs";

interface ChatRequest {
  scenario: Scenario;
  messages: Anthropic.MessageParam[];
}

export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { scenario, messages } = body;

  if (!SCENARIO_ORDER.includes(scenario)) {
    return Response.json({ error: "Unknown scenario" }, { status: 400 });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const anthropicStream = anthropic.messages.stream({
          model: NIKA_MODEL,
          max_tokens: 1024,
          // Системный промпт стабилен в рамках сценария — кэшируем его.
          system: [
            {
              type: "text",
              text: buildSystemPrompt(scenario),
              cache_control: { type: "ephemeral" },
            },
          ],
          messages,
        });

        for await (const event of anthropicStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
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
      // Отключаем буферизацию у прокси (например, nginx), чтобы токены шли сразу.
      "X-Accel-Buffering": "no",
    },
  });
}
