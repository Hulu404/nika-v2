import Anthropic from "@anthropic-ai/sdk";

/**
 * Клиент Anthropic. Создаётся лениво один раз на процесс.
 * Ключ читается из ANTHROPIC_API_KEY (только сервер).
 */
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
});

/**
 * Модель по умолчанию для НИКИ. Sonnet — хороший баланс эмпатичности и стоимости
 * для диалогового потока. Для особо чувствительных сценариев можно поднять до
 * claude-opus-4-7.
 */
export const NIKA_MODEL = "claude-sonnet-4-6";
