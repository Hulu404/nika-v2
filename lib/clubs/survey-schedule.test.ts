import { describe, it, expect } from "vitest";
import { dayBefore, evePassOpen, inWindow, reminderDueForRow, reminderPass } from "./survey-schedule";
import { YOGA, consentedRow, surveyRow } from "../../test/club-survey-row";

/** МСК = UTC+3: «10:00 МСК» — это 07:00Z. */
const at = (iso: string) => new Date(iso);

describe("окно напоминания незавершившим (10:00–21:00 МСК, до 22.10 12:00)", () => {
  it.each([
    ["2026-10-21T06:59:00Z", false, "09:59 МСК — рано"],
    ["2026-10-21T07:00:00Z", true, "10:00 МСК — открыто"],
    ["2026-10-21T17:59:00Z", true, "20:59 МСК — ещё можно"],
    ["2026-10-21T18:00:00Z", false, "21:00 МСК — уже поздно"],
    ["2026-10-21T22:00:00Z", false, "01:00 МСК — ночь"],
    ["2026-10-22T08:59:00Z", true, "22.10 11:59 МСК — успеваем"],
    ["2026-10-22T09:00:00Z", false, "22.10 12:00 МСК — срок прошёл"],
    ["2026-10-22T12:00:00Z", false, "22.10 15:00 МСК — после срока, хоть и в окне"],
  ])("%s → %s (%s)", (iso, open) => {
    expect(reminderPass(YOGA, at(iso)).open).toBe(open);
  });

  it("askedBefore — ровно за 24 часа", () => {
    const pass = reminderPass(YOGA, at("2026-10-21T09:00:00Z"));
    expect(pass).toEqual({ open: true, askedBefore: at("2026-10-20T09:00:00Z") });
  });
});

describe("кому напоминать", () => {
  const asked = "2026-10-20T08:00:00.000Z";
  const row = consentedRow({ step: "days", asked_at: asked });

  it("через 23 часа — рано, через 24 и 25 — пора", () => {
    expect(reminderDueForRow(row, YOGA, at("2026-10-21T07:00:00Z"))).toBe(false);
    expect(reminderDueForRow(row, YOGA, at("2026-10-21T08:00:00Z"))).toBe(true);
    expect(reminderDueForRow(row, YOGA, at("2026-10-21T09:00:00Z"))).toBe(true);
  });

  it("без согласия, закончившим, уже напомненным, заблокировавшим и после итога — нет", () => {
    const later = at("2026-10-21T09:00:00Z");
    expect(reminderDueForRow(surveyRow({ step: "interest", asked_at: asked }), YOGA, later)).toBe(false);
    expect(reminderDueForRow({ ...row, step: "done" }, YOGA, later)).toBe(false);
    expect(reminderDueForRow({ ...row, step: "later_done" }, YOGA, later)).toBe(false);
    expect(reminderDueForRow({ ...row, reminded_at: asked }, YOGA, later)).toBe(false);
    expect(reminderDueForRow({ ...row, blocked_at: asked }, YOGA, later)).toBe(false);
    expect(reminderDueForRow({ ...row, result_id: 1 }, YOGA, later)).toBe(false);
  });
});

describe("напоминание накануне (18:00–21:00 МСК)", () => {
  const result = { meet_date: "2026-10-29" };

  it.each([
    ["2026-10-28T14:59:00Z", false, "28.10 17:59 — рано"],
    ["2026-10-28T15:00:00Z", true, "28.10 18:00 — пора"],
    ["2026-10-28T17:59:00Z", true, "28.10 20:59 — ещё можно"],
    ["2026-10-28T18:00:00Z", false, "28.10 21:00 — поздно"],
    ["2026-10-29T15:00:00Z", false, "в день встречи — уже нет"],
    ["2026-10-27T15:00:00Z", false, "за два дня — ещё нет"],
  ])("%s → %s (%s)", (iso, open) => {
    expect(evePassOpen(YOGA, result, at(iso))).toBe(open);
  });

  it("без итога — закрыто", () => {
    expect(evePassOpen(YOGA, null, at("2026-10-28T15:00:00Z"))).toBe(false);
  });

  it("день до — через границу месяца", () => {
    expect(dayBefore("2026-11-01")).toBe("2026-10-31");
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
  });

  it("inWindow — с началом, без конца", () => {
    expect(inWindow(18, { fromHour: 18, toHour: 21 })).toBe(true);
    expect(inWindow(21, { fromHour: 18, toHour: 21 })).toBe(false);
  });
});
