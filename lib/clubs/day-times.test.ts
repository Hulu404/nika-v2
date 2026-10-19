import { describe, it, expect } from "vitest";
import { parseDayTimes, type DayTimesOptions } from "./day-times";
import { YOGA } from "../../test/club-survey-row";

/**
 * Разбор ответа о времени, где человек сам называет дни: «чт с 19 до 21,
 * сб с 11 до 14». Дни недели — JS getDay: Вс=0, Пн=1 … Сб=6.
 */

const MON = 1;
const TUE = 2;
const WED = 3;
const THU = 4;
const FRI = 5;
const SAT = 6;
const SUN = 0;

function opts(chosen: number[], uncovered: number[] = chosen): DayTimesOptions {
  return { survey: YOGA, chosen, uncovered };
}

const range = (from: string, to: string) => ({ from, to });

describe("ответ без дней — время на всю группу, как раньше", () => {
  it.each([
    ["с 19 до 21", range("19:00", "21:00")],
    ["19-21", range("19:00", "21:00")],
    ["вечером", range("18:00", "22:00")],
  ])("«%s»", (raw, time) => {
    expect(parseDayTimes(raw, opts([THU, FRI]))).toEqual({ ok: true, kind: "group", time });
  });

  it.each(["любое время", "в любое", "весь день", "без разницы", "когда угодно"])("«%s» — любое время", (raw) => {
    expect(parseDayTimes(raw, opts([THU]))).toEqual({ ok: true, kind: "group", time: { any: true } });
  });

  it("ошибки разбора времени — те же, что у parseTimeRange", () => {
    expect(parseDayTimes("с 19 до 19:30", opts([THU]))).toEqual({ ok: false, error: "short" });
    expect(parseDayTimes("как получится", opts([THU]))).toEqual({ ok: false, error: "unparsed" });
  });
});

describe("разное время по дням", () => {
  it.each<[string, Record<number, ReturnType<typeof range> | { any: true }>]>([
    ["чт с 19 до 21, пт с 18 до 20", { [THU]: range("19:00", "21:00"), [FRI]: range("18:00", "20:00") }],
    ["Чт 19-21; пт 18–20", { [THU]: range("19:00", "21:00"), [FRI]: range("18:00", "20:00") }],
    ["в четверг с 19 до 21, а в пятницу после 18", { [THU]: range("19:00", "21:00"), [FRI]: range("18:00", "21:00") }],
    ["четверг: 19:00-21:00\nпятница: 18:30-20:30", { [THU]: range("19:00", "21:00"), [FRI]: range("18:30", "20:30") }],
    ["в чт вечером, в пт в любое время", { [THU]: range("18:00", "22:00"), [FRI]: { any: true } }],
    ["29.10 с 19 до 21, 30.10 с 18 до 20", { [THU]: range("19:00", "21:00"), [FRI]: range("18:00", "20:00") }],
    ["29 октября с 19 до 21, 30 октября с 18 до 20", { [THU]: range("19:00", "21:00"), [FRI]: range("18:00", "20:00") }],
  ])("«%s»", (raw, times) => {
    expect(parseDayTimes(raw, opts([THU, FRI]))).toEqual({ ok: true, kind: "days", times });
  });

  it("время перед днём: «с 19 до 21 в четверг, с 18 до 20 в пятницу»", () => {
    expect(parseDayTimes("с 19 до 21 в четверг, с 18 до 20 в пятницу", opts([THU, FRI]))).toEqual({
      ok: true,
      kind: "days",
      times: { [THU]: range("19:00", "21:00"), [FRI]: range("18:00", "20:00") },
    });
  });

  it("сразу будни и выходные: «чт с 19 до 21, сб с 11 до 14»", () => {
    expect(parseDayTimes("чт с 19 до 21, сб с 11 до 14", opts([THU, SAT]))).toEqual({
      ok: true,
      kind: "days",
      times: { [THU]: range("19:00", "21:00"), [SAT]: range("11:00", "14:00") },
    });
  });

  it("несколько дней через «и» и запятую — одно время на всех", () => {
    expect(parseDayTimes("чт и пт с 19 до 21, сб с 11", opts([THU, FRI, SAT]))).toEqual({
      ok: true,
      kind: "days",
      times: { [THU]: range("19:00", "21:00"), [FRI]: range("19:00", "21:00"), [SAT]: range("11:00", "14:00") },
    });
  });

  it("промежуток дней: «пн-ср 19-21, пт 18-20» и «с пн по ср»", () => {
    const want = {
      ok: true,
      kind: "days",
      times: {
        [MON]: range("19:00", "21:00"),
        [TUE]: range("19:00", "21:00"),
        [WED]: range("19:00", "21:00"),
        [FRI]: range("18:00", "20:00"),
      },
    };
    const chosen = [MON, TUE, WED, FRI];
    expect(parseDayTimes("пн-ср 19-21, пт 18-20", opts(chosen))).toEqual(want);
    expect(parseDayTimes("с пн по ср с 19 до 21, в пт с 18 до 20", opts(chosen))).toEqual(want);
  });

  it("«по будням …, в выходные …»", () => {
    expect(parseDayTimes("по будням вечером, в выходные с 11 до 14", opts([THU, FRI, SAT, SUN]))).toEqual({
      ok: true,
      kind: "days",
      times: {
        [THU]: range("18:00", "22:00"),
        [FRI]: range("18:00", "22:00"),
        [SAT]: range("11:00", "14:00"),
        [SUN]: range("11:00", "14:00"),
      },
    });
  });

  it("«в остальные дни» — невыбранные этим ответом и ещё без времени", () => {
    expect(parseDayTimes("чт с 19 до 21, в остальные дни с 18 до 20", opts([WED, THU, FRI], [WED, THU]))).toEqual({
      ok: true,
      kind: "days",
      times: { [THU]: range("19:00", "21:00"), [WED]: range("18:00", "20:00") },
    });
  });

  it("невыбранные дни пропускаем, если есть выбранные", () => {
    expect(parseDayTimes("пн с 19 до 21, чт с 18 до 20", opts([THU]))).toEqual({
      ok: true,
      kind: "days",
      times: { [THU]: range("18:00", "20:00") },
    });
  });

  it("только невыбранные дни — other_days", () => {
    expect(parseDayTimes("пн с 19 до 21", opts([THU, SAT]))).toEqual({ ok: false, error: "other_days" });
  });

  it("день без времени или время одного дня неразборчиво — ошибка всего ответа", () => {
    expect(parseDayTimes("чт с 19 до 21, пт как получится", opts([THU, FRI]))).toEqual({ ok: false, error: "unparsed" });
    expect(parseDayTimes("чт с 19 до 19:30, пт с 18 до 20", opts([THU, FRI]))).toEqual({ ok: false, error: "short" });
  });

  it("дни и время вперемешку без пары — unparsed", () => {
    expect(parseDayTimes("19-21 чт, пт 18-20", opts([THU, FRI]))).toEqual({ ok: false, error: "unparsed" });
  });

  it("«вс» и «все» не путаем; «с» перед временем — не день", () => {
    expect(parseDayTimes("вс с 12 до 15", opts([SUN]))).toEqual({
      ok: true,
      kind: "days",
      times: { [SUN]: range("12:00", "15:00") },
    });
    expect(parseDayTimes("все дни с 19 до 21", opts([THU, FRI]))).toEqual({
      ok: true,
      kind: "days",
      times: { [THU]: range("19:00", "21:00"), [FRI]: range("19:00", "21:00") },
    });
  });
});
