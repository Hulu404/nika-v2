import { describe, it, expect } from "vitest";
import {
  shouldSendCheckin,
  countLeadingMisses,
  localParts,
  validTimezone,
  DEFAULT_TZ,
} from "./schedule";

describe("частота чек-инов — shouldSendCheckin", () => {
  it("базово шлёт по Пн/Ср/Пт, не шлёт в остальные дни", () => {
    const base = { askedToday: false, recentAnswers: [] as (string | null)[] };
    expect(shouldSendCheckin({ ...base, weekday: 1 })).toBe(true); // Пн
    expect(shouldSendCheckin({ ...base, weekday: 3 })).toBe(true); // Ср
    expect(shouldSendCheckin({ ...base, weekday: 5 })).toBe(true); // Пт
    expect(shouldSendCheckin({ ...base, weekday: 2 })).toBe(false); // Вт
    expect(shouldSendCheckin({ ...base, weekday: 0 })).toBe(false); // Вс
    expect(shouldSendCheckin({ ...base, weekday: 6 })).toBe(false); // Сб
  });

  it("дедуп: если уже спрашивали сегодня — не шлём", () => {
    expect(shouldSendCheckin({ weekday: 1, askedToday: true, recentAnswers: [] })).toBe(false);
  });

  it("3 пропуска подряд → сниженная частота (только Пн)", () => {
    const misses = [null, null, null];
    expect(shouldSendCheckin({ weekday: 3, askedToday: false, recentAnswers: misses })).toBe(false); // Ср уже не шлём
    expect(shouldSendCheckin({ weekday: 5, askedToday: false, recentAnswers: misses })).toBe(false); // Пт тоже
    expect(shouldSendCheckin({ weekday: 1, askedToday: false, recentAnswers: misses })).toBe(true); // Пн остаётся
  });

  it("первый ответ возвращает к норме", () => {
    const afterAnswer = ["ok", null, null, null]; // свежий с ответом
    expect(shouldSendCheckin({ weekday: 3, askedToday: false, recentAnswers: afterAnswer })).toBe(true);
  });

  it("countLeadingMisses считает только ведущие null", () => {
    expect(countLeadingMisses([null, null, "ok", null])).toBe(2);
    expect(countLeadingMisses(["full"])).toBe(0);
    expect(countLeadingMisses([])).toBe(0);
  });
});

describe("локальное время — localParts / validTimezone", () => {
  it("Europe/Moscow: 05:00 UTC понедельника → 08:00, weekday=1", () => {
    const utc = new Date("2026-07-20T05:00:00Z"); // 2026-07-20 = понедельник
    const { hour, weekday, ymd } = localParts("Europe/Moscow", utc);
    expect(hour).toBe(8);
    expect(weekday).toBe(1);
    expect(ymd).toBe("2026-07-20");
  });

  it("битая таймзона → дефолт", () => {
    expect(validTimezone("Not/AZone")).toBe(DEFAULT_TZ);
    expect(validTimezone(null)).toBe(DEFAULT_TZ);
    expect(validTimezone("Europe/Moscow")).toBe("Europe/Moscow");
  });
});
