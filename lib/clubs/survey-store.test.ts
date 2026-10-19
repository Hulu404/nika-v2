import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Стор без базы: подменяем tgAdmin() цепочкой, которая записывает вызовы
 * (таблица, фильтры, патчи) и отдаёт заранее заданный ответ. Проверяем, что
 * в базу уходят нужные условия, а ошибка базы бросается и не попадает в лог
 * с персональными данными.
 */

type Call = [string, ...unknown[]];

let calls: Call[] = [];
let response: { data: unknown; error: { code?: string; message: string } | null } = {
  data: null,
  error: null,
};
/** Очередь ответов для функций, которые ходят в базу дважды. */
let queue: (typeof response)[] = [];

function next() {
  return Promise.resolve(queue.length ? queue.shift()! : response);
}

vi.mock("../telegram/supabase", () => ({
  tgAdmin: () => {
    const chain: Record<string, unknown> = {};
    const rec =
      (name: string) =>
      (...args: unknown[]) => {
        calls.push([name, ...args]);
        return chain;
      };
    for (const m of ["from", "select", "eq", "is", "not", "lte", "or", "order", "limit", "update", "upsert", "insert"]) {
      chain[m] = rec(m);
    }
    chain.maybeSingle = () => {
      calls.push(["maybeSingle"]);
      return next();
    };
    chain.single = () => {
      calls.push(["single"]);
      return next();
    };
    // Цепочка без maybeSingle тоже awaitable — как запрос supabase-js.
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      next().then(resolve, reject);
    return chain;
  },
}));

const store = await import("./survey-store");

const named = (name: string) => calls.filter((c) => c[0] === name).map((c) => c.slice(1));

beforeEach(() => {
  calls = [];
  queue = [];
  response = { data: null, error: null };
});

