import { describe, expect, it } from "vitest";
import { DueError, extractDue, formatDue, parseDue } from "./assigned-due";

// Четверг, 01.10.2026, 12:00 МСК.
const NOW = new Date("2026-10-01T09:00:00Z");
const msk = (local: string) => new Date(`${local}+03:00`).toISOString();
const due = (text: string, now = NOW) => extractDue(text, now).due?.toISOString() ?? null;

describe("extractDue", () => {
  it("без «до» в конце — срока нет, текст не трогаем", () => {
    expect(extractDue("Перенести 03.10 на 05.10", NOW)).toEqual({ what: "Перенести 03.10 на 05.10", due: null });
    expect(extractDue("Дойти до пятницы и подумать", NOW).due).toBeNull();
  });

  it("дни недели: ближайший, сегодняшний — если срок впереди", () => {
    expect(extractDue("Макет до пт 18:00", NOW)).toEqual({ what: "Макет", due: new Date(msk("2026-10-02T18:00")) });
    expect(due("Макет до пятницы")).toBe(msk("2026-10-02T23:59"));
    expect(due("Макет до понедельника в 10:00")).toBe(msk("2026-10-05T10:00"));
    expect(due("Макет до чт")).toBe(msk("2026-10-01T23:59"));
    // Четверг 11:00 уже прошёл — следующий четверг.
    expect(due("Макет до чт 11:00")).toBe(msk("2026-10-08T11:00"));
  });

  it("относительные дни и одно время", () => {
    expect(due("Текст до завтра")).toBe(msk("2026-10-02T23:59"));
    expect(due("Текст до послезавтра 9:30")).toBe(msk("2026-10-03T09:30"));
    expect(due("Текст до сегодня 15:00")).toBe(msk("2026-10-01T15:00"));
    expect(due("Текст до 18:00")).toBe(msk("2026-10-01T18:00"));
  });

  it("даты: текущий год, явный год, декабрь → январь", () => {
    expect(due("Отчёт до 03.10")).toBe(msk("2026-10-03T23:59"));
    expect(due("Отчёт до 03.10.2027 12:00")).toBe(msk("2027-10-03T12:00"));
    expect(due("Отчёт до 3.1.27")).toBe(msk("2027-01-03T23:59"));
    expect(due("Отчёт до 10.01", new Date("2026-12-20T09:00:00Z"))).toBe(msk("2027-01-10T23:59"));
  });

  it("разделители перед «до» и точка в конце", () => {
    expect(extractDue("Макет — до пт.", NOW).what).toBe("Макет");
    expect(extractDue("Макет, до 03.10", NOW).what).toBe("Макет");
  });

  it("прошедший срок, несуществующая дата и время — ошибка, а не задача без срока", () => {
    expect(() => extractDue("Макет до 30.09", NOW)).toThrow("Срок уже прошёл");
    expect(() => extractDue("Макет до 11:00", NOW)).toThrow(DueError);
    expect(() => extractDue("Макет до 31.02", NOW)).toThrow("Нет такой даты");
    expect(() => extractDue("Макет до пт 25:00", NOW)).toThrow(DueError);
  });
});

describe("parseDue", () => {
  it("принимает выражение без «до»", () => {
    expect(parseDue("пт 18:00", NOW).toISOString()).toBe(msk("2026-10-02T18:00"));
    expect(() => parseDue("когда-нибудь", NOW)).toThrow(DueError);
  });
});

describe("formatDue", () => {
  it("день недели и дата; время — только если не конец дня", () => {
    expect(formatDue(msk("2026-10-02T18:00"))).toBe("пт 02.10, 18:00");
    expect(formatDue(msk("2026-10-04T23:59"))).toBe("вс 04.10");
  });
});
