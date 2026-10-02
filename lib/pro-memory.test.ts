import { describe, it, expect } from "vitest";
import { formatMemory } from "@/lib/pro-memory";

const msg = (role: "user" | "assistant", content: string) => ({ role, content, timestamp: "2026-09-28T10:00:00Z" });

describe("память Про", () => {
  it("пусто, если вспоминать нечего", () => {
    expect(formatMemory({ conversations: [], runs: [], entries: [] })).toBe("");
  });
  it("берёт только слова человека, последние три из разговора, пробежки и дневник", () => {
    const t = formatMemory({
      conversations: [{ scenario: "morning", updated_at: "2026-09-28T19:00:00Z", messages: [msg("user", "раз"), msg("assistant", "ответ Ники"), msg("user", "два"), msg("user", "три"), msg("user", "Вечером было тяжело выйти")] }],
      runs: [{ date: "2026-09-27", distance_km: 5.2, duration_min: 31, ratings: { effort: 7, legs: 4 }, tags: [], note: "Ровно" }],
      entries: [{ date: "2026-09-26", text: "Спала плохо" }],
    });
    expect(t).toContain("<memory>");
    expect(t).toContain("«два» «три» «Вечером было тяжело выйти»");
    expect(t).not.toContain("ответ Ники");
    expect(t).not.toContain("«раз»");
    expect(t).toContain("5.2 км за 31 мин, усилие 7/10, ноги 4/10, «Ровно»");
    expect(t).toContain("2026-09-26: «Спала плохо»");
  });
  it("ограничивает длину", () => {
    const long = "x".repeat(500);
    const t = formatMemory({
      conversations: Array.from({ length: 30 }, (_, i) => ({ scenario: "general", updated_at: `2026-09-${String(10 + (i % 18)).padStart(2, "0")}T10:00:00Z`, messages: [msg("user", long), msg("user", long), msg("user", long)] })),
      runs: [],
      entries: [],
    });
    expect(t.length).toBeLessThanOrEqual(3200);
    expect(t.endsWith("</memory>")).toBe(true);
  });
});
