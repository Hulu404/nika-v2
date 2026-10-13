import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeNetError, recentNetErrors, resetNetErrors } from "./net";
import { MemoryAiUsage, createTeamAi, type FetchLike } from "./yandex";

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
    const ai = createTeamAi({ config: CONFIG, usage: new MemoryAiUsage(), fetch });
    const err = await ai.step({ messages: [], tools: [] }).catch((e: unknown) => e as Error);
    expect(err.message).toContain("ECONNRESET");
    const line = String(log.mock.calls[0][0]);
    expect(line).toMatch(/^\[team-ai\] net host=ai\.api\.cloud\.yandex\.net attempt=1\/\d+ after=\d+ name=TypeError code=ECONNRESET msg=read ECONNRESET$/);
    expect(recentNetErrors()).toMatchObject({ top: "ECONNRESET" });
    expect(recentNetErrors().count).toBeGreaterThanOrEqual(2);
  });
});
