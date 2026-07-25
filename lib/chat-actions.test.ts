import { describe, it, expect } from "vitest";
import { resolveRunDate, parseAction, encodeAction } from "@/lib/chat-actions";

describe("resolveRunDate — сервер считает дату, модель год не задаёт", () => {
  const now = new Date("2026-07-25T09:00:00Z");

  it("days_ago не задан → сегодня", () => {
    expect(resolveRunDate(undefined, now)).toBe("2026-07-25");
  });

  it("0 → сегодня, 1 → вчера, 2 → позавчера", () => {
    expect(resolveRunDate(0, now)).toBe("2026-07-25");
    expect(resolveRunDate(1, now)).toBe("2026-07-24");
    expect(resolveRunDate(2, now)).toBe("2026-07-23");
  });

  it("переход через границу месяца", () => {
    expect(resolveRunDate(5, new Date("2026-08-02T09:00:00Z"))).toBe("2026-07-28");
  });

  it("дробное округляется, отрицательное клампится к 0", () => {
    expect(resolveRunDate(2.6, now)).toBe("2026-07-22");
    expect(resolveRunDate(-10, now)).toBe("2026-07-25");
  });

  it("нечисловое смещение (строка/объект) → сегодня, а не мусорная дата", () => {
    expect(resolveRunDate("вчера", now)).toBe("2026-07-25");
    expect(resolveRunDate({}, now)).toBe("2026-07-25");
    expect(resolveRunDate(NaN, now)).toBe("2026-07-25");
  });

  it("год всегда из часов сервера — регресс на галлюцинацию 2025", () => {
    // Ключевой баг: пробежка «сегодня» уезжала в 2025 год.
    for (const daysAgo of [0, 1, 3, 7, 30]) {
      expect(resolveRunDate(daysAgo, now).startsWith("2026-")).toBe(true);
    }
  });
});

describe("parseAction / encodeAction — без регрессий", () => {
  it("round-trip action-маркера", () => {
    const action = { href: "/journal", label: "Открыть журнал" };
    const encoded = "ответ ники" + encodeAction(action);
    const { text, action: parsed } = parseAction(encoded);
    expect(text).toBe("ответ ники");
    expect(parsed).toEqual(action);
  });
});
