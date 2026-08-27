import { describe, it, expect } from "vitest";
import {
  COFFEE_RUNS,
  REMINDER_HOUR_MSK,
  dayBefore,
  nextRun,
  runDueForReminder,
  runWhenWhere,
} from "./run";

describe("nextRun — ближайший будущий забег", () => {
  it("забег остаётся будущим весь свой день по МСК", () => {
    const run = COFFEE_RUNS[0];
    // Утро дня старта: человек подтверждается по дороге — должен увидеть сегодня.
    expect(nextRun(new Date(`${run.date}T06:00:00+03:00`)).date).toBe(run.date);
    // Поздний вечер того же дня — всё ещё он.
    expect(nextRun(new Date(`${run.date}T23:00:00+03:00`)).date).toBe(run.date);
  });

  it("до забега возвращает его же", () => {
    const run = COFFEE_RUNS[0];
    expect(nextRun(new Date(`${run.date}T00:00:00+03:00`)).date).toBe(run.date);
  });

  it("когда будущих не осталось — отдаёт последний, а не падает", () => {
    const last = COFFEE_RUNS[COFFEE_RUNS.length - 1];
    expect(nextRun(new Date("2099-01-01T00:00:00+03:00")).date).toBe(last.date);
  });

  it("даты в списке отсортированы по возрастанию — на этом держится выбор", () => {
    const dates = COFFEE_RUNS.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
  });
});

describe("dayBefore — календарный день перед датой", () => {
  it("считает обычный день", () => {
    expect(dayBefore("2026-08-29")).toBe("2026-08-28");
  });

  it("переходит через границу месяца и года", () => {
    expect(dayBefore("2026-09-01")).toBe("2026-08-31");
    expect(dayBefore("2026-01-01")).toBe("2025-12-31");
    expect(dayBefore("2028-03-01")).toBe("2028-02-29"); // високосный
  });
});

describe("runDueForReminder — окно рассылки за сутки", () => {
  const run = COFFEE_RUNS[0];
  const eve = dayBefore(run.date);

  it("накануне в час рассылки — забег найден", () => {
    expect(runDueForReminder(eve, REMINDER_HOUR_MSK)?.date).toBe(run.date);
  });

  it("накануне, но слишком рано — молчим", () => {
    expect(runDueForReminder(eve, REMINDER_HOUR_MSK - 1)).toBeNull();
    expect(runDueForReminder(eve, 0)).toBeNull();
  });

  it("проспавший тик догоняет позже в тот же день, а не теряет рассылку", () => {
    expect(runDueForReminder(eve, 23)?.date).toBe(run.date);
  });

  it("в день забега и за два дня — не наша забота", () => {
    expect(runDueForReminder(run.date, 12)).toBeNull();
    expect(runDueForReminder(dayBefore(eve), 12)).toBeNull();
  });
});

describe("runWhenWhere — строка «когда и где»", () => {
  it("содержит дату, сбор, старт и адрес", () => {
    const line = runWhenWhere(COFFEE_RUNS[0]);
    expect(line).toContain(COFFEE_RUNS[0].dateLabel);
    expect(line).toContain(COFFEE_RUNS[0].gatherTime);
    expect(line).toContain(COFFEE_RUNS[0].startTime);
    expect(line).toContain(COFFEE_RUNS[0].address);
  });
});
