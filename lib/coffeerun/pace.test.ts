import { describe, it, expect } from "vitest";
import { COFFEE_RUN_PACES, formatPace, normalizePace } from "./pace";

describe("темп кофе-рана", () => {
  it("набор темпов — тот, под который выписан констрейнт миграции 032", () => {
    expect(COFFEE_RUN_PACES.map((p) => p.value)).toEqual(["6:30", "7:00", "8:00"]);
  });

  it.each(COFFEE_RUN_PACES.map((p) => p.value))("%s проходит как есть", (value) => {
    expect(normalizePace(value)).toBe(value);
  });

  it("пробелы по краям — не повод терять выбор", () => {
    expect(normalizePace("  7:00 ")).toBe("7:00");
  });

  it.each([
    ["чужое значение", "5:00"],
    ["другой разделитель", "7.00"],
    ["пустая строка", ""],
    ["не строка", 700],
    ["ничего", undefined],
  ])("%s → null, заявка сохранится без темпа", (_case, raw) => {
    expect(normalizePace(raw)).toBeNull();
  });

  it("человеку показываем с единицами", () => {
    expect(formatPace("6:30")).toBe("6:30 мин/км");
  });
});
