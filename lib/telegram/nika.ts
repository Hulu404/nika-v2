import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./prompts";
import type { Message, Scenario } from "./types";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;

// Ленивая инициализация клиента — чтобы импорт модуля не требовал
// ANTHROPIC_API_KEY на этапе сборки/сбора роутов.
let _anthropic: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

/**
 * Отправляет историю диалога в Claude и возвращает полный ответ НИКИ.
 * Для Telegram стриминг не нужен — ждём полного ответа и отправляем разом.
 *
 * Ограничения истории: берём последние 20 сообщений, чтобы не раздувать контекст.
 */
export async function getNikaResponse(
  scenario: Scenario,
  messages: Message[],
): Promise<string> {
  // API Anthropic требует, чтобы история начиналась с роли "user".
  // Открывающая реплика ассистента (opener) хранится в сессии, но в API не передаётся.
  const firstUser = messages.findIndex((m) => m.role === "user");
  if (firstUser === -1) {
    throw new Error("No user message in history");
  }

  const payload = messages
    .slice(firstUser)
    .slice(-20) // последние 20 реплик
    .map((m) => ({ role: m.role, content: m.content }));

  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text",
        text: buildSystemPrompt(scenario),
        // Промпт стабилен в рамках сценария — включаем prompt caching.
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: payload,
  });

  const block = response.content[0];
  if (block.type !== "text") {
    throw new Error("Unexpected response type from Anthropic");
  }

  return block.text;
}
