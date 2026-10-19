import { describe, it, expect } from "vitest";
import {
  canAttend,
  chosenWeekdays,
  dayGroup,
  dayTime,
  uncoveredWeekdays,
  groupTime,
  groupsOfDays,
  groupsOfWeekdays,
  resultVariant,
  surveySummary,
  topSlots,
} from "./survey-slots";
import { toMinutes } from "./time-range";
import { YOGA, consentedRow, surveyRow } from "../../test/club-survey-row";

const WED = "2026-10-28";
const THU = "2026-10-29";
const FRI = "2026-10-30";
const SAT = "2026-10-31";

/** Пример из плана: А, Б, В придут, Г — позже. */
const A = consentedRow({ chat_id: 1, name: "А", step: "done", attend: "come", days: [THU, FRI], wd_from: "19:00", wd_to: "21:00" });
const B = consentedRow({
  chat_id: 2,
  name: "Б",
  step: "done",
  attend: "come",
  days: [THU, SAT],
  wd_from: "18:30",
  wd_to: "20:30",
  we_any: true,
});
const C = consentedRow({ chat_id: 3, name: "В", step: "done", attend: "come", days: [THU], wd_from: "19:00", wd_to: "22:00" });
const D = consentedRow({ chat_id: 4, name: "Г", step: "later_done", attend: "later", weekdays: [1, 3] });

describe("группы дней", () => {
  it("пн–пт — будни, сб–вс — выходные", () => {
    expect(YOGA.days.map((d) => dayGroup(d.date))).toEqual(["wd", "wd", "wd", "we", "we"]);
    expect(groupsOfDays([SAT, THU])).toEqual(["wd", "we"]);
    expect(groupsOfDays([SAT])).toEqual(["we"]);
    expect(groupsOfWeekdays([0, 6])).toEqual(["we"]);
    expect(groupsOfWeekdays([1, 6])).toEqual(["wd", "we"]);
    expect(groupsOfDays([])).toEqual([]);
  });

  it("groupTime различает промежуток, любое время, ответ текстом и пустоту", () => {
    expect(groupTime(B, "wd")).toEqual({ kind: "range", from: "18:30", to: "20:30" });
    expect(groupTime(B, "we")).toEqual({ kind: "any" });
    expect(groupTime(consentedRow({ wd_raw: "после работы" }), "wd")).toEqual({ kind: "raw", raw: "после работы" });
    expect(groupTime(consentedRow(), "we")).toEqual({ kind: "none" });
  });
});

describe("canAttend — совпадение по дню и промежутку", () => {
  const at = (hhmm: string) => toMinutes(hhmm);

  it("занятие целиком внутри промежутка, границы включительно", () => {
    expect(canAttend(B, THU, at("19:30"), 60)).toBe(true); // 19:30–20:30 ⊂ 18:30–20:30
    expect(canAttend(B, THU, at("18:30"), 60)).toBe(true);
    expect(canAttend(B, THU, at("20:00"), 60)).toBe(false); // кончится в 21:00
    expect(canAttend(B, THU, at("18:00"), 60)).toBe(false); // раньше начала
  });

  it("день, который человек не отметил, не считается", () => {
    expect(canAttend(C, FRI, at("19:00"), 60)).toBe(false);
    expect(canAttend(A, WED, at("19:00"), 60)).toBe(false);
  });

  it("«любое время» подходит на любой слот своей группы", () => {
    expect(canAttend(B, SAT, at("07:00"), 60)).toBe(true);
    expect(canAttend(B, SAT, at("22:00"), 60)).toBe(true);
  });

  it("промежуток короче занятия не вмещает ни одного слота", () => {
    const short = consentedRow({ attend: "come", days: [THU], wd_from: "19:00", wd_to: "19:30" });
    expect(canAttend(short, THU, at("19:00"), 60)).toBe(false);
  });

  it("ответ текстом и «позже» в счёт не идут", () => {
    const raw = consentedRow({ attend: "come", days: [THU], wd_raw: "после работы" });
    expect(canAttend(raw, THU, at("19:00"), 60)).toBe(false);
    expect(canAttend(D, THU, at("19:00"), 60)).toBe(false);
  });
});

