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

  try {
    const response = await anthropic.messages.create({
      model: NIKA_MODEL,
      max_tokens: 1024,
      // Системный промпт стабилен между запросами одного сценария — кэшируем его.
      system: [
        {
          type: "text",
          text: buildSystemPrompt(scenario),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return Response.json({ message: text });
  } catch (err) {
    console.error("[api/chat] Anthropic error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
