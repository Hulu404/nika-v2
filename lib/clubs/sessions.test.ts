import { describe, expect, it } from "vitest";
import { MIN_INVOICE_RUB, moscowToday, SESSIONS, sessionForSignup, sessionOfSignup } from "./sessions";

const OCT_27 = new Date("2026-10-27T12:00:00Z");

describe("moscowToday", () => {
  it("после 21:00 UTC по Москве уже следующий день", () => {
    expect(moscowToday(new Date("2026-10-31T21:30:00Z"))).toBe("2026-11-01");
  });
});

describe("sessionForSignup", () => {
  it("находит занятие клуба по дате", () => {
    expect(sessionForSignup({ club: "stretch", date: "2026-11-01" }, OCT_27)?.priceRub).toBe(100);
  });
  it("цена каждого занятия не ниже минимума счёта Telegram", () => {
    for (const s of SESSIONS) expect(s.priceRub).toBeGreaterThanOrEqual(MIN_INVOICE_RUB);
  });
  it("незнакомая дата — ближайшее занятие клуба", () => {
    expect(sessionForSignup({ club: "stretch", date: "2026-10-01" }, OCT_27)?.date).toBe("2026-11-01");
  });
  it("нет клуба или занятие прошло — null", () => {
    expect(sessionForSignup({ club: null, date: "2026-11-01" }, OCT_27)).toBeNull();
    expect(sessionForSignup({ club: "stretch", date: null }, new Date("2026-11-02T12:00:00Z"))).toBeNull();
  });
});

describe("sessionOfSignup", () => {
  it("строка заявки → занятие", () => {
    expect(sessionOfSignup({ club: "stretch", event_date: "2026-11-01", event_time: "10:30" })?.spot).toBe("klimashkina");
    expect(sessionOfSignup({ club: "stretch", event_date: "2026-11-01", event_time: "12:00" })).toBeNull();
  });
});
