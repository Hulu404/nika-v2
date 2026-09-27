import { describe, expect, it } from "vitest";
import {
  SPOT_SLUG_MAX,
  isChatId,
  isInviteToken,
  isIsoDate,
  isKbSlug,
  isLinkCode,
  isPage,
  isPeriodCode,
  isSpotSlug,
  isZone,
  parsePeriodCode,
  periodCode,
} from "./validate";
import { newInviteToken } from "./invite";
import { COFFEE_RUNS } from "../coffeerun/run";

describe("isZone", () => {
  it("принимает три зоны", () => {
    for (const z of ["council", "events", "smm"]) expect(isZone(z)).toBe(true);
  });
  it("отсекает регистр, мусор и не-строки", () => {
    for (const z of ["Council", "SMM", " smm", "owner", "", null, undefined, 1, {}]) {
      expect(isZone(z)).toBe(false);
    }
  });
});

describe("isChatId", () => {
  it("положительные целые до 16 цифр в пределах 2^53", () => {
    for (const s of ["1", "123456789", "999999999999999", "4503599627370495"]) expect(isChatId(s)).toBe(true);
  });
  it("отсекает 17 цифр, выход за 2^53, ноль, ведущие нули, знак, дроби, пробелы", () => {
    for (const s of ["10000000000000000", "9999999999999999", "0", "0123", "-100123", "+5", "1.5", "1e5", " 12", "12 ", ""]) {
      expect(isChatId(s)).toBe(false);
    }
  });
});

describe("isIsoDate", () => {
  it("реальные даты, включая 29 февраля високосного", () => {
    for (const s of ["2026-10-03", "2026-01-01", "2026-12-31", "2028-02-29", "2000-02-29"]) {
      expect(isIsoDate(s)).toBe(true);
    }
  });
  it("несуществующие даты и чужой формат", () => {
    for (const s of [
      "2026-02-29", // не високосный
      "2026-02-30",
      "1900-02-29", // кратен 100, не кратен 400
      "2026-04-31",
      "2026-13-01",
      "2026-00-10",
      "2026-10-00",
      "0000-01-01",
      "26-10-03",
      "2026-1-3",
      "03.10.2026",
      "20261003",
      "2026-10-03T00:00",
      " 2026-10-03",
      "",
    ]) {
      expect(isIsoDate(s)).toBe(false);
    }
  });
});

describe("isSpotSlug", () => {
  it("слаги из расписания проходят", () => {
    for (const r of COFFEE_RUNS) expect(isSpotSlug(r.spot)).toBe(true);
  });
  it("границы длины: 2 и SPOT_SLUG_MAX", () => {
    expect(isSpotSlug("ab")).toBe(true);
    expect(isSpotSlug("a".repeat(SPOT_SLUG_MAX))).toBe(true);
    expect(isSpotSlug("a")).toBe(false);
    expect(isSpotSlug("a".repeat(SPOT_SLUG_MAX + 1))).toBe(false);
  });
  it("дефисы и цифры внутри, но начало — буква", () => {
    expect(isSpotSlug("surf-sport2")).toBe(true);
    for (const s of ["1spot", "-luzh", "Luzhniki", "лужники", "luzh_niki", "luzh:niki", "luzh niki", ""]) {
      expect(isSpotSlug(s)).toBe(false);
    }
  });
});

describe("isLinkCode", () => {
  it("коды по правилу имени (ТЗ 4.5)", () => {
    for (const s of ["IGST-0310", "IGBIO", "TGPIN", "CRLUZH-0310", "SC", "ABCDEFGHIJKL"]) {
      expect(isLinkCode(s)).toBe(true);
    }
  });
  it("длина 1 и 13, нижний регистр, кириллица, мусор", () => {
    for (const s of ["I", "ABCDEFGHIJKLM", "igst-0310", "IGST_0310", "IGST 0310", "ИГСТ", "IG:ST", ""]) {
      expect(isLinkCode(s)).toBe(false);
    }
  });
});

describe("isKbSlug", () => {
  it("границы 2 и 40, пример из ТЗ", () => {
    expect(isKbSlug("stroka-cifr")).toBe(true);
    expect(isKbSlug("ab")).toBe(true);
    expect(isKbSlug("a".repeat(40))).toBe(true);
    expect(isKbSlug("1-2")).toBe(true);
    expect(isKbSlug("a")).toBe(false);
    expect(isKbSlug("a".repeat(41))).toBe(false);
  });
  it("регистр, кириллица, подчёркивание, пробел", () => {
    for (const s of ["Stroka", "строка", "stroka_cifr", "stroka cifr", "kb:1", ""]) {
      expect(isKbSlug(s)).toBe(false);
    }
  });
});

