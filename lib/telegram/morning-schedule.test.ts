import { describe, it, expect } from "vitest";
import {
  parseHhmm,
  isPora,
  isNightHour,
  isQuiet,
  isPaused,
  MORNING_CRON_STEP_MIN,
} from "./morning-schedule";

describe("parseHhmm", () => {
  it("парсит HH:MM и HH:MM:SS", () => {
    expect(parseHhmm("08:00")).toBe(480);
    expect(parseHhmm("08:00:00")).toBe(480);
    expect(parseHhmm("23:45")).toBe(23 * 60 + 45);
  });
  it("мусор/пусто → 0", () => {
    expect(parseHhmm(null)).toBe(0);
    expect(parseHhmm("")).toBe(0);
    expect(parseHhmm("xx:yy")).toBe(0);
  });
});

describe("isPora — окно [morning_time, +шаг)", () => {
  it("в окне (начало и внутри), вне окна", () => {
    expect(isPora(480, "08:00")).toBe(true); // ровно 08:00
    expect(isPora(480 + MORNING_CRON_STEP_MIN - 1, "08:00")).toBe(true); // 08:14
    expect(isPora(480 + MORNING_CRON_STEP_MIN, "08:00")).toBe(false); // 08:15 — уже вне
    expect(isPora(479, "08:00")).toBe(false); // 07:59
    expect(isPora(600, "08:00")).toBe(false); // 10:00
  });
});

describe("isNightHour / isQuiet — защита ночи и тихие часы", () => {
  it("ночь 22:00–06:00 тихая всегда", () => {
    expect(isNightHour(22)).toBe(true);
    expect(isNightHour(3)).toBe(true);
    expect(isNightHour(5)).toBe(true);
    expect(isNightHour(6)).toBe(false);
    expect(isNightHour(8)).toBe(false);
  });

  it("тихо ночью даже при сдвинутом morning_time (защита)", () => {
    // Пользователь выставил morning_time=03:00 — окно совпало, но это ночь.
    expect(isQuiet(3, 3 * 60, null)).toBe(true);
  });

  it("днём без quiet_hours — не тихо", () => {
    expect(isQuiet(8, 8 * 60, null)).toBe(false);
  });

  it("пользовательские quiet_hours днём (обычный интервал)", () => {
    const qh = { start: "13:00", end: "15:00" };
    expect(isQuiet(13, 13 * 60 + 30, qh)).toBe(true);
    expect(isQuiet(12, 12 * 60, qh)).toBe(false);
    expect(isQuiet(15, 15 * 60, qh)).toBe(false); // конец не включительно
  });

  it("quiet_hours через полночь (start>end)", () => {
    const qh = { start: "22:00", end: "07:00" };
    expect(isQuiet(8, 6 * 60, qh)).toBe(true); // 06:00 — внутри (но и так ночь)
    expect(isQuiet(8, 8 * 60, qh)).toBe(false); // 08:00 — вне
  });
});

describe("isPaused — pause_until", () => {
  it("пусто → не на паузе", () => {
    expect(isPaused(null, "2026-07-21")).toBe(false);
    expect(isPaused(undefined, "2026-07-21")).toBe(false);
  });
  it("в прошлом → не на паузе", () => {
    expect(isPaused("2026-07-20", "2026-07-21")).toBe(false);
  });
  it("сегодня/в будущем → на паузе", () => {
    expect(isPaused("2026-07-21", "2026-07-21")).toBe(true);
    expect(isPaused("2026-07-25", "2026-07-21")).toBe(true);
  });
  it("принимает timestamp — берёт дату", () => {
    expect(isPaused("2026-07-25T00:00:00Z", "2026-07-21")).toBe(true);
  });
});
