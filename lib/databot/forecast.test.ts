import { describe, expect, it } from "vitest";
import type { DynamicsPoint } from "../team/history";
import { FORECAST_MAX_RUNS, FORECAST_MIN_SIGNUPS, forecast, forecastText, type Forecast } from "./forecast";

// Точка прошлого забега: по умолчанию запись к этому дню уже шла.
const pt = (atSameLead: number, final: number, opened = true, date = "2026-09-19"): DynamicsPoint => ({
  date,
  atSameLead,
  final,
  opened,
});

const run = (current: number, previous: DynamicsPoint[], daysBefore: number | null = 3) =>
  forecast({ daysBefore, current, previous });

describe("forecast: когда прогноза нет", () => {
  it("забег прошёл → past, строки нет вовсе", () => {
    const f = run(23, [pt(12, 20), pt(16, 21)], null);
    expect(f).toEqual({ kind: "none", reason: "past" });
    expect(forecastText(f, "в Лужниках")).toBeNull();
  });

  it("старт сегодня → start_today", () => {
    const f = run(23, [pt(12, 20), pt(16, 21)], 0);
    expect(f).toEqual({ kind: "none", reason: "start_today" });
    expect(forecastText(f, "в Лужниках")).toBe("Прогноза нет: старт сегодня");
  });

  it("прошлых забегов нет → no_comparable", () => {
    const f = run(23, []);
    expect(f).toEqual({ kind: "none", reason: "no_comparable" });
    expect(forecastText(f, "в Лужниках")).toBe(
      "Прогноза нет: не с чем сравнить — раньше на этой точке к этому дню запись не шла",
    );
  });

  it("все прошлые отфильтрованы (не открыты или меньше трёх) → no_comparable", () => {
    expect(run(23, [pt(10, 30, false), pt(2, 20), pt(0, 15, false)])).toEqual({
      kind: "none",
      reason: "no_comparable",
    });
  });

  it("сравнимых два, но у текущего меньше трёх заявок → too_few", () => {
    const f = run(FORECAST_MIN_SIGNUPS - 1, [pt(12, 20), pt(16, 21)]);
    expect(f).toEqual({ kind: "none", reason: "too_few" });
    expect(forecastText(f, "в Лужниках")).toBe("Прогноза нет: пока меньше трёх заявок");
  });

  it("при одном сравнимом забеге прогноз не строится", () => {
    const f = run(23, [pt(10, 16)]);
    expect(f.kind).toBe("single");
    expect(forecastText(f, "в Лужниках")).toBe(
      "Сравнимый забег только один: к старту заявок тогда стало в 1,6 раза больше. Прогнозом это не считаю",
    );
    // Ни чисел прогноза, ни явки в тексте нет.
    expect(forecastText(f, "в Лужниках")).not.toMatch(/Прогноз итога|явк|дош/);
  });

  it("один сравнимый — single, даже если у текущего меньше трёх", () => {
    expect(run(1, [pt(10, 16)])).toEqual({ kind: "single", ratio: 1.6 });
  });
});

describe("forecast: фильтр прошлых забегов", () => {
  it("выкидывает opened=false и atSameLead<3, дальше берёт первые три", () => {
    // После фильтра остаются 4: k = 2, 1.5, 1.25, 10. Четвёртый (самый старый) не берётся.
    const f = run(4, [
      pt(4, 8),
      pt(20, 100, false),
      pt(4, 6),
      pt(2, 50),
      pt(4, 5),
      pt(4, 40),
    ]);
    expect(f).toEqual({ kind: "range", low: 5, point: 6, high: 8, basedOn: FORECAST_MAX_RUNS });
  });

  it("atSameLead ровно три годится", () => {
    expect(run(23, [pt(3, 6)])).toEqual({ kind: "single", ratio: 2 });
  });
});

