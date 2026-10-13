import { TeamAiError, type ChatMessage, type TeamAi, type ToolCall, type ToolSpec } from "./yandex";

/**
 * Цикл ассистента на одно сообщение: модель → вызовы инструментов →
 * результаты обратно в модель → … → текстовый ответ. Не больше 5 шагов и 45
 * секунд на всё; дольше — ошибка, которую вызывающий превращает в «Что-то
 * пошло не так». Инструменты выполняет код (tools.ts) от имени отправителя.
 */

export const MAX_STEPS = 5;
export const AGENT_DEADLINE_MS = 45_000;
/** Результат инструмента для модели — не длиннее этого. */
export const TOOL_RESULT_MAX_CHARS = 6_000;

/** Длинный результат инструмента обрезается с пометкой, сколько не влезло. */
export function clipToolResult(content: string): string {
  if (content.length <= TOOL_RESULT_MAX_CHARS) return content;
  const head = content.slice(0, TOOL_RESULT_MAX_CHARS - 40);
  return `${head}…и ещё ${content.length - head.length} символов`;
}

export interface AgentRun {
  /** Последний текстовый ответ модели (может быть пустым). */
  text: string;
  steps: number;
  tokensIn: number;
  tokensOut: number;
  /** Что вызывалось — для памяти диалога и тестов. */
  calls: Array<ToolCall & { result: string }>;
}

export interface AgentInput {
  ai: Pick<TeamAi, "step">;
  messages: ChatMessage[];
  tools: readonly ToolSpec[];
  /** Выполнить инструмент; результат — строка (обычно JSON), её увидит модель. */
  execute: (call: ToolCall) => Promise<string>;
  /** Перед каждым шагом (показать «печатает»). */
  onStep?: () => Promise<void> | void;
  maxSteps?: number;
  deadlineMs?: number;
  /** Сколько шагов пройдено и какие инструменты вызваны — для лога, если цикл упадёт. */
  progress?: { steps: number; tools: string[] };
  clock?: () => number;
}

export async function runAgent(input: AgentInput): Promise<AgentRun> {
  const clock = input.clock ?? (() => Date.now());
  const deadline = clock() + (input.deadlineMs ?? AGENT_DEADLINE_MS);
  const messages = [...input.messages];
  const run: AgentRun = { text: "", steps: 0, tokensIn: 0, tokensOut: 0, calls: [] };
  for (let i = 0; i < (input.maxSteps ?? MAX_STEPS); i++) {
    if (clock() >= deadline) throw new TeamAiError("api", "agent deadline");
    await input.onStep?.();
    const res = await input.ai.step({ messages, tools: input.tools, deadline });
    run.steps++;
    if (input.progress) input.progress.steps = run.steps;
    run.tokensIn += res.tokensIn;
    run.tokensOut += res.tokensOut;
    if (res.type === "text") {
      run.text = res.text;
      return run;
    }
    messages.push({ role: "assistant", toolCallList: { toolCalls: res.calls.map((c) => ({ functionCall: c })) } });
    const results: Array<{ functionResult: { name: string; content: string } }> = [];
    for (const call of res.calls) {
      input.progress?.tools.push(call.name);
      let content: string;
      try {
        content = await input.execute(call);
      } catch (err) {
        // Ошибка инструмента — не авария диалога: модель узнает и ответит по-человечески.
        content = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
      content = clipToolResult(content);
      run.calls.push({ ...call, result: content });
      results.push({ functionResult: { name: call.name, content } });
    }
    messages.push({ role: "user", toolResultList: { toolResults: results } });
  }
  // Пять шагов без ответа: инструменты уже сделали своё (предпросмотр, список) — молча заканчиваем.
  return run;
}
