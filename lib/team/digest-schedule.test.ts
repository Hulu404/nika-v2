import { describe, expect, it } from "vitest";
import { DAILY_HOUR_MSK, dailyDigestDue } from "./digest-schedule";

describe("расписание сводки дня", () => {
  it("с 9:00 МСК (конец тихих часов), не раньше", () => {
    expect(DAILY_HOUR_MSK).toBe(9);
    expect(dailyDigestDue("2026-10-13", 8)).toBeNull();
    expect(dailyDigestDue("2026-10-13", 9)).toBe("2026-10-13");
  });

  it("проспанный час догоняется до полудня, вечером уже не сводка", () => {
    expect(dailyDigestDue("2026-10-13", 11)).toBe("2026-10-13");
    expect(dailyDigestDue("2026-10-13", 12)).toBeNull();
    expect(dailyDigestDue("2026-10-13", 23)).toBeNull();
  });
});
