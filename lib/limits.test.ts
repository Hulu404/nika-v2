import { describe, it, expect, vi, afterEach } from "vitest";
import { checkDailyLimits, getTodayUsage } from "@/lib/limits";
import { planConfig } from "@/lib/plans/limits-config";

/**
 * Мини-фейк Supabase: воспроизводит цепочку
 * from("conversations").select(...).eq(...).gte(...) → { data: rows }.
 */
function fakeSupabase(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    gte: () => Promise.resolve({ data: rows }),
  };
  return { from: () => chain } as never;
}

const startOfDay = new Date();
startOfDay.setHours(0, 0, 0, 0);
const todayTs = new Date(startOfDay.getTime() + 3_600_000).toISOString();
const yesterdayTs = new Date(startOfDay.getTime() - 3_600_000).toISOString();

function userMsg(inputTokens: number, timestamp: string) {
  return { role: "user", content: "x", timestamp, inputTokens };
}

afterEach(() => vi.restoreAllMocks());

describe("getTodayUsage — суточная граница периода (пункт 5)", () => {
  it("считает единицы только по сегодняшним репликам, вчерашние исключает", async () => {
    const rows = [
      {
        id: "c1",
        messages: [
          userMsg(250, yesterdayTs), // вчера — не в счёт
          userMsg(250, yesterdayTs), // вчера — не в счёт
          userMsg(500, todayTs), // сегодня → 2 единицы
        ],
      },
    ];
    const usage = await getTodayUsage(fakeSupabase(rows), "u1", planConfig("free"));
    expect(usage.units).toBe(2);
    expect(usage.activeDialogIds).toEqual(["c1"]);
  });

  it("диалог без сегодняшних реплик не активен и не тратит квоту", async () => {
    const rows = [{ id: "c1", messages: [userMsg(250, yesterdayTs)] }];
    const usage = await getTodayUsage(fakeSupabase(rows), "u1", planConfig("free"));
    expect(usage.units).toBe(0);
    expect(usage.activeDialogIds).toEqual([]);
  });
});

describe("checkDailyLimits — суточная квота (пункт 4)", () => {
  it("free: осталась 1 единица (использовано 19) + сообщение на 2 → отказ", async () => {
    // 4750 токенов → ceil(4750/250) = 19 единиц использовано сегодня.
    const rows = [{ id: "c1", messages: [userMsg(4750, todayTs)] }];
    const block = await checkDailyLimits(fakeSupabase(rows), "u1", "free", "c1", 2);
    expect(block).toEqual({ reason: "messages", limit: 20 });
  });

  it("free: впритык (использовано 18 + 2 = 20) → пропуск", async () => {
    const rows = [{ id: "c1", messages: [userMsg(4500, todayTs)] }]; // 18 единиц
    const block = await checkDailyLimits(fakeSupabase(rows), "u1", "free", "c1", 2);
    expect(block).toBeNull();
  });

  it("premium: квота исчерпана (1000 + 2) → НЕ блокируем, но пишем warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = [{ id: "c1", messages: [userMsg(250_000, todayTs)] }]; // 1000 единиц
    const block = await checkDailyLimits(fakeSupabase(rows), "u1", "premium", "c1", 2);
    expect(block).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("soft daily quota exceeded");
  });

  it("pro: своя квота (350) — использовано 349 + 2 → отказ", async () => {
    const rows = [{ id: "c1", messages: [userMsg(349 * 250, todayTs)] }]; // 349 единиц
    const block = await checkDailyLimits(fakeSupabase(rows), "u1", "pro", "c1", 2);
    expect(block).toEqual({ reason: "messages", limit: 350 });
  });
});
