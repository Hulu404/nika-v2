import { describe, expect, it } from "vitest";
import { CALLBACK_MAX_BYTES, callbackBytes, cb, parseCallback } from "./callback";
import type { Section } from "./types";
import {
  SPOT_SLUG_MAX,
  isChatId,
  isIsoDate,
  isKbSlug,
  isLinkCode,
  isPage,
  isPeriodCode,
  isSpotSlug,
  isZone,
  periodCode,
} from "./validate";

describe("cb / parseCallback: туда-обратно", () => {
  it("примеры из ТЗ 4.2", () => {
    expect(cb("run", "card", "luzhniki", "2026-10-03")).toBe("d:run:card:luzhniki:2026-10-03");
    expect(cb("tr", "ch", "7d")).toBe("d:tr:ch:7d");
    expect(cb("tr", "code", "IGST-0310", "30d")).toBe("d:tr:code:IGST-0310:30d");
    expect(cb("kb", "art", "stroka-cifr")).toBe("d:kb:art:stroka-cifr");
  });

  it("числа становятся строками, без параметров — пустой список", () => {
    expect(parseCallback(cb("run", "table", "7d", 2))).toEqual({
      section: "run",
      action: "table",
      params: ["7d", "2"],
    });
    expect(parseCallback(cb("tm", "list"))).toEqual({ section: "tm", action: "list", params: [] });
  });
});

describe("parseCallback: чужое и битое → null", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["пустая строка", ""],
    ["чужой префикс (командный бот)", "t:run:card:luzhniki"],
    ["префикс в другом регистре", "D:run:card"],
    ["только префикс", "d"],
    ["неизвестный раздел", "d:foo:card"],
    ["раздел в другом регистре", "d:RUN:card"],
    ["нет действия", "d:run"],
    ["пустое действие", "d:run:"],
    ["пустое действие перед параметром", "d:run::luzhniki"],
    ["пустой параметр в конце", "d:run:card:"],
    ["пустой параметр в середине", "d:run:card::2026-10-03"],
  ])("%s", (_, data) => {
    expect(parseCallback(data as string | null | undefined)).toBeNull();
  });
});

describe("cb: нарушение формата — бросает", () => {
  it("«:» в действии или параметре", () => {
    expect(() => cb("run", "ca:rd")).toThrow();
    expect(() => cb("run", "card", "luzh:niki")).toThrow();
    expect(() => cb("tr", "code", "IGST", "12:00")).toThrow();
  });
  it("пустое действие или параметр", () => {
    expect(() => cb("run", "")).toThrow();
    expect(() => cb("run", "card", "")).toThrow();
    expect(() => cb("run", "card", "luzhniki", "")).toThrow();
  });
});

describe("лимит 64 байта, а не символа", () => {
  // «d:kb:art:» — 9 байт; добиваем параметром до нужной длины.
  const head = "d:kb:art:";

  it("ровно 64 байта проходят, 65 — нет", () => {
    const p64 = "a".repeat(CALLBACK_MAX_BYTES - head.length);
    const ok = cb("kb", "art", p64);
    expect(callbackBytes(ok)).toBe(64);
    expect(parseCallback(ok)?.params).toEqual([p64]);

    const p65 = p64 + "a";
    expect(() => cb("kb", "art", p65)).toThrow();
    expect(parseCallback(head + p65)).toBeNull();
  });

  it("кириллица: 32 символа = 64 байта параметра, строка короче 64 символов, но длиннее 64 байт", () => {
    const cyr = "ж".repeat(32);
    expect(callbackBytes(cyr)).toBe(64);
    const data = head + cyr;
    expect(data.length).toBeLessThan(64); // 41 символ
    expect(callbackBytes(data)).toBe(73);
    expect(() => cb("kb", "art", cyr)).toThrow();
    expect(parseCallback(data)).toBeNull();
  });

  it("кириллица в пределах байтов допустима по формату", () => {
    // Валидаторы её отсекут, но callback.ts про смысл параметров не знает.
    const cyr = "ж".repeat((CALLBACK_MAX_BYTES - head.length) >> 1); // 27 символов, 54 байта
    const data = cb("kb", "art", cyr);
    expect(callbackBytes(data)).toBe(63);
    expect(parseCallback(data)?.params).toEqual([cyr]);
  });
});

