import { describe, it, expect } from "vitest";
import {
  cleanTags,
  cycleFromAnswer,
  isEmail,
  isPlausibleToday,
  isYmd,
  parseDiaryEntry,
  parseProfilePatch,
  parseRun,
  parseUiPrefs,
  rhythmEnabled,
} from "@/lib/v2/validate";

const NOW = new Date("2026-10-01T12:00:00Z");

describe("базовые проверки", () => {
  it("почта", () => {
    expect(isEmail("a@b.ru")).toBe(true);
    expect(isEmail(" a@b.ru ")).toBe(true);
    expect(isEmail("a@b")).toBe(false);
    expect(isEmail(42)).toBe(false);
  });
  it("дата и правдоподобное сегодня", () => {
    expect(isYmd("2026-02-30")).toBe(false);
    expect(isYmd("2026-10-01")).toBe(true);
    expect(isPlausibleToday("2026-10-02", NOW)).toBe(true);
    expect(isPlausibleToday("2026-10-05", NOW)).toBe(false);
  });
});

describe("метки", () => {
  it("коды и свои метки, без дублей и мусора", () => {
    expect(cleanTags(["sleep", "sleep", "c:  Музыка  ", "c:", "hack", 5])).toEqual(["sleep", "c:Музыка"]);
  });
  it("ограничение количества", () => {
    expect(cleanTags(["sleep", "coffee", "ate", "heat", "pain", "work"], 5)).toHaveLength(5);
  });
});

describe("цикл и ритм", () => {
  it("ответы онбординга", () => {
    expect(cycleFromAnswer("yes")).toBe("on");
    expect(cycleFromAnswer("no")).toBe("off");
    expect(cycleFromAnswer("later")).toBeNull();
    expect(cycleFromAnswer("maybe")).toBeUndefined();
  });
  it("вкладка только для «она» и «учитывать»", () => {
    expect(rhythmEnabled("female", "on")).toBe(true);
    expect(rhythmEnabled("female", "self")).toBe(true);
    expect(rhythmEnabled("female", null)).toBe(false);
    expect(rhythmEnabled("female", "off")).toBe(false);
    expect(rhythmEnabled("male", "on")).toBe(false);
  });
});

describe("профиль и онбординг", () => {
  it("валидные поля попадают в patch", () => {
    const { patch, errors } = parseProfilePatch({
      name: "  дмитрий ",
      gender: "male",
      intent: "other",
      intentCustom: " устаю от учёбы ",
      behaviors: ["sleep", "coffee", "c:Музыка"],
      cycle: "later",
      uiPrefs: { font: "kniga", size: 108, sky: "sc-night", contrast: true, junk: 1 },
    });
    expect(errors).toEqual([]);
    expect(patch).toEqual({
      name: "дмитрий",
      gender: "male",
      intent: "other",
      intent_custom: "устаю от учёбы",
      behaviors: ["sleep", "coffee", "c:Музыка"],
      cycle: null,
      ui_prefs: { font: "kniga", size: 108, sky: "sc-night", contrast: true },
    });
  });
  it("ошибки называются по полю", () => {
    const { errors } = parseProfilePatch({ gender: "neutral", intent: "x", behaviors: ["sleep"], cycle: 1 });
    expect(errors.sort()).toEqual(["behaviors", "cycle", "gender", "intent"]);
  });
  it("настройки вида отбрасывают неизвестное", () => {
    expect(parseUiPrefs({ size: 50, font: "comic" })).toEqual({});
    expect(parseUiPrefs("x")).toBeNull();
    expect(parseUiPrefs({ weight: 500 })).toEqual({ weight: 500 });
    expect(parseUiPrefs({ weight: 900 })).toEqual({});
  });
});

describe("пробежка", () => {
  it("интенсивность из оценки усилия", () => {
    const r = parseRun({ date: "2026-10-01", distanceKm: 5.026, durationMin: 27.6, ratings: { effort: 8, legs: 11 } }, NOW);
    expect(r).toMatchObject({ distance_km: 5.03, duration_min: 28, intensity: "hard", ratings: { effort: 8 } });
  });
  it("без оценок лёгкая, мусор отклоняется", () => {
    expect(parseRun({ date: "2026-10-01", distanceKm: 3, durationMin: 20 }, NOW)?.intensity).toBe("easy");
    expect(parseRun({ date: "2026-10-09", distanceKm: 3, durationMin: 20 }, NOW)).toBeNull();
    expect(parseRun({ date: "2026-10-01", distanceKm: 0, durationMin: 20 }, NOW)).toBeNull();
  });
});

describe("запись дневника", () => {
  it("пустой текст отклоняется, дата клиента принимается в пределах суток", () => {
    expect(parseDiaryEntry({ text: "   " }, NOW)).toBeNull();
    expect(parseDiaryEntry({ text: "Бежала легко", date: "2026-10-02", tags: ["sleep"] }, NOW)).toEqual({
      text: "Бежала легко",
      date: "2026-10-02",
      tags: ["sleep"],
    });
    expect(parseDiaryEntry({ text: "x", date: "2025-01-01" }, NOW)?.date).toBe("2026-10-01");
  });
});
