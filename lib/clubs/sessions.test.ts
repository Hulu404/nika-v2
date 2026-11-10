import { describe, expect, it } from "vitest";
import { isFreeSession, MIN_INVOICE_RUB, moscowToday, SESSIONS, sessionForSignup, sessionOfSignup } from "./sessions";

const OCT_27 = new Date("2026-10-27T12:00:00Z");

describe("moscowToday", () => {
  it("после 21:00 UTC по Москве уже следующий день", () => {
    expect(moscowToday(new Date("2026-10-31T21:30:00Z"))).toBe("2026-11-01");
  });
});

describe("sessionForSignup", () => {
  it("находит занятие клуба по дате", () => {
    expect(sessionForSignup({ club: "stretch", date: "2026-11-01" }, OCT_27)?.priceRub).toBe(1000);
  });
  it("цена каждого платного занятия не ниже минимума счёта Telegram, бесплатное — ровно 0", () => {
    for (const s of SESSIONS) {
      if (isFreeSession(s)) expect(s.priceRub).toBe(0);
      else expect(s.priceRub).toBeGreaterThanOrEqual(MIN_INVOICE_RUB);
    }
  });
  it("незнакомая дата — ближайшее занятие клуба", () => {
    expect(sessionForSignup({ club: "stretch", date: "2026-10-01" }, OCT_27)?.date).toBe("2026-11-01");
  });
  it("нет клуба или занятие прошло — null", () => {
    expect(sessionForSignup({ club: null, date: "2026-11-01" }, OCT_27)).toBeNull();
    expect(sessionForSignup({ club: "stretch", date: null }, new Date("2026-11-09T12:00:00Z"))).toBeNull();
  });
  it("после 1 ноября ближайшее занятие — № 002, 8 ноября в 12:00, сбор в 11:30", () => {
    const s = sessionForSignup({ club: "stretch", date: "2026-11-01" }, new Date("2026-11-03T12:00:00Z"));
    expect(s).toMatchObject({ date: "2026-11-08", time: "12:00", gatherAt: "11:30", edition: 2 });
  });
});

describe("sessionOfSignup", () => {
  it("строка заявки → занятие", () => {
    expect(sessionOfSignup({ club: "stretch", event_date: "2026-11-01", event_time: "10:30" })?.spot).toBe("klimashkina");
    expect(sessionOfSignup({ club: "stretch", event_date: "2026-11-01", event_time: "12:00" })).toBeNull();
  });
});
