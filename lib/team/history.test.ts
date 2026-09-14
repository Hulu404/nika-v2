import { describe, it, expect } from "vitest";
import {
  aggregateRuns,
  daysUntilStart,
  dynamicsFor,
  leadCutoff,
  median,
  runKeysFrom,
  signupsBefore,
  startOfRun,
  type ArchiveRow,
} from "./history";
import type { TeamRun } from "./runs";

/**
 * Сравнение «сейчас против прошлого раза» — самая опасная арифметика в боте:
 * по ней команда решает, дожимать набор или нет, а ошибка в ней выглядит как
 * обычное число. Поэтому всё считается чистыми функциями от переданного
 * момента, без системных часов.
 */

const NOW = new Date("2026-09-18T12:00:00Z"); // 15:00 МСК пятницы, забег 20-го
const DAY = 24 * 60 * 60 * 1000;

function sign(spot: string, runDate: string, createdAt: string, over: Partial<ArchiveRow> = {}): ArchiveRow {
  return {
    spot,
    run_date: runDate,
    created_at: createdAt,
    confirmed_at: null,
    reminder_sent_at: null,
    ...over,
  };
}

describe("точки отсчёта", () => {
  it("старт забега — полночь по Москве, а не по UTC", () => {
    // 2026-09-20T00:00+03:00 — это 2026-09-19T21:00Z. Считать по UTC значило бы
    // сдвинуть все сравнения на три часа, а у границы суток — на день.
    expect(startOfRun("2026-09-20")).toBe(Date.parse("2026-09-19T21:00:00Z"));
  });

  it("«за сколько дней» считается по календарю, а не по часам", () => {
    // В пятницу про воскресный забег говорят «через два дня». По часам тут
    // 33 часа, то есть «полтора», — но так не говорит никто.
    expect(daysUntilStart("2026-09-20", NOW)).toBe(2);
    expect(daysUntilStart("2026-09-18", NOW)).toBe(0); // сегодня
    expect(daysUntilStart("2026-09-17", NOW)).toBe(-1); // вчера
  });

  it("отсечка сходится: для самого забега «за N дней» — это ровно сейчас", () => {
    // Главное свойство формулы. Если оно сломается, «сейчас — 10» и «было 12»
    // будут посчитаны по разным правилам, и заметить это будет нечем.
    const days = daysUntilStart("2026-09-20", NOW);
    expect(leadCutoff("2026-09-20", days, NOW)).toBe(NOW.getTime());
  });

  it("у прошлого забега отсечка — то же время суток, а не полночь", () => {
    // NOW — 15:00 МСК. Значит и у забега 13-го смотрим на 15:00 МСК того дня,
    // который отстоит от его старта на те же два дня.
    expect(leadCutoff("2026-09-13", 2, NOW)).toBe(Date.parse("2026-09-11T12:00:00Z"));
  });
});

describe("signupsBefore", () => {
  const rows = [
    sign("luzhniki", "2026-09-13", "2026-09-07T10:00:00Z"),
    sign("luzhniki", "2026-09-13", "2026-09-10T10:00:00Z"),
    sign("luzhniki", "2026-09-13", "2026-09-12T10:00:00Z"),
    sign("usachevo", "2026-09-12", "2026-09-05T10:00:00Z"), // чужой забег
  ];
  const LUZH13 = { spot: "luzhniki", date: "2026-09-13" };

  it("считает только заявки, поданные до этой точки", () => {
    expect(signupsBefore(rows, LUZH13, Date.parse("2026-09-08T00:00:00Z"))).toBe(1);
    expect(signupsBefore(rows, LUZH13, Date.parse("2026-09-11T00:00:00Z"))).toBe(2);
    expect(signupsBefore(rows, LUZH13, Date.parse("2026-09-13T00:00:00Z"))).toBe(3);
  });

  it("заявки соседнего спота в чужой счёт не попадают", () => {
    // Даты забегов на разных спотах стоят рядом, и это ровно тот случай, где
    // перепутать легко, а заметить — почти невозможно.
    expect(
      signupsBefore(rows, { spot: "usachevo", date: "2026-09-12" }, Date.parse("2026-09-06T00:00:00Z")),
    ).toBe(1);
  });
});

describe("aggregateRuns", () => {
  const rows = [
    sign("luzhniki", "2026-09-13", "2026-09-07T10:00:00Z", {
      confirmed_at: "2026-09-07T11:00:00Z",
      reminder_sent_at: "2026-09-12T07:00:00Z",
    }),
    sign("luzhniki", "2026-09-13", "2026-09-10T10:00:00Z", { confirmed_at: "2026-09-10T11:00:00Z" }),
    sign("luzhniki", "2026-09-13", "2026-09-12T10:00:00Z"),
    sign("usachevo", "2026-09-12", "2026-09-05T10:00:00Z"),
  ];

  it("считает каждый забег отдельно", () => {
    const [first] = aggregateRuns(rows);
    expect(first).toMatchObject({
      spot: "luzhniki",
      date: "2026-09-13",
      total: 3,
      confirmed: 2,
      reminded: 1,
    });
  });

  it("помнит первую и последнюю заявку — видно, за сколько набрался забег", () => {
    const [first] = aggregateRuns(rows);
    expect(first.firstSignupAt).toBe("2026-09-07T10:00:00Z");
    expect(first.lastSignupAt).toBe("2026-09-12T10:00:00Z");
  });

  it("идёт от свежих забегов к старым", () => {
    const dates = aggregateRuns(rows).map((a) => a.date);
    expect(dates).toEqual(["2026-09-13", "2026-09-12"]);
  });

  it("пустой архив — пустой список, а не падение", () => {
    expect(aggregateRuns([])).toEqual([]);
    expect(runKeysFrom([])).toEqual([]);
  });
});

