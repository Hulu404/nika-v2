import { describe, expect, it } from "vitest";
import { cleanupDue } from "./cleanup";

/**
 * Окно уборки — «первый проход после 04:00 МСК». Москва круглый год UTC+3,
 * поэтому 04:00 МСК = 01:00 UTC, а полночь МСК = 21:00 UTC предыдущих суток.
 */
describe("cleanupDue", () => {
  it("03:59 МСК — ещё рано", () => {
    expect(cleanupDue(null, new Date("2026-09-27T00:59:00Z"))).toBe(false);
  });

  it("04:00 МСК — пора", () => {
    expect(cleanupDue(null, new Date("2026-09-27T01:00:00Z"))).toBe(true);
  });

  it("сегодня уже убирали — не повторяем", () => {
    expect(cleanupDue("2026-09-27", new Date("2026-09-27T09:00:00Z"))).toBe(false);
  });

  it("последний раз вчера — пора", () => {
    expect(cleanupDue("2026-09-26", new Date("2026-09-27T09:00:00Z"))).toBe(true);
  });

  it("сутки считаются по Москве, а не по UTC", () => {
    // 21:00 UTC 26-го — это уже 00:00 МСК 27-го: московская дата сменилась,
    // но час 0 < 4, так что вчерашняя отметка ещё не повод убирать.
    const msk0000 = new Date("2026-09-26T21:00:00Z");
    expect(cleanupDue("2026-09-26", msk0000)).toBe(false);
    // 04:00 МСК 27-го: отметка от 26-го — вчерашняя, от 27-го — сегодняшняя.
    const msk0400 = new Date("2026-09-27T01:00:00Z");
    expect(cleanupDue("2026-09-26", msk0400)).toBe(true);
    expect(cleanupDue("2026-09-27", msk0400)).toBe(false);
    // 23:30 МСК 26-го (20:30 UTC): по Москве ещё 26-е, отметка от 26-го держит.
    expect(cleanupDue("2026-09-26", new Date("2026-09-26T20:30:00Z"))).toBe(false);
  });
});
