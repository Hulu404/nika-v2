import { describe, it, expect } from "vitest";
import { isFutureDate, todayStr } from "@/lib/runs";

describe("isFutureDate — пробежку записывают постфактум", () => {
  const now = new Date("2026-08-07T12:00:00");

  it("сегодня и прошлое проходят", () => {
    expect(isFutureDate("2026-08-07", now)).toBe(false);
    expect(isFutureDate("2026-08-06", now)).toBe(false);
    expect(isFutureDate("2025-12-31", now)).toBe(false);
  });

  it("завтра и дальше — отклоняем", () => {
    expect(isFutureDate("2026-08-08", now)).toBe(true);
    expect(isFutureDate("2026-09-01", now)).toBe(true);
    expect(isFutureDate("2027-01-01", now)).toBe(true);
  });

  it("сравнение по календарю, а не по времени суток", () => {
    const lateEvening = new Date("2026-08-07T23:59:00");
    expect(isFutureDate("2026-08-07", lateEvening)).toBe(false);
    expect(isFutureDate("2026-08-08", lateEvening)).toBe(true);
  });

  it("todayStr отдаёт YYYY-MM-DD с ведущими нулями", () => {
    expect(todayStr(new Date("2026-01-05T00:30:00"))).toBe("2026-01-05");
  });
});
