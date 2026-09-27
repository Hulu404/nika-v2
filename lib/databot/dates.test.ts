import { describe, expect, it } from "vitest";
import {
  clampPeriod,
  comparisonPeriod,
  monthPeriod,
  mskMidnight,
  mskWeekday,
  parsePeriod,
  parseRunDate,
  periodFor,
  periodFromCode,
  rangePeriod,
  type Period,
} from "./dates";

/*
 * Сервер живёт в UTC, поэтому now везде — UTC-момент. Для читаемости
 * большинство моментов пишем по-московски через msk(), но граничные случаи
 * (23:59/00:00 МСК) — прямо в Z, чтобы тест не зависел от хелпера.
 */
const msk = (local: string) => new Date(`${local}+03:00`);
const iso = (local: string) => msk(local).toISOString();

function span(p: Period): [string, string, string, string] {
  return [p.fromYmd, p.toYmd, p.from.toISOString(), p.to.toISOString()];
}

// Чт 01.10.2026, 14:32 МСК = 11:32 UTC. Неделя: пн 28.09 – вс 04.10.
const NOW = new Date("2026-10-01T11:32:00Z");

describe("mskMidnight, mskWeekday", () => {
  it("полночь МСК — 21:00 UTC предыдущего дня", () => {
    expect(mskMidnight("2026-10-01").toISOString()).toBe("2026-09-30T21:00:00.000Z");
    expect(mskMidnight("2027-01-01").toISOString()).toBe("2026-12-31T21:00:00.000Z");
    expect(mskMidnight("2028-02-29").toISOString()).toBe("2028-02-28T21:00:00.000Z");
  });
  it("смещение из Intl: в 2011–2014 Москва жила в +04:00", () => {
    expect(mskMidnight("2013-06-01").toISOString()).toBe("2013-05-31T20:00:00.000Z");
  });
  it("бросает на не-дате", () => {
    expect(() => mskMidnight("2026-02-30")).toThrow(RangeError);
    expect(() => mskMidnight("01.10")).toThrow(RangeError);
  });
  it("день недели: 1 = пн … 7 = вс", () => {
    expect(mskWeekday("2026-09-28")).toBe(1);
    expect(mskWeekday("2026-10-01")).toBe(4);
    expect(mskWeekday("2026-10-03")).toBe(6);
    expect(mskWeekday("2026-10-04")).toBe(7);
    expect(mskWeekday("2028-02-29")).toBe(2);
  });
});