describe("isInviteToken", () => {
  it("свежий токен из invite.ts проходит", () => {
    expect(isInviteToken(newInviteToken())).toBe(true);
    expect(isInviteToken("0123456789abcdef0123456789abcdef")).toBe(true);
  });
  it("31/33 символа, верхний регистр, не-hex", () => {
    for (const s of [
      "0123456789abcdef0123456789abcde",
      "0123456789abcdef0123456789abcdef0",
      "0123456789ABCDEF0123456789ABCDEF",
      "0123456789abcdef0123456789abcdeg",
      "inv_0123456789abcdef0123456789abcdef",
      "",
    ]) {
      expect(isInviteToken(s)).toBe(false);
    }
  });
});

describe("isPage", () => {
  it("1..999", () => {
    for (const s of ["1", "9", "10", "999"]) expect(isPage(s)).toBe(true);
  });
  it("ноль, 1000, ведущие нули, знак, дроби", () => {
    for (const s of ["0", "1000", "01", "001", "-1", "+1", "1.0", " 1", ""]) {
      expect(isPage(s)).toBe(false);
    }
  });
});

describe("период", () => {
  it("пресеты", () => {
    for (const p of ["7d", "pw", "tm", "30d"] as const) {
      expect(isPeriodCode(p)).toBe(true);
      expect(parsePeriodCode(p)).toEqual({ kind: "preset", preset: p });
    }
    for (const s of ["7D", "1d", "week", "tw", "30", ""]) {
      expect(isPeriodCode(s)).toBe(false);
      expect(parsePeriodCode(s)).toBeNull();
    }
  });

  it("свой период разбирается в ISO-даты", () => {
    expect(parsePeriodCode("20260921-20260927")).toEqual({
      kind: "range",
      from: "2026-09-21",
      to: "2026-09-27",
    });
    // Один день: from = to.
    expect(parsePeriodCode("20261003-20261003")).toEqual({
      kind: "range",
      from: "2026-10-03",
      to: "2026-10-03",
    });
  });

  it("from > to, несуществующие даты, чужой формат", () => {
    for (const s of [
      "20260927-20260921",
      "20260230-20260301",
      "20260101-20260230",
      "20260229-20260301",
      "2026-09-21-2026-09-27", // ISO с дефисами — не наш формат
      "20260921_20260927",
      "20260921-",
      "2026092-20260927",
      "20260921-20260927 ",
    ]) {
      expect(isPeriodCode(s)).toBe(false);
      expect(parsePeriodCode(s)).toBeNull();
    }
  });

  it("не длиннее 366 дней включительно; 29.02.2028 — реальная дата", () => {
    // 2028 високосный: 01.01–31.12 = 366 дней ровно.
    expect(isPeriodCode("20280101-20281231")).toBe(true);
    expect(isPeriodCode("20280229-20280229")).toBe(true);
    // 2026 невисокосный: 365 дней, плюс день — 366, плюс два — 367.
    expect(isPeriodCode("20260101-20261231")).toBe(true);
    expect(isPeriodCode("20260101-20270101")).toBe(true);
    expect(isPeriodCode("20260101-20270102")).toBe(false);
    expect(isPeriodCode("20280101-20290101")).toBe(false);
  });

  it("periodCode — обратное к parsePeriodCode", () => {
    for (const p of [
      { from: "2026-09-21", to: "2026-09-27" },
      { from: "2028-02-29", to: "2028-03-01" },
      { from: "2026-10-03", to: "2026-10-03" },
    ]) {
      const code = periodCode(p);
      expect(code).toMatch(/^\d{8}-\d{8}$/);
      expect(parsePeriodCode(code)).toEqual({ kind: "range", ...p });
    }
  });

  it("periodCode бросает на кривом периоде", () => {
    expect(() => periodCode({ from: "2026-09-27", to: "2026-09-21" })).toThrow();
    expect(() => periodCode({ from: "2026-02-30", to: "2026-03-01" })).toThrow();
    expect(() => periodCode({ from: "2026-01-01", to: "2027-01-02" })).toThrow();
    expect(() => periodCode({ from: "20260101", to: "20260102" })).toThrow();
  });
});
