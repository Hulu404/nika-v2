import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { periodEndFor } from "@/lib/robokassa";

describe("срок подписки", () => {
  const from = new Date("2026-10-02T12:00:00Z");
  it("пробная неделя за 1 ₽ даёт 7 дней", () => {
    expect(periodEndFor("pro", from).toISOString()).toBe("2026-10-09T12:00:00.000Z");
  });
  it("месячный и полугодовой тарифы считаются в месяцах", () => {
    expect(periodEndFor("monthly", from).toISOString().slice(0, 10)).toBe("2026-11-02");
    expect(periodEndFor("halfyear", from).toISOString().slice(0, 10)).toBe("2027-04-02");
  });
});
