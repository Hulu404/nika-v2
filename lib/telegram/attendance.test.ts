import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_SINCE,
  attendanceLine,
  clubSessionAttended,
  coffeeRunAttended,
  countAttendance,
  datesNeedingRollcallCheck,
  type ClubAttendanceRow,
  type CoffeeRunAttendanceRow,
} from "./attendance";

const TODAY = "2026-12-01";
const AFTER = "2026-11-15"; // после ATTENDANCE_SINCE и до TODAY
const BEFORE = "2026-11-01";
const NONE = new Set<string>();

const run = (patch: Partial<CoffeeRunAttendanceRow> = {}): CoffeeRunAttendanceRow => ({
  spot: "cave",
  run_date: AFTER,
  confirmed_at: "2026-11-10T10:00:00Z",
  rollcall_answer: null,
  ...patch,
});

const order = (patch: Partial<ClubAttendanceRow> = {}): ClubAttendanceRow => ({
  club: "stretch",
  event_date: "2026-11-08",
  event_time: "12:00",
  payment_status: "paid",
  amount_rub: 1000,
  confirmed_at: null,
  is_gift: false,
  ...patch,
});

describe("кофе-ран: посещение", () => {
  it("даты в тесте стоят по разные стороны ATTENDANCE_SINCE", () => {
    expect(BEFORE < ATTENDANCE_SINCE && ATTENDANCE_SINCE <= AFTER).toBe(true);
  });

  it("до выкладки: подтверждённая заявка на прошедший забег = был", () => {
    expect(coffeeRunAttended(run({ run_date: BEFORE }), TODAY, NONE)).toBe(true);
  });

  it("неподтверждённая заявка не в счёт", () => {
    expect(coffeeRunAttended(run({ run_date: BEFORE, confirmed_at: null }), TODAY, NONE)).toBe(false);
  });

  it("после выкладки и перекличка была: в счёт только «да»", () => {
    const held = new Set([AFTER]);
    expect(coffeeRunAttended(run({ rollcall_answer: "yes" }), TODAY, held)).toBe(true);
    expect(coffeeRunAttended(run({ rollcall_answer: "no" }), TODAY, held)).toBe(false);
    expect(coffeeRunAttended(run({ rollcall_answer: null }), TODAY, held)).toBe(false);
  });

  it("после выкладки, но переклички на забег не было: по подтверждённой заявке", () => {
    expect(coffeeRunAttended(run(), TODAY, NONE)).toBe(true);
  });

  it("сегодняшний и будущие забеги ещё не посещение", () => {
    expect(coffeeRunAttended(run({ run_date: TODAY, rollcall_answer: "yes" }), TODAY, new Set([TODAY]))).toBe(false);
    expect(coffeeRunAttended(run({ run_date: "2027-01-01" }), TODAY, NONE)).toBe(false);
  });

  it("для проверки переклички нужны только подтверждённые прошедшие забеги после выкладки", () => {
    const rows = [run({ run_date: BEFORE }), run(), run({ run_date: AFTER }), run({ run_date: TODAY }), run({ run_date: "2026-11-22", confirmed_at: null })];
    expect(datesNeedingRollcallCheck(rows, TODAY)).toEqual([AFTER]);
  });
});

describe("клуб: посещение", () => {
  it("оплаченный заказ на прошедшее занятие — был", () => {
    expect(clubSessionAttended(order(), TODAY)).toBe(true);
  });

  it("возвраты, отмены, истёкшие холды и лист ожидания — нет", () => {
    for (const status of ["refunded", "refunded_overbooked", "canceled", "expired", "waitlist", "pending", "pending_payment"]) {
      expect(clubSessionAttended(order({ payment_status: status }), TODAY), status).toBe(false);
    }
  });

  it("бесплатная встреча считается, только если заявку подтвердили в боте", () => {
    expect(clubSessionAttended(order({ club: "read", amount_rub: 0, confirmed_at: null }), TODAY)).toBe(false);
    expect(clubSessionAttended(order({ club: "read", amount_rub: 0, confirmed_at: "2026-11-11T10:00:00Z" }), TODAY)).toBe(true);
  });

  it("будущее занятие и подарок — не посещение покупателя", () => {
    expect(clubSessionAttended(order({ event_date: "2027-01-01" }), TODAY)).toBe(false);
    expect(clubSessionAttended(order({ is_gift: true }), TODAY)).toBe(false);
  });
});

describe("счётчик", () => {
  it("один заказ на три билета и докупка на то же занятие — одно посещение", () => {
    const count = countAttendance([], [order(), order({ amount_rub: 3000 })], TODAY, NONE);
    expect(count).toEqual({ coffeeRuns: 0, clubSessions: 1 });
  });

  it("повторная заявка на тот же забег — один забег", () => {
    const count = countAttendance([run({ run_date: BEFORE }), run({ run_date: BEFORE }), run({ run_date: "2026-10-18" })], [], TODAY, NONE);
    expect(count.coffeeRuns).toBe(2);
  });

  it("строка: без нулей, а при нулях её нет", () => {
    expect(attendanceLine({ coffeeRuns: 5, clubSessions: 2 })).toBe("Ты был(а) с нами: кофе-ранов 5, занятий клуба 2");
    expect(attendanceLine({ coffeeRuns: 0, clubSessions: 2 })).toBe("Ты был(а) с нами: занятий клуба 2");
    expect(attendanceLine({ coffeeRuns: 3, clubSessions: 0 })).toBe("Ты был(а) с нами: кофе-ранов 3");
    expect(attendanceLine({ coffeeRuns: 0, clubSessions: 0 })).toBeNull();
  });
});
