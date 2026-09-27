import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Слой данных: приведение чисел, «null — не ноль», авария вместо пустоты и
 * таймаут. Сервисный клиент подменён — в сеть ничего не уходит.
 */

let rpcResult: { data: unknown; error: { message: string; code?: string } | null } = { data: null, error: null };
let rpcThrows: unknown = null;
const rpcCalls: Array<{ name: string; args: unknown; signal: AbortSignal | null }> = [];

vi.mock("../../telegram/supabase", () => ({
  tgAdmin: () => ({
    rpc: (name: string, args: unknown) => ({
      abortSignal: async (signal: AbortSignal) => {
        rpcCalls.push({ name, args, signal });
        if (rpcThrows) throw rpcThrows;
        return rpcResult;
      },
    }),
  }),
}));

const { DB_TIMEOUT_MS, toNum, toNumOrNull } = await import("./client");
const { DatabotDataError, classifyDbError, withData } = await import("./errors");
const { fetchRunPeople, fetchRunsTable, parseRunPeople } = await import("./runs");
const { fetchTraffic, parseTrafficSince } = await import("./traffic");
const { parsePro } = await import("./pro");
const { parseProduct } = await import("./product");

beforeEach(() => {
  rpcResult = { data: null, error: null };
  rpcThrows = null;
  rpcCalls.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("числа из PostgREST", () => {
  it("строка и число → number; null → null, а не 0", () => {
    expect(toNum("12", "x")).toBe(12);
    expect(toNum(12, "x")).toBe(12);
    expect(toNumOrNull(null, "x")).toBeNull();
    expect(toNumOrNull(undefined, "x")).toBeNull();
  });

  it("мусор и пустота там, где ждали count, — авария", () => {
    expect(() => toNum("abc", "x")).toThrow(DatabotDataError);
    expect(() => toNum(null, "x")).toThrow(DatabotDataError);
  });
});

describe("классификация аварий", () => {
  it.each([
    [{ name: "AbortError", message: "aborted" }, "db_timeout"],
    [{ message: "AbortError: The operation was aborted" }, "db_timeout"],
    [{ name: "TimeoutError", message: "signal timed out" }, "db_timeout"],
    [{ code: "57014", message: "canceling statement due to statement timeout" }, "db_timeout"],
    [{ message: "permission denied for function databot_pro" }, "db_error"],
    [new Error("fetch failed"), "db_error"],
  ])("%j → %s", (err, code) => {
    expect(classifyDbError(err)).toBe(code);
  });

  it("withData отдаёт код вместо исключения и никогда не подставляет ноль", async () => {
    await expect(withData(async () => 5)).resolves.toEqual({ ok: true, value: 5 });
    await expect(withData(async () => { throw new DatabotDataError("db_timeout", "x"); })).resolves.toEqual({
      ok: false,
      error: "db_timeout",
    });
  });
});

describe("вызовы RPC", () => {
  it("каждый вызов — с таймаутом 10 секунд", async () => {
    expect(DB_TIMEOUT_MS).toBe(10_000);
    rpcResult = { data: [{ total: "3", new_people: 1, returning_people: "2", by_link: { IGST: "1", none: 2 } }], error: null };
    const people = await fetchRunPeople("luzhniki", "2026-09-20");
    expect(people).toEqual({ total: 3, newPeople: 1, returningPeople: 2, byLink: { IGST: 1, none: 2 } });
    expect(rpcCalls[0]).toMatchObject({ name: "databot_run_people", args: { p_spot: "luzhniki", p_date: "2026-09-20" } });
    expect(rpcCalls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("ошибка базы — DatabotDataError с кодом, а не пустой список", async () => {
    rpcResult = { data: null, error: { message: "AbortError: The operation was aborted" } };
    await expect(fetchRunsTable("2026-09-01", "2026-09-30")).rejects.toMatchObject({ code: "db_timeout" });
    rpcResult = { data: null, error: { message: "relation does not exist", code: "42P01" } };
    await expect(fetchTraffic(new Date(), new Date())).rejects.toMatchObject({ code: "db_error" });
  });

  it("сеть упала до ответа — тоже авария с кодом", async () => {
    rpcThrows = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    await expect(fetchRunsTable("2026-09-01", "2026-09-30")).rejects.toMatchObject({ code: "db_timeout" });
  });

  it("даты уходят в функцию как ISO-моменты", async () => {
    rpcResult = { data: [], error: null };
    await fetchTraffic(new Date("2026-09-20T21:00:00Z"), new Date("2026-09-27T21:00:00Z"));
    expect(rpcCalls[0].args).toEqual({ p_from: "2026-09-20T21:00:00.000Z", p_to: "2026-09-27T21:00:00.000Z" });
  });
});

describe("разбор ответов функций", () => {
  it("run_people: пустой ответ — авария (функция всегда отдаёт одну строку)", () => {
    expect(() => parseRunPeople([])).toThrow(DatabotDataError);
  });

  it("traffic_since: null — «ещё не записывали», а не дата", () => {
    expect(parseTrafficSince(null)).toBeNull();
    expect(parseTrafficSince("2026-10-01T09:00:00+00:00")?.toISOString()).toBe("2026-10-01T09:00:00.000Z");
  });

  const pro = {
    pro_now: 4, pro_paid: 2, pro_promo: 1, pro_manual: 1,
    payments_count: 2, payments_sum: "1789.00",
    payments_by_plan: { monthly: { count: 1, sum: 299 } },
    redeemed_by_code: [{ code: "SC1", label: "Стакан 1", count: 1 }, { code: "X", label: null, count: 2 }],
    redeemed_to_paid: 1, expiring_7d: 1,
  };

  it("pro: суммы в рублях, подписи кодов, null-подпись остаётся null", () => {
    const p = parsePro(pro);
    expect(p.paymentsSum).toBe(1789);
    expect(p.paymentsByPlan).toEqual({ monthly: { count: 1, sum: 299 } });
    expect(p.redeemedByCode[1]).toEqual({ code: "X", label: null, count: 2 });
  });

  it("pro: категории не сходятся с pro_now — авария, а не кривые цифры", () => {
    expect(() => parsePro({ ...pro, pro_manual: 5 })).toThrow(/не сходятся/);
  });

  it("product: nsm = null до Фазы 0 — «нет данных», а не ноль", () => {
    const p = parseProduct({
      signups: 3, onboarded: 2, tg_linked: 1, by_channel: { instagram: 1, none: 2 }, active_7d: 2,
      sprints_started: 1, sprints_active: 1, sprints_closed: 0, nudge_sent: 2, nudge_clicked: 1, nsm: null,
    });
    expect(p.nsm).toBeNull();
    expect(p.byChannel).toEqual({ instagram: 1, none: 2 });
    expect(p.sprintsClosed).toBe(0);
  });
});
