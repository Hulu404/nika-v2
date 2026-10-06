import { describe, expect, it } from "vitest";
import { DAILY_HOUR_MSK, dailyDigestDue } from "./digest-schedule";

describe("расписание сводки дня", () => {
  it("с 8:00 МСК, не раньше", () => {
    expect(DAILY_HOUR_MSK).toBe(8);
    expect(dailyDigestDue("2026-10-13", 7)).toBeNull();
    expect(dailyDigestDue("2026-10-13", 8)).toBe("2026-10-13");
  });

  it("проспанный час догоняется до полудня, вечером уже не сводка", () => {
    expect(dailyDigestDue("2026-10-13", 11)).toBe("2026-10-13");
    expect(dailyDigestDue("2026-10-13", 12)).toBeNull();
    expect(dailyDigestDue("2026-10-13", 23)).toBeNull();
  });
});
