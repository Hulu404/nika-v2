import { describe, expect, it, vi } from "vitest";
import { TOOL_RESULT_MAX_CHARS, clipToolResult, runAgent } from "./agent";
import { MemoryAiUsage, TeamAiError, createTeamAi, type FetchLike, type StepResult } from "./yandex";

const tools = [{ name: "get_my_day", description: "мой день", parameters: { type: "object", properties: {} } }];

describe("цикл инструментов", () => {
  it("модель → инструмент → результат обратно → текст; токены суммируются", async () => {
    const steps: StepResult[] = [
      { type: "tools", calls: [{ name: "get_my_day", arguments: {} }], tokensIn: 100, tokensOut: 10 },
      { type: "text", text: "Сегодня у тебя планёрка.", tokensIn: 150, tokensOut: 20 },
    ];
    const seen: unknown[] = [];
    const step = vi.fn(async (input: { messages: unknown[] }) => (seen.push(structuredClone(input.messages)), steps.shift()!));
    const onStep = vi.fn();
    const run = await runAgent({ ai: { step }, messages: [{ role: "user", text: "что у меня?" }], tools, execute: async () => '{"events":1}', onStep });
    expect(run).toMatchObject({ text: "Сегодня у тебя планёрка.", steps: 2, tokensIn: 250, tokensOut: 30 });
    expect(run.calls).toEqual([{ name: "get_my_day", arguments: {}, result: '{"events":1}' }]);
    expect(onStep).toHaveBeenCalledTimes(2);
    expect((seen[1] as unknown[]).slice(1)).toEqual([
      { role: "assistant", toolCallList: { toolCalls: [{ functionCall: { name: "get_my_day", arguments: {} } }] } },
      { role: "user", toolResultList: { toolResults: [{ functionResult: { name: "get_my_day", content: '{"events":1}' } }] } },
    ]);
  });

  it("не больше 8 шагов", async () => {
    const step = vi.fn(async (): Promise<StepResult> => ({ type: "tools", calls: [{ name: "get_my_day", arguments: {} }], tokensIn: 1, tokensOut: 1 }));
    const run = await runAgent({ ai: { step }, messages: [], tools, execute: async () => "{}" });
    expect(step).toHaveBeenCalledTimes(8);
    expect(run.text).toBe("");
  });

  it("общий таймаут 45 секунд", async () => {
    let t = 0;
    const step = vi.fn(async (): Promise<StepResult> => ((t += 20_000), { type: "tools", calls: [{ name: "get_my_day", arguments: {} }], tokensIn: 0, tokensOut: 0 }));
    await expect(runAgent({ ai: { step }, messages: [], tools, execute: async () => "{}", clock: () => t })).rejects.toBeInstanceOf(TeamAiError);
    expect(step).toHaveBeenCalledTimes(3);
  });

  it("ошибка инструмента уходит модели, а не роняет диалог", async () => {
    const steps: StepResult[] = [
      { type: "tools", calls: [{ name: "get_my_day", arguments: {} }], tokensIn: 0, tokensOut: 0 },
      { type: "text", text: "Не получилось открыть день.", tokensIn: 0, tokensOut: 0 },
    ];
    const run = await runAgent({ ai: { step: async () => steps.shift()! }, messages: [], tools, execute: async () => { throw new Error("база не ответила"); } });
    expect(run.calls[0].result).toBe('{"error":"база не ответила"}');
    expect(run.text).toBe("Не получилось открыть день.");
  });
});

describe("размер запроса к модели", () => {
  it("результат инструмента — не длиннее 6000 символов, с пометкой «…и ещё N»", async () => {
    expect(clipToolResult("короткий")).toBe("короткий");
    const long = "а".repeat(10_000);
    const clipped = clipToolResult(long);
    expect(clipped.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS + 30);
    expect(clipped).toMatch(/…и ещё 4040 символов$/);
    const steps: StepResult[] = [
      { type: "tools", calls: [{ name: "get_my_day", arguments: {} }], tokensIn: 0, tokensOut: 0 },
      { type: "text", text: "ок", tokensIn: 0, tokensOut: 0 },
    ];
    const seen: string[] = [];
    await runAgent({ ai: { step: async (input) => (seen.push(JSON.stringify(input.messages.at(-1))), steps.shift()!) }, messages: [], tools, execute: async () => long });
    expect(seen[1]).toContain("…и ещё 4040 символов");
    expect(seen[1].length).toBeLessThan(7_000);
  });
});

describe("шаг модели в нативном API", () => {
  const CONFIG = { apiKey: "k", folderId: "f1", modelUri: "gpt://f1/yandexgpt/latest" };
  const fake = (body: unknown) => {
    const calls: Array<{ body: string }> = [];
    const fetch: FetchLike = async (_url, init) => (calls.push({ body: String(init.body) }), { ok: true, status: 200, json: async () => body, text: async () => "" });
    return { fetch, calls };
  };

  it("tools уходят как function, toolCallList разбирается", async () => {
    const { fetch, calls } = fake({ result: { alternatives: [{ message: { role: "assistant", toolCallList: { toolCalls: [{ functionCall: { name: "get_my_day", arguments: {} } }] } }, status: "ALTERNATIVE_STATUS_TOOL_CALLS" }],
      usage: { inputTextTokens: "50", completionTokens: "5" } } });
    const ai = createTeamAi({ config: CONFIG, usage: new MemoryAiUsage(), fetch });
    expect(await ai.step!({ messages: [{ role: "user", text: "x" }], tools })).toEqual({ type: "tools", calls: [{ name: "get_my_day", arguments: {} }], tokensIn: 50, tokensOut: 5 });
    const body = JSON.parse(calls[0].body);
    expect(body.modelUri).toBe("gpt://f1/yandexgpt/latest");
    expect(body.tools).toEqual([{ function: tools[0] }]);
    expect(body).not.toHaveProperty("jsonSchema");
  });

  it("финальный текст; пустой ответ — ошибка", async () => {
    let f = fake({ result: { alternatives: [{ message: { role: "assistant", text: " Привет! " }, status: "ALTERNATIVE_STATUS_FINAL" }] } });
    expect(await createTeamAi({ config: CONFIG, usage: new MemoryAiUsage(), fetch: f.fetch }).step!({ messages: [], tools }))
      .toEqual({ type: "text", text: "Привет!", tokensIn: 0, tokensOut: 0 });
    f = fake({ result: { alternatives: [{ message: { role: "assistant" } }] } });
    await expect(createTeamAi({ config: CONFIG, usage: new MemoryAiUsage(), fetch: f.fetch }).step!({ messages: [], tools })).rejects.toBeInstanceOf(TeamAiError);
  });

  it("расход — одна строка на сообщение; лимит 40 сообщений в час", async () => {
    const usage = new MemoryAiUsage();
    const ai = createTeamAi({ config: CONFIG, usage, fetch: fake({}).fetch });
    await ai.recordLlm!(5, 300, 40);
    expect(usage.rows).toMatchObject([{ chat_id: 5, kind: "llm", tokens_in: 300, tokens_out: 40 }]);
    for (let i = 0; i < 39; i++) await ai.recordLlm!(5, 1, 1);
    await expect(ai.checkLimit!(5)).rejects.toMatchObject({ code: "rate_limit" });
    await expect(ai.checkLimit!(6)).resolves.toBeUndefined();
  });
});