/**
 * Самые длинные реалистичные кнопки каждого действия. Если какая-то перестанет
 * влезать (вырос SPOT_SLUG_MAX, добавился параметр), тест упадёт здесь, а не
 * cb бросит в проде на рендере экрана.
 */
describe("самый длинный вариант каждого действия ≤ 64 байт", () => {
  const spot = "s".repeat(SPOT_SLUG_MAX);
  const date = "2026-10-03";
  const page = 999;
  // Любые реальные даты дают 17 байт; этот — самый длинный допустимый (366 дней).
  const range = periodCode({ from: "2028-01-01", to: "2028-12-31" });
  const code = "CRUSACH-0310"; // 12 знаков, максимум формата
  const kbSlug = "k".repeat(40);
  const chatId = "4503599627370495"; // 16 цифр — максимум id в Telegram (2^52 − 1)

  type Check = (s: string) => boolean;
  type Row = {
    name: string;
    section: Section;
    action: string;
    params: Array<[string | number, Check]>;
    bytes: number; // ожидаемая длина — фиксирует таблицу из отчёта
  };

  const rows: Row[] = [
    { name: "run people", section: "run", action: "people", params: [[spot, isSpotSlug], [date, isIsoDate], [page, isPage]], bytes: 52 },
    { name: "run card", section: "run", action: "card", params: [[spot, isSpotSlug], [date, isIsoDate]], bytes: 46 },
    { name: "run plan", section: "run", action: "plan", params: [[spot, isSpotSlug], [date, isIsoDate]], bytes: 46 },
    { name: "run table", section: "run", action: "table", params: [[range, isPeriodCode], [page, isPage]], bytes: 33 },
    { name: "tr code", section: "tr", action: "code", params: [[code, isLinkCode], [range, isPeriodCode], [page, isPage]], bytes: 44 },
    { name: "tr codes", section: "tr", action: "codes", params: [[range, isPeriodCode], [page, isPage]], bytes: 32 },
    { name: "tr ch", section: "tr", action: "ch", params: [[range, isPeriodCode]], bytes: 25 },
    { name: "kb art", section: "kb", action: "art", params: [[kbSlug, isKbSlug]], bytes: 49 },
    { name: "kb restore", section: "kb", action: "restore", params: [[kbSlug, isKbSlug]], bytes: 53 },
    { name: "kb del", section: "kb", action: "del", params: [[kbSlug, isKbSlug], ["ok", (s) => s === "ok"]], bytes: 52 },
    { name: "tm zone", section: "tm", action: "zone", params: [[chatId, isChatId], ["council", isZone]], bytes: 34 },
    { name: "tm rm", section: "tm", action: "rm", params: [[chatId, isChatId], ["ok", (s) => s === "ok"]], bytes: 27 },
    { name: "tm inv", section: "tm", action: "inv", params: [["council", isZone]], bytes: 16 },
    { name: "pro p", section: "pro", action: "p", params: [[range, isPeriodCode]], bytes: 25 },
    { name: "prd p", section: "prd", action: "p", params: [[range, isPeriodCode]], bytes: 25 },
  ];

  it.each(rows)("$name — $bytes байт", ({ section, action, params, bytes }) => {
    // Параметры реалистичны: проходят те же валидаторы, что проверят кнопку.
    for (const [v, check] of params) expect(check(String(v))).toBe(true);

    const values = params.map(([v]) => v);
    const data = cb(section, action, ...values);
    expect(callbackBytes(data)).toBe(bytes);
    expect(callbackBytes(data)).toBeLessThanOrEqual(CALLBACK_MAX_BYTES);
    expect(parseCallback(data)).toEqual({ section, action, params: values.map(String) });
  });

  it("самая длинная кнопка оставляет запас", () => {
    const max = Math.max(...rows.map((r) => r.bytes));
    expect(max).toBe(53); // kb restore; запас 11 байт
  });
});