describe("ошибки базы", () => {
  it("бросаются, а в лог уходят только операция и код — без chat_id", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    response = { data: null, error: { code: "57014", message: "canceling statement" } };

    await expect(store.askedChatIds("yoga")).rejects.toThrow("DB error");
    await expect(store.getResponse("yoga", 987654321)).rejects.toThrow("DB error");

    const logged = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("[club-survey]");
    expect(logged).toContain("57014");
    expect(logged).not.toContain("987654321");
    log.mockRestore();
  });

  it("неверный id итога отсекается до запроса", async () => {
    await expect(store.getResult(0)).rejects.toThrow();
    await expect(store.resultRecipients("yoga", 1.5)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("строка ответа", () => {
  it("createResponse: upsert без перезаписи, true только для новой строки", async () => {
    response = { data: [{ chat_id: 1 }], error: null };
    expect(await store.createResponse("yoga", 1, "link")).toBe(true);
    expect(named("upsert")[0]).toEqual([
      { survey_key: "yoga", chat_id: 1, source: "link" },
      { onConflict: "survey_key,chat_id", ignoreDuplicates: true },
    ]);

    response = { data: [], error: null };
    expect(await store.createResponse("yoga", 1, "broadcast")).toBe(false);
  });

  it("updateResponse ставит updated_at и проверяет прошлое значение", async () => {
    response = { data: { chat_id: 1 }, error: null };
    await store.updateResponse("yoga", 1, { step: "days" }, { expectedUpdatedAt: "2026-10-20T10:00:00Z" });

    const patch = named("update")[0][0] as Record<string, unknown>;
    expect(patch.step).toBe("days");
    expect(typeof patch.updated_at).toBe("string");
    expect(named("eq")).toContainEqual(["updated_at", "2026-10-20T10:00:00Z"]);
  });

  it("updateResponse без совпадения возвращает null", async () => {
    response = { data: null, error: null };
    expect(await store.updateResponse("yoga", 1, { step: "days" })).toBeNull();
  });

  it("markBlocked заводит строку, а если она была — обновляет отметку", async () => {
    queue = [
      { data: [], error: null }, // upsert: строка уже есть
      { data: { chat_id: 5 }, error: null }, // update
    ];
    await store.markBlocked("yoga", 5, "broadcast");

    const upsert = named("upsert")[0][0] as Record<string, unknown>;
    expect(typeof upsert.blocked_at).toBe("string");
    expect(named("update")).toHaveLength(1);
    expect(typeof (named("update")[0][0] as Record<string, unknown>).blocked_at).toBe("string");
  });

  it("ANSWERS_RESET стирает ответы, но не согласие и не отметки рассылок", () => {
    const keys = Object.keys(store.ANSWERS_RESET);
    for (const k of ["consent_at", "consent_version", "name", "asked_at", "reminded_at", "blocked_at"]) {
      expect(keys).not.toContain(k);
    }
    expect(store.ANSWERS_RESET).toMatchObject({ days: [], weekdays: [], wd_any: false, we_any: false });
    expect(Object.isFrozen(store.ANSWERS_RESET)).toBe(true);
  });
});

describe("выборки", () => {
  it("askedChatIds — множество чатов опроса", async () => {
    response = { data: [{ chat_id: 1 }, { chat_id: 2 }, { chat_id: 2 }], error: null };
    expect(await store.askedChatIds("yoga")).toEqual(new Set([1, 2]));
    expect(named("eq")).toContainEqual(["survey_key", "yoga"]);
  });

  it("dueForReminder: согласие есть, не закончил, не напоминали, не заблокирован, итога нет", async () => {
    response = { data: [], error: null };
    const before = new Date("2026-10-20T07:00:00Z");
    await store.dueForReminder("yoga", before, 25);

    expect(named("not")).toContainEqual(["consent_at", "is", null]);
    expect(named("not")).toContainEqual(["step", "in", "(done,later_done)"]);
    expect(named("is")).toEqual(
      expect.arrayContaining([
        ["reminded_at", null],
        ["blocked_at", null],
        ["result_id", null],
      ]),
    );
    expect(named("lte")).toContainEqual(["asked_at", before.toISOString()]);
    expect(named("limit")).toContainEqual([25]);
  });

  it("resultRecipients: все с согласием, кому эта версия ещё не уходила", async () => {
    response = { data: [], error: null };
    await store.resultRecipients("yoga", 7);

    expect(named("not")).toContainEqual(["consent_at", "is", null]);
    expect(named("is")).toContainEqual(["blocked_at", null]);
    expect(named("or")).toContainEqual(["result_id.is.null,result_id.lt.7"]);
  });

  it("dueForEve: «Буду»/«Приду» на действующую версию, ещё не напоминали по ней", async () => {
    response = { data: [], error: null };
    await store.dueForEve("yoga", 7, 25);

    expect(named("eq")).toEqual(
      expect.arrayContaining([
        ["result_id", 7],
        ["result_answer", "yes"],
      ]),
    );
    expect(named("or")).toContainEqual(["eve_result_id.is.null,eve_result_id.lt.7"]);
  });
});

describe("итог", () => {
  it("markResultSent сбрасывает ответ на прошлую версию", async () => {
    response = { data: { chat_id: 1 }, error: null };
    await store.markResultSent("yoga", 1, { resultId: 3, variant: "match", messageId: 42 });

    expect(named("update")[0][0]).toMatchObject({
      result_id: 3,
      result_variant: "match",
      result_msg_id: 42,
      result_answer: null,
      result_answered_at: null,
    });
  });

  it("recordResultAnswer пишет только для действующей версии", async () => {
    response = { data: [], error: null };
    expect(await store.recordResultAnswer("yoga", 1, 2, "yes")).toBe(false);
    expect(named("eq")).toContainEqual(["result_id", 2]);

    response = { data: [{ chat_id: 1 }], error: null };
    expect(await store.recordResultAnswer("yoga", 1, 2, "yes")).toBe(true);
  });

  it("confirmResult не трогает уже подтверждённый итог", async () => {
    const row = { id: 3, confirmed_at: "2026-10-23T10:00:00Z" };
    response = { data: row, error: null };
    expect(await store.confirmResult(3)).toEqual(row);
    expect(named("update")).toHaveLength(0);
  });

  it("confirmResult подтверждает черновик условным update", async () => {
    queue = [
      { data: { id: 3, confirmed_at: null }, error: null },
      { data: { id: 3, confirmed_at: "2026-10-23T10:00:00Z" }, error: null },
    ];
    const res = await store.confirmResult(3);
    expect(res?.confirmed_at).toBe("2026-10-23T10:00:00Z");
    expect(named("is")).toContainEqual(["confirmed_at", null]);
  });

  it("currentResult — последняя подтверждённая версия", async () => {
    response = { data: null, error: null };
    expect(await store.currentResult("yoga")).toBeNull();
    expect(named("not")).toContainEqual(["confirmed_at", "is", null]);
    expect(named("order")).toContainEqual(["id", { ascending: false }]);
  });
});
