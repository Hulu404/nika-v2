import { describe, it, expect } from "vitest";
import { COFFEE_RUNS, REMINDER_HOUR_MSK, dayBefore, type CoffeeRun } from "../coffeerun/run";
import { digestsDue, EVE_HOUR_MSK, MORNING_HOUR_MSK } from "./digest-schedule";

/**
 * Когда бот пишет сам. Логика окон проверяется чистыми функциями, без подмены
 * системного времени, — по образцу runsDueForReminder.
 */

const RUN: CoffeeRun = {
  ...COFFEE_RUNS[0],
  spot: "luzhniki",
  date: "2026-09-20",
};
const RUNS = [RUN];

describe("окна сводок", () => {
  it("вечерняя идёт ПОСЛЕ окна напоминаний, а не до", () => {
    // Отчитаться о рассылке, пока она идёт, — верный способ поднять ложную
    // тревогу: напоминания уходят порциями, и в 10:05 отправлено ещё не всё.
    expect(EVE_HOUR_MSK).toBeGreaterThan(REMINDER_HOUR_MSK);
  });

  it("утренняя — задолго до сбора", () => {
    // Сбор в 9:30; пейсер должен увидеть свои группы, пока ещё дома.
    expect(MORNING_HOUR_MSK).toBeLessThan(9);
  });
});

describe("digestsDue", () => {
  const eve = dayBefore(RUN.date); // 2026-09-19

  it("накануне после своего часа — вечерняя сводка", () => {
    expect(digestsDue(eve, EVE_HOUR_MSK, RUNS)).toEqual([{ kind: "eve", run: RUN }]);
  });

  it("накануне, но рано — молчим", () => {
    expect(digestsDue(eve, EVE_HOUR_MSK - 1, RUNS)).toEqual([]);
  });

  it("в день забега после своего часа — утренняя сводка", () => {
    expect(digestsDue(RUN.date, MORNING_HOUR_MSK, RUNS)).toEqual([{ kind: "morning", run: RUN }]);
  });

  it("ночью в день забега — молчим", () => {
    expect(digestsDue(RUN.date, MORNING_HOUR_MSK - 1, RUNS)).toEqual([]);
  });

  it("проспавший тикер всё равно отправит, а не пропустит день", () => {
    // Деплой или перезапуск могли съесть ровный час. Повтора это не создаёт —
    // дедуп держит таблица team_digests.
    expect(digestsDue(RUN.date, 23, RUNS)).toHaveLength(1);
    expect(digestsDue(eve, 23, RUNS)).toHaveLength(1);
  });

  it("обычный день — ничего", () => {
    expect(digestsDue("2026-09-16", 12, RUNS)).toEqual([]);
  });

  it("два забега на соседних спотах в один день дают две сводки", () => {
    // Вернув только первый, мы бы молча оставили половину команды без сводки.
    const pair: CoffeeRun[] = [RUN, { ...RUN, spot: "usachevo" }];
    const due = digestsDue(RUN.date, MORNING_HOUR_MSK, pair);
    expect(due).toHaveLength(2);
    expect(due.map((d) => d.run.spot).sort()).toEqual(["luzhniki", "usachevo"]);
  });

  it("если сегодня и вечер одного забега, и утро другого — вечерний первым", () => {
    // Забеги идут в соседние дни (суббота и воскресенье), и такой день —
    // обычный, а не исключительный.
    const saturday: CoffeeRun = { ...RUN, spot: "usachevo", date: "2026-09-19" };
    const due = digestsDue("2026-09-19", EVE_HOUR_MSK, [RUN, saturday]);
    expect(due.map((d) => `${d.kind} ${d.run.spot}`)).toEqual([
      "morning usachevo",
      "eve luzhniki",
    ]);
  });
});
