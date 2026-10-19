import { describe, it, expect } from "vitest";
import { fromMinutes, parseTimeRange, toMinutes, type TimeRangeResult } from "./time-range";

const OPTS = { sessionMinutes: 60, dayFrom: "07:00", dayTo: "23:00" };

const ok = (from: string, to: string): TimeRangeResult => ({ ok: true, from, to });
const err = (error: "unparsed" | "order" | "short" | "out_of_bounds"): TimeRangeResult => ({ ok: false, error });

describe("parseTimeRange — формы из спецификации", () => {
  it.each<[string, TimeRangeResult]>([
    ["с 19 до 21", ok("19:00", "21:00")],
    ["19-21", ok("19:00", "21:00")],
    ["19–21", ok("19:00", "21:00")],
    ["19:00-21:00", ok("19:00", "21:00")],
    ["18.30 21", ok("18:30", "21:00")],
    ["с 18:30 до 21", ok("18:30", "21:00")],
    ["в 19", ok("19:00", "20:00")],
    ["после 19", ok("19:00", "22:00")],
    ["до 10", ok("07:00", "10:00")],
    ["утром", ok("08:00", "11:00")],
    ["днём", ok("12:00", "16:00")],
    ["днем", ok("12:00", "16:00")],
    ["вечером", ok("18:00", "22:00")],
    ["с 7 до 9 вечера", ok("19:00", "21:00")],
    ["с 6 до 8", ok("18:00", "20:00")],
  ])("«%s»", (input, expected) => {
    expect(parseTimeRange(input, OPTS)).toEqual(expected);
  });
});

describe("parseTimeRange — ошибки", () => {
  it.each<[string, TimeRangeResult]>([
    ["21-19", err("order")],
    ["19-19:30", err("short")],
    ["с 5 утра до 6", err("out_of_bounds")],
    ["абв", err("unparsed")],
    ["", err("unparsed")],
    ["   ", err("unparsed")],
    ["1900", err("unparsed")],
    ["28.10", err("unparsed")],
    ["с 19 до 20 или с 21 до 22", err("unparsed")],
    ["утром или вечером", err("unparsed")],
    ["в 22:30", err("out_of_bounds")],
    ["после 22:30", err("short")],
  ])("«%s»", (input, expected) => {
    expect(parseTimeRange(input, OPTS)).toEqual(expected);
  });
});

describe("parseTimeRange — пробелы, регистр, тире", () => {
  it.each<[string, TimeRangeResult]>([
    ["   С 19   ДО 21  ", ok("19:00", "21:00")],
    ["ВЕЧЕРОМ", ok("18:00", "22:00")],
    ["Днём", ok("12:00", "16:00")],
    ["19—21", ok("19:00", "21:00")],
    ["19 - 21", ok("19:00", "21:00")],
    ["с 19 до 21, лучше пораньше", ok("19:00", "21:00")],
    ["с 7 до 9", ok("07:00", "09:00")],
    ["с 5 до 7 утра", err("out_of_bounds")],
    ["с 5 до 7", ok("17:00", "19:00")],
    ["с 6 до 8 утра", err("out_of_bounds")],
    ["с 10 до 8", err("order")],
  ])("«%s»", (input, expected) => {
    expect(parseTimeRange(input, OPTS)).toEqual(expected);
  });
});

describe("минуты ↔ HH:MM", () => {
  it("переводит туда и обратно", () => {
    expect(toMinutes("18:30")).toBe(1110);
    expect(fromMinutes(1110)).toBe("18:30");
    expect(fromMinutes(toMinutes("07:05"))).toBe("07:05");
  });

  it("длительность занятия — параметр", () => {
    expect(parseTimeRange("в 19", { ...OPTS, sessionMinutes: 90 })).toEqual(ok("19:00", "20:30"));
    expect(parseTimeRange("19-20", { ...OPTS, sessionMinutes: 90 })).toEqual(err("short"));
  });
});
