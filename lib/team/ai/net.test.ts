import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeNetError, forceIPv4, recentNetErrors, resetNetErrors } from "./net";
import { MemoryAiUsage, TeamAiError, createTeamAi, type FetchLike } from "./yandex";

const CONFIG = { apiKey: "k", folderId: "f1", modelUri: "gpt://f1/yandexgpt/latest" };
const fetchFailed = (code: string, message = "other side closed") =>
  Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(message), { code }) });

describe("причина сетевой ошибки", () => {
  beforeEach(() => resetNetErrors());
  afterEach(() => vi.restoreAllMocks());

  it("«fetch failed» раскрывается в код и сообщение из cause", () => {
    expect(describeNetError(fetchFailed("UND_ERR_SOCKET"))).toEqual({ name: "TypeError", code: "UND_ERR_SOCKET", message: "other side closed" });
    expect(describeNetError(new Error("boom"))).toEqual({ name: "Error", code: null, message: "boom" });
  });

  it("лог сетевой ошибки: host, attempt, after, name, code, msg; ошибка — в кольцевом буфере", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch: FetchLike = async () => { throw fetchFailed("ECONNRESET", "read ECONNRESET"); };
    const ai = createTeamAi({ config: CONFIG, usage: new MemoryAiUsage(), fetch, sleep: async () => {} });
    const err = (await ai.step({ messages: [], tools: [] }).catch((e: unknown) => e)) as Error;
    expect(err.message).toContain("ECONNRESET");
    const line = String(log.mock.calls[0][0]);
    expect(line).toMatch(/^\[team-ai\] net host=ai\.api\.cloud\.yandex\.net attempt=1\/\d+ after=\d+ name=TypeError code=ECONNRESET msg=read ECONNRESET$/);
    expect(recentNetErrors()).toMatchObject({ top: "ECONNRESET" });
    expect(recentNetErrors().count).toBeGreaterThanOrEqual(2);
  });
});

describe("повторы и устойчивое соединение", () => {
  beforeEach(() => {
    resetNetErrors();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const ok = { ok: true, status: 200, json: async () => ({ result: { alternatives: [{ message: { text: "ок" } }] } }), text: async () => "" };
  const scripted = (steps: Array<Error | { status: number }>) => {
    const calls: Array<{ fresh?: boolean }> = [];
    const fetch: FetchLike = async (_url, init) => {
      calls.push({ fresh: init.fresh });
      const next = steps.shift();
      if (!next) return ok;
      if (next instanceof Error) throw next;
      return { ok: false, status: next.status, json: async () => ({}), text: async () => "bad request" };
    };
    return { fetch, calls };
  };
  const pauses: number[] = [];
  const make = (fetch: FetchLike) => createTeamAi({ config: CONFIG, usage: new MemoryAiUsage(), fetch, sleep: async (ms) => void pauses.push(ms) });
  beforeEach(() => void (pauses.length = 0));

  it("ECONNRESET → повтор сразу и на новом соединении → успех", async () => {
    const { fetch, calls } = scripted([fetchFailed("ECONNRESET")]);
    expect((await make(fetch).step({ messages: [], tools: [] })).type).toBe("text");
    expect(calls).toEqual([{ fresh: undefined }, { fresh: true }]);
    expect(pauses).toEqual([]);
  });

  it("три сетевые ошибки подряд → TeamAiError с кодом; паузы 300 и 1200 мс", async () => {
    const { fetch, calls } = scripted([fetchFailed("ETIMEDOUT", "connect ETIMEDOUT"), fetchFailed("ETIMEDOUT", "connect ETIMEDOUT"), fetchFailed("ENETUNREACH", "connect ENETUNREACH")]);
    const err = await make(fetch).step({ messages: [], tools: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TeamAiError);
    expect((err as Error).message).toBe("ENETUNREACH: connect ENETUNREACH");
    expect(calls).toHaveLength(3);
    expect(pauses).toEqual([300, 1200]);
  });

  it("4xx не повторяется; 5xx — повторяется", async () => {
    let s = scripted([{ status: 400 }]);
    await expect(make(s.fetch).step({ messages: [], tools: [] })).rejects.toMatchObject({ message: "HTTP 400: bad request" });
    expect(s.calls).toHaveLength(1);
    s = scripted([{ status: 503 }, { status: 502 }]);
    expect((await make(s.fetch).step({ messages: [], tools: [] })).type).toBe("text");
    expect(s.calls).toHaveLength(3);
  });

  it("до дедлайна меньше 3 секунд — новую попытку не начинаем", async () => {
    const { fetch, calls } = scripted([fetchFailed("ETIMEDOUT")]);
    const err = await make(fetch).step({ messages: [], tools: [], deadline: Date.now() + 2_500 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TeamAiError);
    expect(calls).toHaveLength(1);
  });

  it("IPv4 по умолчанию; YANDEX_FORCE_IPV4=false — выключает", () => {
    expect(forceIPv4({})).toBe(true);
    expect(forceIPv4({ YANDEX_FORCE_IPV4: "false" })).toBe(false);
    expect(forceIPv4({ YANDEX_FORCE_IPV4: "true" })).toBe(true);
  });
});
