import { describe, it, expect } from "vitest";
import {
  COFFEE_RUNS,
  REMINDER_HOUR_MSK,
  dayBefore,
  nextRun,
  runBySpot,
  runForSignup,
  runsDueForReminder,
  runWhenWhere,
  upcomingRuns,
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

describe("список забегов — целостность данных", () => {
  it("пара (spot, date) уникальна: по ней ищут заявку бот и рассылка", () => {
    const keys = COFFEE_RUNS.map((r) => `${r.spot}|${r.date}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("у каждого спота свой лендинг — иначе кнопка бота уведёт не туда", () => {
    const landings = new Map(COFFEE_RUNS.map((r) => [r.spot, r.landing]));
    for (const run of COFFEE_RUNS) expect(landings.get(run.spot)).toBe(run.landing);
    expect(new Set(landings.values()).size).toBe(landings.size);
  });
});

describe("upcomingRuns — все ещё не прошедшие забеги", () => {
  it("до первого забега видит все", () => {
    const before = new Date(`${COFFEE_RUNS[0].date}T00:00:00+03:00`);
    expect(upcomingRuns(before)).toHaveLength(COFFEE_RUNS.length);
  });

  it("после последнего — пусто, а не последний по инерции", () => {
    expect(upcomingRuns(new Date("2099-01-01T00:00:00+03:00"))).toEqual([]);
  });
});

describe("runBySpot — забег своего спота", () => {
  it("отдаёт ближайший будущий именно этого спота", () => {
    const luzhniki = COFFEE_RUNS.find((r) => r.spot === "luzhniki");
    const before = new Date(`${COFFEE_RUNS[0].date}T00:00:00+03:00`);
    expect(runBySpot("luzhniki", before)?.date).toBe(luzhniki?.date);
  });

  it("незнакомый спот — null, чтобы вызывающий решил сам", () => {
    expect(runBySpot("нет-такого")).toBeNull();
  });

  it("когда будущих у спота не осталось — последний прошедший, а не чужой забег", () => {
    const late = new Date("2099-01-01T00:00:00+03:00");
    expect(runBySpot("usachevo", late)?.spot).toBe("usachevo");
  });
});

describe("runForSignup — забег конкретной заявки", () => {
  const before = new Date(`${COFFEE_RUNS[0].date}T00:00:00+03:00`);

  it("точное совпадение спота и даты", () => {
    for (const run of COFFEE_RUNS) {
      const got = runForSignup({ spot: run.spot, run_date: run.date }, before);
      expect(got.spot).toBe(run.spot);
      expect(got.date).toBe(run.date);
    }
  });

  it("спот важнее даты: закешированный лендинг с прошлой датой не уводит на чужой спот", () => {
    const got = runForSignup({ spot: "luzhniki", run_date: "2026-08-22" }, before);
    expect(got.spot).toBe("luzhniki");
  });

  it("строка без спота (записана до появления столбца) опознаётся по дате", () => {
    const run = COFFEE_RUNS[0];
    expect(runForSignup({ spot: null, run_date: run.date }, before).spot).toBe(run.spot);
  });

  it("совсем пустая заявка — ближайший забег, а не падение", () => {
    expect(runForSignup({}, before).date).toBe(nextRun(before).date);
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

describe("runsDueForReminder — окно рассылки за сутки", () => {
  const run = COFFEE_RUNS[0];
  const eve = dayBefore(run.date);
  const dates = (ymd: string, hour: number) => runsDueForReminder(ymd, hour).map((r) => r.date);

  it("накануне в час рассылки — забег найден", () => {
    expect(dates(eve, REMINDER_HOUR_MSK)).toContain(run.date);
  });

  it("накануне, но слишком рано — молчим", () => {
    expect(runsDueForReminder(eve, REMINDER_HOUR_MSK - 1)).toEqual([]);
    expect(runsDueForReminder(eve, 0)).toEqual([]);
  });

  it("проспавший тик догоняет позже в тот же день, а не теряет рассылку", () => {
    expect(dates(eve, 23)).toContain(run.date);
  });

  it("в день забега и за два дня — не наша забота", () => {
    expect(runsDueForReminder(run.date, 12).map((r) => r.date)).not.toContain(run.date);
    expect(runsDueForReminder(dayBefore(eve), 12).map((r) => r.date)).not.toContain(run.date);
  });

  it("два забега в один день отдаются оба — иначе половина не получит напоминания", () => {
    for (const r of COFFEE_RUNS) {
      const sameDay = COFFEE_RUNS.filter((x) => x.date === r.date);
      expect(dates(dayBefore(r.date), REMINDER_HOUR_MSK)).toHaveLength(sameDay.length);
    }
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

  it("у каждого забега своя строка — адреса спотов не путаются", () => {
    const lines = COFFEE_RUNS.map(runWhenWhere);
    expect(new Set(lines).size).toBe(lines.length);
    for (const run of COFFEE_RUNS) expect(runWhenWhere(run)).toContain(run.address);
  });
});