describe("median", () => {
  it("на чётном количестве берёт середину между соседями", () => {
    expect(median([10, 20])).toBe(15);
    expect(median([1, 2, 3])).toBe(2);
  });

  it("один выброс не сдвигает ориентир так, как сдвинуло бы среднее", () => {
    // Среднее здесь 40, и «обычно к этому моменту 40» было бы неправдой.
    expect(median([10, 10, 100])).toBe(10);
  });

  it("сравнивать не с чем — null", () => {
    expect(median([])).toBeNull();
  });
});

describe("dynamicsFor", () => {
  const LUZH: TeamRun = {
    spot: "luzhniki",
    date: "2026-09-20",
    label: "Лужники, 20 сентября",
    scheduled: null,
    past: false,
  };

  // NOW — за 2 дня до старта 20-го, 15:00 МСК. Значит отсечки:
  //   забег 13-го → 11 сентября 15:00 МСК (2026-09-11T12:00Z),
  //   забег  6-го →  4 сентября 15:00 МСК (2026-09-04T12:00Z).
  const rows = [
    // 13 сентября: до отсечки одна заявка, всего 3.
    sign("luzhniki", "2026-09-13", "2026-09-05T10:00:00Z"),
    sign("luzhniki", "2026-09-13", "2026-09-12T10:00:00Z"),
    sign("luzhniki", "2026-09-13", "2026-09-12T20:00:00Z"),
    // 6 сентября: до отсечки одна заявка, всего 2.
    sign("luzhniki", "2026-09-06", "2026-09-03T10:00:00Z"),
    sign("luzhniki", "2026-09-06", "2026-09-05T10:00:00Z"),
    // Чужой спот — в сравнение попасть не должен.
    sign("usachevo", "2026-09-12", "2026-09-01T10:00:00Z"),
    // Текущий забег: 4 заявки.
    ...Array.from({ length: 4 }, (_, i) =>
      sign("luzhniki", "2026-09-20", `2026-09-1${5 + i}T10:00:00Z`),
    ),
  ];

  it("сравнивает с прошлыми забегами ТОГО ЖЕ спота на ту же точку отсчёта", () => {
    const dyn = dynamicsFor(LUZH, rows, NOW)!;
    expect(dyn.daysBefore).toBe(2);
    expect(dyn.now).toBe(4);
    expect(dyn.previous.map((p) => p.date)).toEqual(["2026-09-13", "2026-09-06"]);
    expect(dyn.previous[0]).toEqual({
      date: "2026-09-13",
      atSameLead: 1,
      final: 3,
      opened: true,
    });
    expect(dyn.previous[1]).toEqual({
      date: "2026-09-06",
      atSameLead: 1,
      final: 2,
      opened: true,
    });
  });

  it("забеги соседнего спота в сравнение не лезут", () => {
    // Лужники и Усачёва набираются по-разному; усреднённый «прошлый раз» по
    // обоим — цифра, которой не существовало никогда.
    const dyn = dynamicsFor(LUZH, rows, NOW)!;
    expect(dyn.previous.every((p) => p.date !== "2026-09-12")).toBe(true);
  });

  it("ориентир — медиана прошлых, и по ней видно опережение", () => {
    const dyn = dynamicsFor(LUZH, rows, NOW)!;
    expect(dyn.typical).toBe(1);
    expect(dyn.now).toBeGreaterThan(dyn.typical!);
  });

  it("прошедший забег динамики не имеет — у него есть итог", () => {
    const past: TeamRun = { ...LUZH, date: "2026-09-13", past: true };
    expect(dynamicsFor(past, rows, NOW)).toBeNull();
  });

  it("первый забег на споте сравнивать не с чем — null, а не нули", () => {
    const fresh: TeamRun = { ...LUZH, spot: "sokolniki" };
    expect(dynamicsFor(fresh, rows, NOW)).toBeNull();
  });

  it("забег, который к этому моменту ещё не набирали, не идёт в ориентир", () => {
    // Иначе получается так: приглашения по понедельникам появились недавно, у
    // прошлых забегов за неделю до старта заявок не было вовсе — и бот бодро
    // сообщает «на девять больше обычного», сравнив набор с периодом, когда
    // набора не было.
    const lateOpened = [
      // Текущий забег: 4 заявки.
      ...Array.from({ length: 4 }, (_, i) =>
        sign("luzhniki", "2026-09-20", `2026-09-1${5 + i}T10:00:00Z`),
      ),
      // Прошлый: запись открылась ПОЗЖЕ отсечки (11 сентября 15:00 МСК).
      sign("luzhniki", "2026-09-13", "2026-09-12T10:00:00Z"),
      sign("luzhniki", "2026-09-13", "2026-09-12T20:00:00Z"),
    ];
    const dyn = dynamicsFor(LUZH, lateOpened, NOW)!;
    expect(dyn.previous[0].opened).toBe(false);
    expect(dyn.previous[0].atSameLead).toBe(0);
    // Ноль есть, но вердикта по нему нет — сравнивать не с чем.
    expect(dyn.typical).toBeNull();
  });

  it("берёт не больше трёх прошлых забегов — сводка не должна быть простынёй", () => {
    const many = [
      ...rows,
      sign("luzhniki", "2026-08-30", "2026-08-25T10:00:00Z"),
      sign("luzhniki", "2026-08-23", "2026-08-18T10:00:00Z"),
      sign("luzhniki", "2026-08-16", "2026-08-11T10:00:00Z"),
    ];
    expect(dynamicsFor(LUZH, many, NOW)!.previous).toHaveLength(3);
  });
});