describe("topSlots", () => {
  it("пример из плана: чт 19:00 и 19:30 — по трое, чт 20:00 — двое", () => {
    const top = topSlots([A, B, C, D], YOGA);
    expect(top.slice(0, 3)).toEqual([
      { date: THU, start: "19:00", count: 3 },
      { date: THU, start: "19:30", count: 3 },
      { date: THU, start: "20:00", count: 2 },
    ]);
    expect(top).toHaveLength(5);
  });

  it("при равенстве раньше день, затем раньше время", () => {
    const sat = consentedRow({ attend: "come", days: [SAT], we_from: "11:00", we_to: "12:00" });
    const wed = consentedRow({ attend: "come", days: [WED], wd_from: "20:00", wd_to: "21:00" });
    expect(topSlots([sat, wed], YOGA)).toEqual([
      { date: WED, start: "20:00", count: 1 },
      { date: SAT, start: "11:00", count: 1 },
    ]);
  });

  it("без ответов — пусто", () => {
    expect(topSlots([], YOGA)).toEqual([]);
    expect(topSlots([surveyRow(), D], YOGA)).toEqual([]);
  });

  it("последнее начало — когда занятие ещё кончается к концу дня", () => {
    const anyThu = consentedRow({ attend: "come", days: [THU], wd_any: true });
    const starts = topSlots([anyThu], YOGA, 100).map((s) => s.start);
    expect(starts[0]).toBe("07:00");
    expect(starts[starts.length - 1]).toBe("22:00");
    expect(starts).toHaveLength(31);
  });
});

describe("resultVariant", () => {
  const at = (meet_time: string, meet_date = THU) => ({ meet_date, meet_time });

  it("итог чт 19:30: А, Б, В — совпал, Г — нет", () => {
    expect([A, B, C, D].map((r) => resultVariant(r, at("19:30"), YOGA))).toEqual(["match", "match", "match", "nomatch"]);
  });

  it("итог чт 20:00: Б уже не помещается", () => {
    expect(resultVariant(B, at("20:00"), YOGA)).toBe("nomatch");
    expect(resultVariant(A, at("20:00"), YOGA)).toBe("match");
  });

  it("ответ текстом — всегда «не совпал»", () => {
    const raw = consentedRow({ attend: "come", days: [THU], wd_raw: "после работы" });
    expect(resultVariant(raw, at("19:30"), YOGA)).toBe("nomatch");
  });

  it("итог в выходной: «любое время» в выходные совпадает", () => {
    expect(resultVariant(B, at("11:00", SAT), YOGA)).toBe("match");
  });
});

describe("surveySummary", () => {
  it("раскладывает людей по шагам и считает дни", () => {
    const rows = [
      A,
      B,
      C,
      D,
      surveyRow({ chat_id: 5, step: "interest" }),
      surveyRow({ chat_id: 6, step: "skipped", source: "link" }),
      surveyRow({ chat_id: 7, step: "declined" }),
      consentedRow({ chat_id: 8, step: "days", attend: "come" }),
      surveyRow({ chat_id: 9, step: "interest", blocked_at: "2026-10-20T09:00:00Z" }),
      consentedRow({ chat_id: 10, step: "done", attend: "come", days: [FRI], wd_raw: "после работы" }),
    ];
    const s = surveySummary(rows, YOGA);

    expect(s).toMatchObject({
      asked: 10,
      byBroadcast: 9,
      byLink: 1,
      interested: 7,
      skipped: 1,
      declined: 1,
      coming: 4,
      later: 1,
      inProgress: 1,
      silent: 1,
      blocked: 1,
    });
    expect(s.perDay).toEqual([
      { date: WED, count: 0 },
      { date: THU, count: 3 },
      { date: FRI, count: 2 },
      { date: SAT, count: 1 },
      { date: "2026-11-01", count: 0 },
    ]);
    expect(s.rawAnswers).toEqual([{ row: rows[9], group: "wd", raw: "после работы" }]);
    expect(s.slots[0]).toEqual({ date: THU, start: "19:00", count: 3 });
  });

  it("пустой опрос", () => {
    const s = surveySummary([], YOGA);
    expect(s.asked).toBe(0);
    expect(s.slots).toEqual([]);
    expect(s.comingList).toEqual([]);
  });
});

describe("время по дням", () => {
  const row = consentedRow({
    attend: "come",
    days: [THU, FRI, SAT],
    wd_from: "18:00",
    wd_to: "22:00",
    day_times: { "5": { from: "10:00", to: "12:00" }, "6": { any: true } },
  });

  it("своё время дня важнее времени группы", () => {
    expect(canAttend(row, THU, toMinutes("19:00"), 60)).toBe(true);
    expect(canAttend(row, FRI, toMinutes("19:00"), 60)).toBe(false);
    expect(canAttend(row, FRI, toMinutes("10:30"), 60)).toBe(true);
    expect(canAttend(row, SAT, toMinutes("08:00"), 60)).toBe(true);
  });

  it("dayTime и дни без времени", () => {
    expect(dayTime(row, 5)).toEqual({ kind: "range", from: "10:00", to: "12:00" });
    expect(dayTime(row, 4)).toEqual({ kind: "range", from: "18:00", to: "22:00" });
    expect(chosenWeekdays(row)).toEqual([4, 5, 6]);
    expect(uncoveredWeekdays(row)).toEqual([]);
    expect(uncoveredWeekdays(consentedRow({ attend: "come", days: [THU, SAT], day_times: { "6": { any: true } } }))).toEqual([4]);
  });
});
