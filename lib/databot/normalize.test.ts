import { describe, expect, it } from "vitest";
import { normalizeText } from "./normalize";

describe("normalizeText", () => {
  it("нижний регистр, «ё» → «е», без пунктуации", () => {
    expect(normalizeText("Сколько пришло из Инсты за неделю?")).toBe("сколько пришло из инсты за неделю");
    expect(normalizeText("Ёлки, ЁЖ! Всё")).toBe("елки еж все");
    expect(normalizeText("«Строка цифр»")).toBe("строка цифр");
    expect(normalizeText("кто ведёт 10.10?!")).toBe("кто ведет 10.10");
  });

  it("пробелы схлопнуты и обрезаны, знаки не склеивают слова", () => {
    expect(normalizeText("  много   пробелов \n\t тут  ")).toBe("много пробелов тут");
    expect(normalizeText("привет,лужники")).toBe("привет лужники");
    expect(normalizeText("🔥лужники🔥 суббота")).toBe("лужники суббота");
    expect(normalizeText("")).toBe("");
    expect(normalizeText(" ?! ")).toBe("");
  });

  it("точка внутри даты остаётся, в конце фразы — уходит", () => {
    expect(normalizeText("на 03.10")).toBe("на 03.10");
    expect(normalizeText("на 3.10.")).toBe("на 3.10");
    expect(normalizeText("с 01.10 по 07.10.")).toBe("с 01.10 по 07.10");
    expect(normalizeText("03.10.2026")).toBe("03.10.2026");
    expect(normalizeText(".5 и 5.")).toBe("5 и 5");
  });

  it("дефис внутри кода и слова остаётся, тире между словами — уходит", () => {
    expect(normalizeText("переходы по IGST-0310!")).toBe("переходы по igst-0310");
    expect(normalizeText("заявки на кофе-ран")).toBe("заявки на кофе-ран");
    expect(normalizeText("лужники - суббота")).toBe("лужники суббота");
    expect(normalizeText("-5 и 5-")).toBe("5 и 5");
    expect(normalizeText("a.-b")).toBe("a b");
  });

  it("все виды тире сводятся к дефису", () => {
    expect(normalizeText("01.10–07.10")).toBe("01.10-07.10");
    expect(normalizeText("01.10—07.10")).toBe("01.10-07.10");
    expect(normalizeText("01.10−07.10")).toBe("01.10-07.10");
    expect(normalizeText("01.10 – 07.10")).toBe("01.10 07.10");
  });

  it("знаки ударения убраны, составная «й» собрана", () => {
    expect(normalizeText("суббо́та")).toBe("суббота");
    expect(normalizeText("ближайший")).toBe("ближайший");
    expect(normalizeText("ёлка")).toBe("елка");
  });
});
