import { describe, it, expect } from "vitest";
import { COFFEE_RUNS } from "../coffeerun/run";
import { defaultRun, isPast, mergeRuns, pickRun, runDateLabel, teamRun, type TeamRun } from "./runs";

/**
 * Забег для команды — это пара (спот, дата), откуда бы она ни пришла. Здесь
 * проверяется, что прошедшие забеги не теряются, будущие не дублируются, а
 * вопрос «покажи Лужники» не приводит на Усачёву.
 */

const NOW = new Date("2026-09-18T12:00:00Z"); // 15:00 МСК, пятница

/** Ключи как их отдаёт база: два прошедших и один будущий. */
const FROM_DB = [
  { spot: "luzhniki", date: "2026-09-13" },
  { spot: "luzhniki", date: "2026-09-06" },
  { spot: "usachevo", date: "2026-09-12" },
];

describe("runDateLabel", () => {
  it("делает из ISO человеческую дату", () => {
    expect(runDateLabel("2026-09-13")).toBe("13 сентября");
  });

  it("мусор отдаёт как есть, а не «Invalid Date»", () => {
    expect(runDateLabel("нет даты")).toBe("нет даты");
  });
});

describe("isPast", () => {
  it("день забега считается будущим целиком — как в run.ts", () => {
    // Человек, который смотрит сводку утром в день старта, должен увидеть
    // сегодняшний забег живым, а не «прошедшим».
    expect(isPast("2026-09-18", NOW)).toBe(false);
    expect(isPast("2026-09-17", NOW)).toBe(true);
    expect(isPast("2026-09-20", NOW)).toBe(false);
  });
});

describe("teamRun", () => {
  it("забег из расписания знает время и адрес", () => {
    const scheduled = COFFEE_RUNS[0];
    const run = teamRun({ spot: scheduled.spot, date: scheduled.date }, NOW);
    expect(run.scheduled).toBe(scheduled);
    expect(run.label).toContain(scheduled.spotName);
  });

  it("прошедший забег знает только имя спота и дату", () => {
    const run = teamRun({ spot: "luzhniki", date: "2026-09-13" }, NOW);
    expect(run.scheduled).toBeNull();
    expect(run.past).toBe(true);
    // Слаг в подписи недопустим: команда читает названия, а не идентификаторы.
    expect(run.label).toContain("Лужники");
    expect(run.label).toContain("13 сентября");
  });
});

describe("mergeRuns", () => {
  it("склеивает базу и расписание без дублей", () => {
    const runs = mergeRuns(FROM_DB, NOW);
    const ids = runs.map((r) => `${r.spot}/${r.date}`);
    expect(new Set(ids).size).toBe(ids.length);
    for (const key of FROM_DB) expect(ids).toContain(`${key.spot}/${key.date}`);
    for (const run of COFFEE_RUNS) expect(ids).toContain(`${run.spot}/${run.date}`);
  });

  it("забег из расписания, на который ещё никто не записался, всё равно виден", () => {
    // Именно про него спросят первым делом — потому что там ноль.
    const runs = mergeRuns([], NOW);
    expect(runs.length).toBe(COFFEE_RUNS.length);
  });

  it("идёт от свежих к старым", () => {
    const dates = mergeRuns(FROM_DB, NOW).map((r) => r.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe("pickRun", () => {
  const runs = mergeRuns(FROM_DB, NOW);

  it("слаг спота даёт ближайший будущий забег этого спота", () => {
    const picked = pickRun("luzhniki", runs);
    expect(picked?.spot).toBe("luzhniki");
    expect(picked?.past).toBe(false);
  });

  it("кусок названия работает так же", () => {
    expect(pickRun("лужн", runs)?.spot).toBe("luzhniki");
    expect(pickRun("усач", runs)?.spot).toBe("usachevo");
  });

  it("спот и дата вместе дают именно тот забег, в том числе прошедший", () => {
    const picked = pickRun("лужники 13.09", runs);
    expect(picked?.spot).toBe("luzhniki");
    expect(picked?.date).toBe("2026-09-13");
  });

  it("понимает ISO-дату и дату с годом", () => {
    expect(pickRun("2026-09-12", runs)?.spot).toBe("usachevo");
    expect(pickRun("13.09.2026", runs)?.date).toBe("2026-09-13");
  });

  it("непонятное — null, чтобы бот переспросил, а не подставил соседний спот", () => {
    expect(pickRun("сокольники", runs)).toBeNull();
    expect(pickRun("", runs)).toBeNull();
  });

  it("огрызок не вытаскивает случайный забег", () => {
    // Короткое слово из свободного сообщения не должно молча открыть карточку.
    expect(pickRun("на", runs)).toBeNull();
    expect(pickRun("с", runs)).toBeNull();
  });
});

describe("defaultRun", () => {
  it("без аргумента — ближайший будущий", () => {
    const runs = mergeRuns(FROM_DB, NOW);
    const picked = defaultRun(runs);
    expect(picked?.past).toBe(false);
    // Именно ближайший, а не самый дальний из будущих.
    const upcoming = runs.filter((r) => !r.past).map((r) => r.date);
    expect(picked?.date).toBe([...upcoming].sort()[0]);
  });

  it("будущих не осталось — показываем последний прошедший, а не «не поняла»", () => {
    const past: TeamRun[] = mergeRuns(FROM_DB, new Date("2027-01-01T00:00:00Z"));
    expect(defaultRun(past)?.past).toBe(true);
  });

  it("пусто — null, и это не ошибка", () => {
    expect(defaultRun([])).toBeNull();
  });
});