describe("forecast: диапазон", () => {
  it("пример из ТЗ: 23 заявки, два прошлых → 30–38", () => {
    // k = 21/16 = 1,3125 и 20/12 ≈ 1,667: 23×k → 30,19 и 38,33.
    const f = run(23, [pt(12, 20), pt(16, 21)]);
    expect(f).toEqual({ kind: "range", low: 30, point: 34, high: 38, basedOn: 2 });
    expect(forecastText(f, "в Лужниках")).toBe(
      "Прогноз итога: 30–38 заявок (по двум прошлым забегам в Лужниках за столько же дней до старта)",
    );
  });

  it("медиана при двух — среднее k", () => {
    // k = 1,25 и 1,5 → медиана 1,375; 4 × 1,375 = 5,5 → 6.
    expect(run(4, [pt(4, 5), pt(4, 6)])).toEqual({ kind: "range", low: 5, point: 6, high: 6, basedOn: 2 });
  });

  it("медиана при трёх — средний k, а не среднее", () => {
    // k = 1, 1,25, 3: медиана 1,25 → 5; среднее дало бы 7.
    const f = run(4, [pt(4, 12), pt(4, 4), pt(4, 5)]);
    expect(f).toEqual({ kind: "range", low: 4, point: 5, high: 12, basedOn: 3 });
    expect(forecastText(f, "на Усачёва")).toBe(
      "Прогноз итога: 4–12 заявок (по трём прошлым забегам на Усачёва за столько же дней до старта)",
    );
  });

  it("округление: x,5 вверх", () => {
    // 6 × 1,25 = 7,5 → 8; 6 × 1,5 = 9; 6 × 1,75 = 10,5 → 11.
    expect(run(6, [pt(4, 5), pt(4, 7)])).toEqual({ kind: "range", low: 8, point: 9, high: 11, basedOn: 2 });
  });

  it("low === high → одно число", () => {
    const f = run(10, [pt(4, 8), pt(5, 10)]);
    expect(f).toEqual({ kind: "range", low: 20, point: 20, high: 20, basedOn: 2 });
    expect(forecastText(f, "в Лужниках")).toBe(
      "Прогноз итога: 20 заявок (по двум прошлым забегам в Лужниках за столько же дней до старта)",
    );
  });

  it("форма слова — по последнему числу", () => {
    const text = (low: number, high: number) =>
      forecastText({ kind: "range", low, point: low, high, basedOn: 2 }, "в Лужниках");
    expect(text(19, 21)).toMatch(/^Прогноз итога: 19–21 заявка \(/);
    expect(text(20, 22)).toMatch(/^Прогноз итога: 20–22 заявки \(/);
    expect(text(21, 21)).toMatch(/^Прогноз итога: 21 заявка \(/);
    expect(text(1200, 1500)).toMatch(/^Прогноз итога: 1 200–1 500 заявок \(/);
  });

  it("where подставляется как есть", () => {
    const f = run(23, [pt(12, 20), pt(16, 21)]);
    expect(forecastText(f, "на Усачёва")).toContain("прошлым забегам на Усачёва за столько же");
  });

  it("про явку в тексте нигде ни слова", () => {
    const all: Forecast[] = [
      { kind: "range", low: 30, point: 34, high: 38, basedOn: 2 },
      { kind: "single", ratio: 1.6 },
      { kind: "none", reason: "start_today" },
      { kind: "none", reason: "no_comparable" },
      { kind: "none", reason: "too_few" },
    ];
    for (const f of all) expect(forecastText(f, "в Лужниках")).not.toMatch(/явк|дош|пришл/i);
  });
});

describe("forecastText: один сравнимый забег, k словами", () => {
  const growth = (ratio: number) =>
    forecastText({ kind: "single", ratio }, "в Лужниках")!
      .replace("Сравнимый забег только один: ", "")
      .replace(". Прогнозом это не считаю", "");

  it("один знак после запятой, запятая, лишний ноль убран", () => {
    expect(growth(1.6)).toBe("к старту заявок тогда стало в 1,6 раза больше");
    expect(growth(1.64)).toBe("к старту заявок тогда стало в 1,6 раза больше");
    expect(growth(2)).toBe("к старту заявок тогда стало в 2 раза больше");
    expect(growth(1.98)).toBe("к старту заявок тогда стало в 2 раза больше");
  });

  it("«раза» у 2–4 и у дробных, «раз» у 5+", () => {
    expect(growth(3)).toBe("к старту заявок тогда стало в 3 раза больше");
    expect(growth(4)).toBe("к старту заявок тогда стало в 4 раза больше");
    expect(growth(5)).toBe("к старту заявок тогда стало в 5 раз больше");
    expect(growth(2.5)).toBe("к старту заявок тогда стало в 2,5 раза больше");
    expect(growth(5.5)).toBe("к старту заявок тогда стало в 5,5 раза больше");
    expect(growth(21)).toBe("к старту заявок тогда стало в 21 раз больше");
    expect(growth(22)).toBe("к старту заявок тогда стало в 22 раза больше");
  });

  it("k ≤ 1 и почти 1 — без «в 1 раз»", () => {
    expect(growth(1)).toBe("к старту заявок тогда больше не стало");
    expect(growth(1.03)).toBe("к старту заявок тогда почти не прибавилось");
    expect(growth(0.8)).toBe("к старту заявок тогда стало меньше, чем было в этот день");
    expect(growth(1.1)).toBe("к старту заявок тогда стало в 1,1 раза больше");
  });
});
