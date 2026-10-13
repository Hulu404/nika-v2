import { beforeEach, describe, expect, it } from "vitest";
import { aiCheckText, type CheckDeps } from "./check";
import { rememberNetError, resetNetErrors } from "./net";

/** Часы, которые на каждый вызов сдвигаются на заданный шаг (мс). */
const ticking = (steps: number[]) => {
  let t = 0;
  let i = 0;
  return () => (t += i < steps.length ? steps[i++] : 0);
};

describe("/ai_check", () => {
  beforeEach(() => resetNetErrors());

  it("всё живо: DNS, TCP, LLM, распознавание и счётчик ошибок за сутки", async () => {
    const now = Date.now();
    for (const code of ["ECONNRESET", "ECONNRESET", "ETIMEDOUT"]) rememberNetError({ at: now - 60_000, host: "ai.api.cloud.yandex.net", code });
    rememberNetError({ at: now - 2 * 86_400_000, host: "x", code: "EAI_AGAIN" });
    const deps: CheckDeps = {
      lookup: async () => [{ address: "1.1.1.1", family: 4 }, { address: "1.1.1.2", family: 4 }],
      connect: async () => {},
      llm: async () => {},
      model: "yandexgpt/latest",
      // DNS 12 мс, TCP 85, LLM 1900, DNS 10, TCP 70
      clock: ticking([0, 12, 0, 85, 0, 1900, 0, 10, 0, 70]),
      now: () => now,
    };
    expect(await aiCheckText(deps)).toBe([
      "🔌 Проверка ИИ",
      "DNS ai.api.cloud.yandex.net: 2 IPv4, 0 IPv6 · 12 мс",
      "TCP ai.api.cloud.yandex.net:443: ok · 85 мс",
      "LLM (короткий запрос «ответь ок»): ok · 1.9 с · модель yandexgpt/latest",
      "DNS stt.api.cloud.yandex.net: 2 IPv4, 0 IPv6 · 10 мс",
      "TCP stt.api.cloud.yandex.net:443: ok · 70 мс",
      "Последние ошибки (за 24 ч): 3 · чаще всего ECONNRESET",
    ].join("\n"));
  });

  it("хост недоступен — ошибка строкой, проверка не падает", async () => {
    const fail = (code: string) => async () => { throw Object.assign(new Error(`${code} boom`), { code }); };
    const text = await aiCheckText({
      lookup: fail("ENOTFOUND"), connect: fail("ETIMEDOUT"),
      llm: async () => { throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) }); },
      model: "yandexgpt/latest",
    });
    expect(text).toContain("DNS ai.api.cloud.yandex.net: ошибка ENOTFOUND ENOTFOUND boom");
    expect(text).toContain("TCP ai.api.cloud.yandex.net:443: ошибка ETIMEDOUT ETIMEDOUT boom");
    expect(text).toContain("LLM (короткий запрос «ответь ок»): ошибка UND_ERR_SOCKET other side closed");
    expect(text).toContain("Последние ошибки (за 24 ч): 0");
  });

  it("модель выключена — так и пишет", async () => {
    const text = await aiCheckText({ lookup: async () => [{ address: "::1", family: 6 }], connect: async () => {}, llm: null, model: null });
    expect(text).toContain("0 IPv4, 1 IPv6");
    expect(text).toContain("LLM: выключено");
  });
});
