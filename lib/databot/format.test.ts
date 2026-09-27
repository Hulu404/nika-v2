import { describe, expect, it } from "vitest";
import {
  WORDS,
  countWord,
  escapeHtml,
  formatDayDate,
  formatDdMm,
  formatInt,
  formatMskTime,
  formatPercent,
  formatPeriodRange,
  formatRub,
  pluralForm,
} from "./format";

describe("числа и деньги", () => {
  it("пробел между разрядами", () => {
    expect(formatInt(0)).toBe("0");
    expect(formatInt(999)).toBe("999");
    expect(formatInt(1000)).toBe("1 000");
    expect(formatInt(13410)).toBe("13 410");
    expect(formatInt(1234567)).toBe("1 234 567");
    expect(formatInt(-1500)).toBe("−1 500");
  });

  it("рубли как в примере ТЗ: «13 410 ₽», копейки — только если есть", () => {
    expect(formatRub(13410)).toBe("13 410 ₽");
    expect(formatRub(299)).toBe("299 ₽");
    expect(formatRub(1)).toBe("1 ₽");
    expect(formatRub(299.5)).toBe("299,50 ₽");
    expect(formatRub(0)).toBe("0 ₽");
  });

  it("процент — целым, при нулевой базе — нет процента", () => {
    expect(formatPercent(23, 25)).toBe("92 %");
    expect(formatPercent(1, 3)).toBe("33 %");
    expect(formatPercent(5, 0)).toBeNull();
  });
});

describe("даты, периоды, время", () => {
  it("«сб 03.10»", () => {
    expect(formatDayDate("2026-10-03")).toBe("сб 03.10");
    expect(formatDayDate("2026-09-28")).toBe("пн 28.09");
    expect(formatDayDate("2026-09-27")).toBe("вс 27.09");
    expect(formatDayDate("2028-02-29")).toBe("вт 29.02");
    expect(formatDdMm("2026-01-05")).toBe("05.01");
  });

  it("периоды «21.09–27.09», один день, через Новый год — с годом", () => {
    expect(formatPeriodRange("2026-09-21", "2026-09-27")).toBe("21.09–27.09");
    expect(formatPeriodRange("2026-10-03", "2026-10-03")).toBe("03.10");
    expect(formatPeriodRange("2025-12-29", "2026-01-04")).toBe("29.12.2025–04.01.2026");
  });

  it("время по Москве с подписью МСК при UTC-времени сервера", () => {
    expect(formatMskTime(new Date("2026-09-27T11:32:00Z"))).toBe("14:32 МСК");
    expect(formatMskTime(new Date("2026-09-27T21:05:00Z"))).toBe("00:05 МСК");
  });
});

describe("склонения", () => {
  it.each([
    [1, "1 заявка"],
    [2, "2 заявки"],
    [4, "4 заявки"],
    [5, "5 заявок"],
    [11, "11 заявок"],
    [12, "12 заявок"],
    [14, "14 заявок"],
    [21, "21 заявка"],
    [22, "22 заявки"],
    [25, "25 заявок"],
    [101, "101 заявка"],
    [111, "111 заявок"],
    [0, "0 заявок"],
    [1021, "1 021 заявка"],
  ])("%i → %s", (n, text) => {
    expect(countWord(n, WORDS.signup)).toBe(text);
  });

  it("другие слова", () => {
    expect(countWord(214, WORDS.click)).toBe("214 переходов");
    expect(countWord(3, WORDS.payment)).toBe("3 оплаты");
    expect(pluralForm(2, WORDS.person)).toBe("человека");
    expect(pluralForm(5, WORDS.person)).toBe("человек");
  });
});

describe("экранирование", () => {
  it("любое динамическое значение", () => {
    expect(escapeHtml("<b>Аня</b> & Ко")).toBe("&lt;b&gt;Аня&lt;/b&gt; &amp; Ко");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(5)).toBe("5");
  });
});
