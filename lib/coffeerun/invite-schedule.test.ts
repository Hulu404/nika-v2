import { describe, it, expect } from "vitest";
import {
  INVITE_HOUR_MSK,
  INVITE_WEEKDAY,
  nextRunPerSpot,
  runsDueForInvite,
} from "./invite-schedule";
import { COFFEE_RUNS, type CoffeeRun } from "./run";

/**
 * Расписание приглашений. Проверяем не «что написано в константах», а поведение
 * на границах: рассылка уходит людям, которые её не заказывали, и лишний тик
 * здесь стоит дороже пропущенного.
 */

function run(spot: string, date: string): CoffeeRun {
  return {
    spot,
    landing: `/coffeerun${spot}`,
    spotName: spot,
    date,
    dateLabel: date,
    weekday: "суббота",
    gatherTime: "9:30",
    startTime: "10:00",
    address: "адрес",
    place: "спот",
    distance: "5 км",
    mapUrl: "https://example.test",
  };
}

describe("nextRunPerSpot", () => {
  it("берёт по одному ближайшему забегу на спот", () => {
    const got = nextRunPerSpot([
      run("usachevo", "2026-09-19"),
      run("luzhniki", "2026-09-20"),
      run("usachevo", "2026-09-26"), // второй забег того же спота — не берём
      run("luzhniki", "2026-09-27"),
    ]);

    expect(got.map((r) => `${r.spot}/${r.date}`)).toEqual([
      "usachevo/2026-09-19",
      "luzhniki/2026-09-20",
    ]);
  });

  it("пустой список — пустой результат", () => {
    expect(nextRunPerSpot([])).toEqual([]);
  });

  it("один спот — один забег, даже если их три", () => {
    const got = nextRunPerSpot([
      run("luzhniki", "2026-09-20"),
      run("luzhniki", "2026-09-27"),
      run("luzhniki", "2026-10-04"),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0].date).toBe("2026-09-20");
  });
});

describe("runsDueForInvite — окно «понедельник с 10:00 МСК»", () => {
  // Берём момент, когда в COFFEE_RUNS заведомо есть будущие забеги.
  const whenRunsExist = new Date(`${COFFEE_RUNS[0].date}T00:00:00+03:00`);

  it("в понедельник в свой час зовёт", () => {
    const got = runsDueForInvite(INVITE_WEEKDAY, INVITE_HOUR_MSK, whenRunsExist);
    expect(got.length).toBeGreaterThan(0);
  });

  it("в понедельник позже часа тоже зовёт — проспавший тик догоняет", () => {
    const got = runsDueForInvite(INVITE_WEEKDAY, 23, whenRunsExist);
    expect(got.length).toBeGreaterThan(0);
  });

  it("в понедельник до часа молчит", () => {
    expect(runsDueForInvite(INVITE_WEEKDAY, INVITE_HOUR_MSK - 1, whenRunsExist)).toEqual([]);
    expect(runsDueForInvite(INVITE_WEEKDAY, 0, whenRunsExist)).toEqual([]);
  });

  it("в любой другой день недели молчит, в какой бы час ни тикнуло", () => {
    for (let weekday = 0; weekday <= 6; weekday++) {
      if (weekday === INVITE_WEEKDAY) continue;
      for (const hour of [0, INVITE_HOUR_MSK, 23]) {
        expect(runsDueForInvite(weekday, hour, whenRunsExist)).toEqual([]);
      }
    }
  });

  it("когда будущих забегов нет — молчит даже в понедельник", () => {
    const farFuture = new Date("2099-01-04T12:00:00+03:00"); // понедельник
    expect(runsDueForInvite(INVITE_WEEKDAY, 12, farFuture)).toEqual([]);
  });

  it("зовёт максимум по одному забегу на спот", () => {
    const got = runsDueForInvite(INVITE_WEEKDAY, INVITE_HOUR_MSK, whenRunsExist);
    const spots = got.map((r) => r.spot);
    expect(new Set(spots).size).toBe(spots.length);
  });
});
