import "server-only";
import { anthropic, NIKA_MODEL } from "@/lib/anthropic";

/**
 * Сервис подсчёта входных токенов реплики пользователя. Нужен лимиту и потолку
 * (см. lib/plans/limits-config.ts).
 */

/**
 * Приближённая оценка входных токенов по длине — fallback, когда точный подсчёт
 * недоступен (сбой countTokens). Кириллица ≈ 2 символа на токен; сознательно
 * консервативно, чтобы не занижать расход.
 * TODO: заменить на локальный токенайзер, если точный подсчёт станет дорогим по
 * латентности и мы решим не звать Anthropic API на каждое сообщение.
 */
export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 2);
}

export interface MessageTokens {
  tokens: number;
  /** true — посчитано эвристикой estimateTokens, а не Anthropic API. */
  estimated: boolean;
}

/**
 * Точный подсчёт входных токенов реплики через Anthropic countTokens (GA в SDK
 * 0.65). Один сетевой вызов на сообщение — приемлемо по латентности для чата.
 * При сбое не роняем чат: откатываемся на эвристику и помечаем estimated=true,
 * чтобы позже не считать это значение точным при сверке COGS.
 */
export async function countMessageTokens(content: string): Promise<MessageTokens> {
  try {
    const counted = await anthropic.messages.countTokens({
      model: NIKA_MODEL,
      messages: [{ role: "user", content }],
    });
    return { tokens: counted.input_tokens, estimated: false };
  } catch (err) {
    console.error("[tokens] countTokens failed, falling back to estimate:", err);
    return { tokens: estimateTokens(content), estimated: true };
  }
}