describe("periodFor", () => {
  it("сегодня и вчера", () => {
    expect(span(periodFor("today", NOW))).toEqual([
      "2026-10-01",
      "2026-10-01",
      "2026-09-30T21:00:00.000Z",
      "2026-10-01T11:32:00.000Z",
    ]);
    expect(span(periodFor("yesterday", NOW))).toEqual([
      "2026-09-30",
      "2026-09-30",
      "2026-09-29T21:00:00.000Z",
      "2026-09-30T21:00:00.000Z",
    ]);
  });

  it("граница суток по Москве при UTC-сервере: 23:59 и 00:00 МСК", () => {
    // 20:59 UTC 30.09 — ещё 30.09 по Москве, хотя в UTC тоже 30-е;
    // 21:00 UTC 30.09 — уже 01.10 по Москве, хотя в UTC ещё 30-е.
    const before = new Date("2026-09-30T20:59:00Z");
    const after = new Date("2026-09-30T21:00:00Z");
    expect(periodFor("today", before).fromYmd).toBe("2026-09-30");
    expect(periodFor("today", before).from.toISOString()).toBe("2026-09-29T21:00:00.000Z");
    expect(periodFor("today", after).fromYmd).toBe("2026-10-01");
    expect(periodFor("today", after).from.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    expect(periodFor("yesterday", after).fromYmd).toBe("2026-09-30");
    // Ровно в полночь «сегодня» пусто, но последний день — сегодня, а не вчера.
    expect(span(periodFor("today", after))).toEqual([
      "2026-10-01",
      "2026-10-01",
      "2026-09-30T21:00:00.000Z",
      "2026-09-30T21:00:00.000Z",
    ]);
  });

  it("7 и 30 дней включают сегодняшний", () => {
    expect(span(periodFor("7d", NOW))).toEqual([
      "2026-09-25",
      "2026-10-01",
      iso("2026-09-25T00:00:00"),
      NOW.toISOString(),
    ]);
    expect(span(periodFor("30d", NOW)).slice(0, 2)).toEqual(["2026-09-02", "2026-10-01"]);
  });

  it("прошлая и эта неделя — с понедельника", () => {
    expect(span(periodFor("last_week", NOW))).toEqual([
      "2026-09-21",
      "2026-09-27",
      iso("2026-09-21T00:00:00"),
      iso("2026-09-28T00:00:00"),
    ]);
    expect(span(periodFor("this_week", NOW))).toEqual([
      "2026-09-28",
      "2026-10-01",
      iso("2026-09-28T00:00:00"),
      NOW.toISOString(),
    ]);
  });

  it("в воскресенье эта неделя — пн…вс, прошлая — предыдущие пн–вс", () => {
    const sun = msk("2026-10-04T23:59:00");
    expect(span(periodFor("this_week", sun)).slice(0, 2)).toEqual(["2026-09-28", "2026-10-04"]);
    expect(span(periodFor("last_week", sun)).slice(0, 2)).toEqual(["2026-09-21", "2026-09-27"]);
  });

  it("понедельник 00:30 МСК: прошлая неделя — предыдущие пн–вс, эта — 30 минут", () => {
    const mon = new Date("2026-09-27T21:30:00Z"); // пн 28.09 00:30 МСК, в UTC ещё вс
    expect(span(periodFor("last_week", mon))).toEqual([
      "2026-09-21",
      "2026-09-27",
      "2026-09-20T21:00:00.000Z",
      "2026-09-27T21:00:00.000Z",
    ]);
    const tw = periodFor("this_week", mon);
    expect(span(tw)).toEqual(["2026-09-28", "2026-09-28", "2026-09-27T21:00:00.000Z", "2026-09-27T21:30:00.000Z"]);
    expect(tw.to.getTime() - tw.from.getTime()).toBe(30 * 60 * 1000);
  });

  it("прошлая неделя через Новый год", () => {
    // пн 04.01.2027 → прошлая неделя пн 28.12.2026 – вс 03.01.2027
    const p = periodFor("last_week", msk("2027-01-04T10:00:00"));
    expect(span(p).slice(0, 2)).toEqual(["2026-12-28", "2027-01-03"]);
    // пт 01.01.2027: эта неделя началась в прошлом году
    expect(periodFor("this_week", msk("2027-01-01T10:00:00")).fromYmd).toBe("2026-12-28");
  });

  it("этот месяц — с 1-го числа; 31.12 → 01.01", () => {
    expect(span(periodFor("this_month", NOW)).slice(0, 3)).toEqual([
      "2026-10-01",
      "2026-10-01",
      "2026-09-30T21:00:00.000Z",
    ]);
    const nye = new Date("2026-12-31T20:59:00Z"); // 31.12 23:59 МСК
    expect(span(periodFor("this_month", nye)).slice(0, 2)).toEqual(["2026-12-01", "2026-12-31"]);
    const ny = new Date("2026-12-31T21:00:00Z"); // 01.01.2027 00:00 МСК
    expect(periodFor("this_month", ny).fromYmd).toBe("2027-01-01");
    expect(periodFor("yesterday", ny).fromYmd).toBe("2026-12-31");
    expect(periodFor("7d", ny).fromYmd).toBe("2026-12-26");
  });
});

describe("monthPeriod", () => {
  it("27.09: октябрь — прошлого года, целиком", () => {
    expect(span(monthPeriod(10, msk("2026-09-27T12:00:00")))).toEqual([
      "2025-10-01",
      "2025-10-31",
      iso("2025-10-01T00:00:00"),
      iso("2025-11-01T00:00:00"),
    ]);
  });
  it("05.10: октябрь — этого года, до now", () => {
    const now = msk("2026-10-05T09:00:00");
    const p = monthPeriod(10, now);
    expect(p.kind).toBe("month");
    expect(span(p)).toEqual(["2026-10-01", "2026-10-05", iso("2026-10-01T00:00:00"), now.toISOString()]);
  });
  it("декабрь в январе — прошлого года; февраль високосного", () => {
    expect(span(monthPeriod(12, msk("2027-01-10T12:00:00"))).slice(0, 2)).toEqual(["2026-12-01", "2026-12-31"]);
    expect(span(monthPeriod(2, msk("2028-05-01T12:00:00"))).slice(0, 2)).toEqual(["2028-02-01", "2028-02-29"]);
  });
  it("бросает на не-месяце", () => {
    expect(() => monthPeriod(0, NOW)).toThrow(RangeError);
    expect(() => monthPeriod(13, NOW)).toThrow(RangeError);
  });
});

describe("rangePeriod, periodFromCode", () => {
  it("даты включительно, конец — полночь следующего дня", () => {
    expect(span(rangePeriod("2026-10-01", "2026-10-07"))).toEqual([
      "2026-10-01",
      "2026-10-07",
      "2026-09-30T21:00:00.000Z",
      "2026-10-07T21:00:00.000Z",
    ]);
    expect(span(rangePeriod("2026-12-31", "2026-12-31"))[3]).toBe("2026-12-31T21:00:00.000Z");
  });
  it("28.02–01.03 високосного года — три дня", () => {
    const p = rangePeriod("2028-02-28", "2028-03-01");
    expect(p.to.getTime() - p.from.getTime()).toBe(3 * 24 * 3600 * 1000);
  });
  it("бросает на кривом входе", () => {
    expect(() => rangePeriod("2026-10-07", "2026-10-01")).toThrow(RangeError);
    expect(() => rangePeriod("2027-02-29", "2027-03-01")).toThrow(RangeError);
  });
  it("коды кнопок", () => {
    expect(periodFromCode("7d", NOW)?.kind).toBe("7d");
    expect(periodFromCode("pw", NOW)?.kind).toBe("last_week");
    expect(periodFromCode("tm", NOW)?.kind).toBe("this_month");
    expect(periodFromCode("30d", NOW)?.kind).toBe("30d");
    expect(span(periodFromCode("20260914-20260920", NOW)!)).toEqual(span(rangePeriod("2026-09-14", "2026-09-20")));
    expect(periodFromCode("20260920-20260914", NOW)).toBeNull();
    expect(periodFromCode("1d", NOW)).toBeNull();
    expect(periodFromCode("", NOW)).toBeNull();
  });
});

describe("parsePeriod", () => {
  const kind = (t: string, now = NOW) => parsePeriod(t, now)?.kind ?? null;
  const days = (t: string, now = NOW) => {
    const p = parsePeriod(t, now);
    return p ? [p.fromYmd, p.toYmd] : null;
  };

  it("слова периода", () => {
    expect(kind("сегодня")).toBe("today");
    expect(kind("вчера")).toBe("yesterday");
    expect(kind("7 дней")).toBe("7d");
    expect(kind("за последние 7 дней")).toBe("7d");
    expect(kind("неделя")).toBe("7d");
    expect(kind("за неделю")).toBe("7d");
    expect(kind("30 дней")).toBe("30d");
    expect(kind("месяц")).toBe("30d");
    expect(kind("прошлая неделя")).toBe("last_week");
    expect(kind("на прошлой неделе")).toBe("last_week");
    expect(kind("за прошлую неделю")).toBe("last_week");
    expect(kind("эта неделя")).toBe("this_week");
    expect(kind("на этой неделе")).toBe("this_week");
    expect(kind("этот месяц")).toBe("this_month");
    expect(kind("в этом месяце")).toBe("this_month");
    expect(kind("с начала месяца")).toBe("this_month");
  });

  it("фразы из вопросов — подстрока", () => {
    expect(kind("сколько пришло из инсты за неделю")).toBe("7d");
    expect(kind("Соцсети, прошлая неделя?")).toBe("last_week");
    expect(kind("регистрации за месяц")).toBe("30d");
    expect(kind("переходы по IGST-0310 за 30 дней")).toBe("30d");
    expect(days("оплаты про за октябрь", msk("2026-11-03T10:00:00"))).toEqual(["2026-10-01", "2026-10-31"]);
    expect(kind("сколько регистраций сегодня")).toBe("today");
  });

  it("месяцы во всех падежах", () => {
    const now = msk("2026-12-15T10:00:00");
    const forms: Array<[string, string]> = [
      ["январь", "2026-01"],
      ["в январе", "2026-01"],
      ["за февраль", "2026-02"],
      ["в феврале", "2026-02"],
      ["март", "2026-03"],
      ["в марте", "2026-03"],
      ["апрель", "2026-04"],
      ["в апреле", "2026-04"],
      ["май", "2026-05"],
      ["в мае", "2026-05"],
      ["за июнь", "2026-06"],
      ["в июне", "2026-06"],
      ["июль", "2026-07"],
      ["в июле", "2026-07"],
      ["за август", "2026-08"],
      ["в августе", "2026-08"],
      ["сентябрь", "2026-09"],
      ["в сентябре", "2026-09"],
      ["октябрь", "2026-10"],
      ["в октябре", "2026-10"],
      ["за октябрь", "2026-10"],
      ["итоги октября", "2026-10"],
      ["ноябрь", "2026-11"],
      ["в ноябре", "2026-11"],
      ["декабрь", "2026-12"],
      ["в декабре", "2026-12"],
    ];
    for (const [t, ym] of forms) {
      const p = parsePeriod(t, now);
      expect(p?.kind, t).toBe("month");
      expect(p?.fromYmd, t).toBe(`${ym}-01`);
    }
    // декабрь ещё идёт — до now
    expect(parsePeriod("в декабре", now)?.to.toISOString()).toBe(now.toISOString());
  });

  it("месяц: этого года, если начался, иначе прошлого; год можно назвать", () => {
    expect(days("октябрь", msk("2026-09-27T12:00:00"))).toEqual(["2025-10-01", "2025-10-31"]);
    expect(days("октябрь", msk("2026-10-05T12:00:00"))).toEqual(["2026-10-01", "2026-10-05"]);
    expect(days("за октябрь 2024", NOW)).toEqual(["2024-10-01", "2024-10-31"]);
  });

  it("«3 октября» — не месяц, а «прошлый месяц» — весь прошлый", () => {
    expect(parsePeriod("на 3 октября", NOW)).toBeNull();
    expect(days("за прошлый месяц", NOW)).toEqual(["2026-09-01", "2026-09-30"]);
    expect(days("в прошлом месяце", msk("2027-01-10T10:00:00"))).toEqual(["2026-12-01", "2026-12-31"]);
  });

  it("диапазоны дат", () => {
    const now = msk("2026-10-20T10:00:00");
    for (const t of ["с 01.10 по 07.10", "с 1.10 по 7.10", "01.10–07.10", "01.10 — 07.10", "01.10-07.10", "с 01.10 до 07.10"]) {
      const p = parsePeriod(t, now);
      expect(p?.kind, t).toBe("range");
      expect(p && [p.fromYmd, p.toYmd], t).toEqual(["2026-10-01", "2026-10-07"]);
    }
    expect(days("оплаты с 1 по 7 октября", now)).toEqual(["2026-10-01", "2026-10-07"]);
    expect(days("с 28 сентября по 4 октября", now)).toEqual(["2026-09-28", "2026-10-04"]);
    expect(days("01.10.2025-07.10.2025", now)).toEqual(["2025-10-01", "2025-10-07"]);
  });

  it("год диапазона: текущий, а если начало в будущем — прошлый", () => {
    // 27.09: «с 01.10 по 07.10» — прошлогодняя неделя
    expect(days("с 01.10 по 07.10", msk("2026-09-27T10:00:00"))).toEqual(["2025-10-01", "2025-10-07"]);
    // Начало сегодня — не будущее
    expect(days("с 27.09 по 03.10", msk("2026-09-27T10:00:00"))).toEqual(["2026-09-27", "2026-10-03"]);
    // Через Новый год: конец — следующего года после начала
    expect(days("с 25.12 по 05.01", msk("2027-01-10T10:00:00"))).toEqual(["2026-12-25", "2027-01-05"]);
  });

  it("29 февраля и «с 28.02 по 01.03»", () => {
    const now = msk("2028-03-10T10:00:00");
    const p = parsePeriod("с 28.02 по 01.03", now)!;
    expect([p.fromYmd, p.toYmd]).toEqual(["2028-02-28", "2028-03-01"]);
    expect(p.to.getTime() - p.from.getTime()).toBe(3 * 24 * 3600 * 1000);
    expect(days("с 29.02 по 01.03", now)).toEqual(["2028-02-29", "2028-03-01"]);
    // В невисокосном 2027-м 29.02 нет ни в этом, ни в прошлом году
    expect(parsePeriod("с 29.02 по 01.03", msk("2027-03-10T10:00:00"))).toBeNull();
  });

  it("открытое «с 01.10» — до сейчас", () => {
    const now = msk("2026-10-20T10:00:00");
    const p = parsePeriod("заявки с 01.10", now)!;
    expect(p.kind).toBe("range");
    expect(span(p)).toEqual(["2026-10-01", "2026-10-20", iso("2026-10-01T00:00:00"), now.toISOString()]);
  });

  it("нет периода или он не наш — null", () => {
    for (const t of [
      "привет",
      "строка цифр",
      "сколько записалось на 03.10",
      "за 3 дня",
      "за 2 недели",
      "за две недели",
      "пару месяцев",
      "следующая неделя",
      "позапрошлая неделя",
      "позавчера",
      "с 07.10 по 01.10",
      "",
    ]) {
      expect(parsePeriod(t, NOW), t).toBeNull();
    }
  });
});

describe("clampPeriod", () => {
  it("в норме — без правок", () => {
    const p = periodFor("7d", NOW);
    expect(clampPeriod(p, NOW)).toEqual({ period: p, adjusted: false, reason: null });
  });

  it("конец в будущем → конец = now", () => {
    const r = clampPeriod(rangePeriod("2026-09-25", "2026-10-07"), NOW);
    expect(r.adjusted).toBe(true);
    expect(r.reason).toBe("future");
    expect(r.period.kind).toBe("range");
    expect(span(r.period)).toEqual(["2026-09-25", "2026-10-01", iso("2026-09-25T00:00:00"), NOW.toISOString()]);
  });

  it("период целиком в будущем → сегодня", () => {
    const r = clampPeriod(rangePeriod("2026-10-10", "2026-10-20"), NOW);
    expect(r).toEqual({ period: periodFor("today", NOW), adjusted: true, reason: "future" });
    // Будущий месяц с названным годом — тоже
    const m = clampPeriod(parsePeriod("октябрь 2027", NOW)!, NOW);
    expect(m.reason).toBe("future");
    expect(m.period.kind).toBe("today");
  });

  it("400 дней → последние 366, начало на полуночи", () => {
    const r = clampPeriod(rangePeriod("2025-08-01", "2026-09-04"), NOW);
    expect(r.adjusted).toBe(true);
    expect(r.reason).toBe("too_long");
    expect(span(r.period)).toEqual([
      "2025-09-04",
      "2026-09-04",
      iso("2025-09-04T00:00:00"),
      iso("2026-09-05T00:00:00"),
    ]);
    expect(r.period.to.getTime() - r.period.from.getTime()).toBe(366 * 24 * 3600 * 1000);
  });

  it("ровно 366 дней — в норме", () => {
    const p = rangePeriod("2027-10-01", "2028-09-30"); // через 29.02.2028
    expect(clampPeriod(p, msk("2028-10-05T10:00:00")).adjusted).toBe(false);
  });

  it("длинный и уходящий в будущее: сначала конец, потом длина", () => {
    const r = clampPeriod(rangePeriod("2025-01-01", "2026-12-31"), NOW);
    expect(r.reason).toBe("future");
    expect(span(r.period)).toEqual(["2025-10-01", "2026-10-01", iso("2025-10-01T00:00:00"), NOW.toISOString()]);
  });
});

describe("comparisonPeriod", () => {
  const cmp = (p: Period) => {
    const c = comparisonPeriod(p);
    return [c.label, ...span(c.period)];
  };

  it("сегодня → вчера до того же часа", () => {
    expect(cmp(periodFor("today", NOW))).toEqual([
      "вчера",
      "2026-09-30",
      "2026-09-30",
      iso("2026-09-30T00:00:00"),
      iso("2026-09-30T14:32:00"),
    ]);
  });

  it("вчера → днём раньше", () => {
    expect(cmp(periodFor("yesterday", NOW))).toEqual([
      "днём раньше",
      "2026-09-29",
      "2026-09-29",
      iso("2026-09-29T00:00:00"),
      iso("2026-09-30T00:00:00"),
    ]);
  });

  it("7 дней → неделей раньше, до того же момента", () => {
    expect(cmp(periodFor("7d", NOW))).toEqual([
      "неделей раньше",
      "2026-09-18",
      "2026-09-24",
      iso("2026-09-18T00:00:00"),
      iso("2026-09-24T14:32:00"),
    ]);
  });

  it("прошлая неделя → позапрошлая", () => {
    expect(cmp(periodFor("last_week", NOW))).toEqual([
      "неделей раньше",
      "2026-09-14",
      "2026-09-20",
      iso("2026-09-14T00:00:00"),
      iso("2026-09-21T00:00:00"),
    ]);
  });

  it("эта неделя → те же дни прошлой (пн–чт, а не пт–вс)", () => {
    expect(cmp(periodFor("this_week", NOW))).toEqual([
      "неделей раньше",
      "2026-09-21",
      "2026-09-24",
      iso("2026-09-21T00:00:00"),
      iso("2026-09-24T14:32:00"),
    ]);
  });

  it("30 дней → предыдущие 30", () => {
    const [label, from, to] = cmp(periodFor("30d", NOW));
    expect([label, from, to]).toEqual(["за предыдущие 30 дней", "2026-08-03", "2026-09-01"]);
  });

  it("этот месяц → те же дни прошлого; короткий прошлый месяц обрезан", () => {
    expect(cmp(periodFor("this_month", msk("2026-10-15T09:00:00")))).toEqual([
      "месяцем раньше",
      "2026-09-01",
      "2026-09-15",
      iso("2026-09-01T00:00:00"),
      iso("2026-09-15T09:00:00"),
    ]);
    // 31.03 → в феврале 28 дней: весь февраль
    expect(cmp(periodFor("this_month", msk("2027-03-31T09:00:00")))).toEqual([
      "месяцем раньше",
      "2027-02-01",
      "2027-02-28",
      iso("2027-02-01T00:00:00"),
      iso("2027-03-01T00:00:00"),
    ]);
    // Январь → декабрь прошлого года
    expect(cmp(periodFor("this_month", msk("2027-01-05T09:00:00"))).slice(1, 3)).toEqual(["2026-12-01", "2026-12-05"]);
  });

  it("именованный месяц → весь предыдущий календарный", () => {
    const c = comparisonPeriod(monthPeriod(10, msk("2026-11-03T10:00:00")));
    expect(c.label).toBe("месяцем раньше");
    expect(c.period.kind).toBe("month");
    expect(span(c.period)).toEqual(["2026-09-01", "2026-09-30", iso("2026-09-01T00:00:00"), iso("2026-10-01T00:00:00")]);
    // март → февраль високосного года целиком
    expect(span(comparisonPeriod(monthPeriod(3, msk("2028-05-01T10:00:00"))).period).slice(0, 2)).toEqual([
      "2028-02-01",
      "2028-02-29",
    ]);
  });

  it("идущий именованный месяц → те же дни прошлого", () => {
    const c = comparisonPeriod(monthPeriod(10, msk("2026-10-05T09:00:00")));
    expect([c.label, ...span(c.period)]).toEqual([
      "месяцем раньше",
      "2026-09-01",
      "2026-09-05",
      iso("2026-09-01T00:00:00"),
      iso("2026-09-05T09:00:00"),
    ]);
  });

  it("свой период → соседнее окно той же длины с подписью", () => {
    expect(cmp(rangePeriod("2026-09-21", "2026-09-27"))).toEqual([
      "за 14.09–20.09",
      "2026-09-14",
      "2026-09-20",
      iso("2026-09-14T00:00:00"),
      iso("2026-09-21T00:00:00"),
    ]);
    expect(comparisonPeriod(rangePeriod("2027-01-01", "2027-01-10")).label).toBe("за 22.12–31.12"); // оба конца в одном году — без года
    expect(comparisonPeriod(rangePeriod("2027-01-05", "2027-01-10")).label).toBe("за 30.12.2026–04.01.2027");
    expect(comparisonPeriod(rangePeriod("2026-10-02", "2026-10-02")).label).toBe("за 01.10");
    // через 29.02
    expect(comparisonPeriod(rangePeriod("2028-03-01", "2028-03-02")).label).toBe("за 28.02–29.02");
  });
});

describe("parseRunDate", () => {
  // Вс 27.09.2026, 12:00 МСК
  const SUN = msk("2026-09-27T12:00:00");
  const run = (t: string, now = SUN) => parseRunDate(t, now);
  const date = (ymd: string) => ({ kind: "date", ymd });

  it("числовые даты и «3 октября»", () => {
    expect(run("03.10")).toEqual(date("2026-10-03"));
    expect(run("3.10")).toEqual(date("2026-10-03"));
    expect(run("3 октября")).toEqual(date("2026-10-03"));
    expect(run("сколько записалось на 03.10?")).toEqual(date("2026-10-03"));
    expect(run("кто ведёт 10.10")).toEqual(date("2026-10-10"));
    expect(run("забег 20.09")).toEqual(date("2026-09-20"));
    expect(run("03.10.2025")).toEqual(date("2025-10-03"));
    expect(run("3 октября 2025")).toEqual(date("2025-10-03"));
  });

  it("год — ближайший к сегодня", () => {
    expect(run("03.10", msk("2026-09-28T10:00:00"))).toEqual(date("2026-10-03"));
    expect(run("20.12", msk("2027-01-10T10:00:00"))).toEqual(date("2026-12-20"));
    expect(run("05.01", msk("2026-12-20T10:00:00"))).toEqual(date("2027-01-05"));
    expect(run("29.02", msk("2027-12-01T10:00:00"))).toEqual(date("2028-02-29"));
    expect(run("29.02", msk("2026-09-27T10:00:00"))).toBeNull(); // до ближайшего 29.02 больше полугода
  });

  it("время «10.30» — не дата, но следующая дата во фразе находится", () => {
    expect(run("в 10.30")).toBeNull();
    expect(run("в 10.30 на 03.10")).toEqual(date("2026-10-03"));
  });

  it("сегодня, завтра, послезавтра", () => {
    expect(run("сегодня")).toEqual(date("2026-09-27"));
    expect(run("заявки на завтра")).toEqual(date("2026-09-28"));
    expect(run("послезавтра")).toEqual(date("2026-09-29"));
    expect(run("завтрак")).toBeNull();
    // Граница суток: 20:59 и 21:00 UTC
    expect(run("сегодня", new Date("2026-09-30T20:59:00Z"))).toEqual(date("2026-09-30"));
    expect(run("сегодня", new Date("2026-09-30T21:00:00Z"))).toEqual(date("2026-10-01"));
    expect(run("завтра", new Date("2026-12-31T21:00:00Z"))).toEqual(date("2027-01-02"));
  });

  it("дни недели во всех формах — ближайший, включая сегодня", () => {
    // SUN — воскресенье 27.09; ближайшие: пн 28 … сб 03.10, вс — сегодня
    const cases: Array<[string, string]> = [
      ["понедельник", "2026-09-28"],
      ["в понедельник", "2026-09-28"],
      ["пн", "2026-09-28"],
      ["вторник", "2026-09-29"],
      ["во вторник", "2026-09-29"],
      ["вт", "2026-09-29"],
      ["среда", "2026-09-30"],
      ["в среду", "2026-09-30"],
      ["ср", "2026-09-30"],
      ["четверг", "2026-10-01"],
      ["в четверг", "2026-10-01"],
      ["чт", "2026-10-01"],
      ["пятница", "2026-10-02"],
      ["в пятницу", "2026-10-02"],
      ["пт", "2026-10-02"],
      ["суббота", "2026-10-03"],
      ["в субботу", "2026-10-03"],
      ["сб", "2026-10-03"],
      ["воскресенье", "2026-09-27"],
      ["в воскресенье", "2026-09-27"],
      ["вс", "2026-09-27"],
    ];
    for (const [t, ymd] of cases) expect(run(t), t).toEqual(date(ymd));
  });

  it("«суббота» в субботу — сегодня, даже в 23:59 и в 00:00", () => {
    expect(run("лужники суббота", msk("2026-10-03T10:00:00"))).toEqual(date("2026-10-03"));
    expect(run("суббота", new Date("2026-10-03T20:59:00Z"))).toEqual(date("2026-10-03"));
    // 21:00 UTC сб — уже вс по Москве: ближайшая суббота через неделю
    expect(run("суббота", new Date("2026-10-03T21:00:00Z"))).toEqual(date("2026-10-10"));
    // 21:00 UTC пт — уже суббота по Москве
    expect(run("в субботу", new Date("2026-10-02T21:00:00Z"))).toEqual(date("2026-10-03"));
  });

  it("«прошлую субботу» — последняя прошедшая, не сегодняшняя", () => {
    expect(run("в прошлую субботу", msk("2026-10-03T10:00:00"))).toEqual(date("2026-09-26"));
    expect(run("прошлая суббота", SUN)).toEqual(date("2026-09-26"));
    expect(run("прошлый понедельник", SUN)).toEqual(date("2026-09-21"));
  });

  it("ближайший и прошлый забег", () => {
    for (const t of ["ближайший", "заявки на ближайший", "ближайшую", "следующий забег"]) {
      expect(run(t), t).toEqual({ kind: "nearest" });
    }
    for (const t of ["прошлый", "прошлую", "последний", "как прошёл последний забег"]) {
      expect(run(t), t).toEqual({ kind: "previous" });
    }
  });

  it("не дата забега — null", () => {
    for (const t of [
      "3 дня",
      "за 3 дня",
      "прошлая неделя",
      "соцсети на прошлой неделе",
      "последние 7 дней",
      "ближайшие 7 дней",
      "следующая неделя",
      "в прошлом месяце",
      "оплаты с 01.10 по 07.10",
      "с 1 по 7 октября",
      "за октябрь",
      "переходы по IGST-0310",
      "вчера",
      "привет",
      "",
    ]) {
      expect(run(t), t).toBeNull();
    }
  });
});
