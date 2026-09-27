import { describe, expect, it } from "vitest";
import { cb } from "./callback";
import {
  MAX_DETAIL_LINES,
  MAX_MESSAGE_CHARS,
  MORE_BUTTON,
  answerText,
  dataAtLine,
  pageScreen,
  paginate,
  withComparison,
} from "./copy";

/**
 * Каркас ответа по ТЗ 4.10. Примеры ответов разделов воспроизводят их
 * промты (5, 12, 13); здесь — сами правила каркаса.
 */

const AT = new Date("2026-09-27T11:32:00Z"); // 14:32 МСК

describe("каркас ответа", () => {
  it("первая строка — ответ, последняя — «Данные на ЧЧ:ММ МСК»", () => {
    const text = answerText({ headline: "На сб 03.10 в Лужниках 23 заявки", details: ["Новых 15"], at: AT });
    const lines = text.split("\n");
    expect(lines[0]).toBe("На сб 03.10 в Лужниках 23 заявки");
    expect(lines.at(-1)).toBe("Данные на 14:32 МСК");
    expect(dataAtLine(AT)).toBe("Данные на 14:32 МСК");
  });

  it("строка о слепой зоне — перед строкой времени", () => {
    const lines = answerText({
      headline: "Про сейчас 37",
      details: ["Оплат 9"],
      blindSpot: "Оплаты по СБП в базе не ведутся",
      at: AT,
    }).split("\n");
    expect(lines).toEqual(["Про сейчас 37", "Оплат 9", "Оплаты по СБП в базе не ведутся", "Данные на 14:32 МСК"]);
  });

  it("восемь строк подробностей можно, девять — ошибка в коде раздела", () => {
    const eight = Array.from({ length: MAX_DETAIL_LINES }, (_, i) => `строка ${i}`);
    expect(answerText({ headline: "h", details: eight, at: AT }).split("\n")).toHaveLength(10);
    expect(() => answerText({ headline: "h", details: [...eight, "лишняя"], at: AT })).toThrow(/не больше 8/);
  });

  it("сравнение всегда подписано", () => {
    expect(withComparison("214 переходов", "168", "неделей раньше")).toBe("214 переходов (неделей раньше 168)");
    expect(withComparison("214 переходов", null, "неделей раньше")).toBe("214 переходов");
  });
});

describe("страницы", () => {
  it("короткий текст — одна страница", () => {
    expect(paginate(["a", "b"])).toEqual(["a\nb"]);
    expect(paginate([])).toEqual([""]);
  });

  it("длинный — по строкам, каждая страница не длиннее 4096", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `${i}. ${"x".repeat(40)}`);
    const pages = paginate(lines);
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) expect(p.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    // Ничего не потерялось и не порвано посередине пункта.
    expect(pages.join("\n").split("\n")).toEqual(lines);
  });

  it("заголовок повторяется на каждой странице и влезает в лимит", () => {
    const header = "Персональные данные участников. Не пересылать";
    const pages = paginate(Array.from({ length: 50 }, (_, i) => `строка ${i}`), { max: 120, header });
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) {
      expect(p.startsWith(header + "\n")).toBe(true);
      expect(p.length).toBeLessThanOrEqual(120);
    }
  });

  it("строка длиннее страницы режется, а не роняет отправку", () => {
    const pages = paginate(["y".repeat(250)], { max: 100 });
    expect(pages).toHaveLength(3);
    for (const p of pages) expect(p.length).toBeLessThanOrEqual(100);
  });

  it("кнопка «Ещё» есть везде, кроме последней страницы", () => {
    const pages = ["p1", "p2", "p3"];
    const more = (n: number) => cb("run", "people", "luzhniki", "2026-10-03", n + 1);
    const first = pageScreen(pages, 0, more);
    expect(first.text).toBe("p1");
    expect(first.buttons).toEqual([[{ text: MORE_BUTTON, data: "d:run:people:luzhniki:2026-10-03:2" }]]);
    expect(pageScreen(pages, 2, more).buttons).toBeUndefined();
    // Номер страницы из старой кнопки за пределами — последняя, а не пустота.
    expect(pageScreen(pages, 9, more).text).toBe("p3");
  });
});
