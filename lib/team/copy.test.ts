import { describe, it, expect } from "vitest";
import type { CoffeeRun } from "../coffeerun/run";
import {
  contactsText,
  dynamicsLines,
  historyText,
  mskDateTime,
  mskTime,
  parseTeamCallback,
  remindersText,
  rosterText,
  runCallback,
  runCardText,
  runsOverviewText,
  runSummaryLine,
} from "./copy";
import type { TeamRun } from "./runs";
import type { RunAggregate } from "./history";
import { summarizeSignups, viewSignups, type SignupRow } from "./stats";

const SCHEDULED: CoffeeRun = {
  spot: "luzhniki",
  landing: "/coffeerunluzhniki",
  spotName: "Surf Coffee® Лужники",
  date: "2026-09-20",
  dateLabel: "20 сентября",
  weekday: "воскресенье",
  gatherTime: "9:30",
  startTime: "10:00",
  address: "Москва, ул. Лужники, 24, стр. 41",
  place: "спот Surf Coffee Лужники",
  distance: "5 км",
  mapUrl: "https://maps.example/luzhniki",
};

/** Ближайший забег: он есть в расписании, значит знает время и адрес. */
const LUZH: TeamRun = {
  spot: "luzhniki",
  date: "2026-09-20",
  label: "Surf Coffee® Лужники, 20 сентября",
  scheduled: SCHEDULED,
  past: false,
};

/** Прошедший: из расписания его убрали, остались только заявки в базе. */
const LUZH_PAST: TeamRun = {
  spot: "luzhniki",
  date: "2026-09-13",
  label: "Surf Coffee® Лужники, 13 сентября",
  scheduled: null,
  past: true,
};

const USACH: TeamRun = {
  spot: "usachevo",
  date: "2026-09-19",
  label: "Surf Coffee® × Sport, Усачёва, 19 сентября",
  scheduled: { ...SCHEDULED, spot: "usachevo", date: "2026-09-19", address: "Москва, ул. Усачёва, 62" },
  past: false,
};

const RUNS = [LUZH, USACH, LUZH_PAST];
const NOW = new Date("2026-09-18T12:00:00Z");

function row(over: Partial<SignupRow> = {}): SignupRow {
  return {
    name: "Аня",
    contact: "+7 999 000-00-00",
    pace: null,
    created_at: "2026-09-10T09:00:00Z",
    confirmed_at: null,
    reminder_sent_at: null,
    tg_username: "anya",
    tg_chat_id: null,
    ...over,
  };
}

function agg(over: Partial<RunAggregate> = {}): RunAggregate {
  return {
    spot: "luzhniki",
    date: "2026-09-20",
    total: 10,
    confirmed: 9,
    reminded: 0,
    firstSignupAt: "2026-09-14T09:00:00Z",
    lastSignupAt: "2026-09-18T09:00:00Z",
    ...over,
  };
}

describe("время по Москве", () => {
  it("показывает московское время, а не UTC сервера", () => {
    // 07:00 UTC = 10:00 МСК. Если сводка покажет 07:00, команда решит, что
    // рассылка ушла на три часа раньше окна.
    expect(mskTime("2026-09-18T07:00:00Z")).toBe("10:00");
    expect(mskDateTime("2026-09-18T07:00:00Z")).toContain("10:00");
    expect(mskDateTime("2026-09-18T07:00:00Z")).toContain("18 сентября");
  });

  it("пустое и битое время — прочерк, а не Invalid Date в сообщении", () => {
    expect(mskTime(null)).toBe("—");
    expect(mskDateTime("не время")).toBe("—");
  });
});

describe("callback кнопок", () => {
  it("данные умещаются в лимит Telegram (64 байта)", () => {
    expect(Buffer.byteLength(runCallback("rem", LUZH), "utf8")).toBeLessThanOrEqual(64);
  });

  it("разбирается обратно в тот же забег", () => {
    expect(parseTeamCallback(runCallback("who", USACH), RUNS)).toEqual({
      kind: "who",
      run: USACH,
    });
  });

  it("кнопка без забега (общий список, история) разбирается тоже", () => {
    expect(parseTeamCallback(runCallback("all"), RUNS)).toEqual({ kind: "all", run: null });
    expect(parseTeamCallback(runCallback("his"), RUNS)).toEqual({ kind: "his", run: null });
  });

  it("кнопка ведёт и в прошедший забег — история открывается теми же экранами", () => {
    expect(parseTeamCallback(runCallback("con", LUZH_PAST), RUNS)?.run).toBe(LUZH_PAST);
  });

  it("забег, о котором не знает даже база → run: null", () => {
    expect(parseTeamCallback("trun:sokolniki:2020-01-01", RUNS)).toEqual({
      kind: "run",
      run: null,
    });
  });

  it("чужие данные не трогаем — их разберёт основной бот", () => {
    expect(parseTeamCallback("rc_go_2026-09-19_10:00", RUNS)).toBeNull();
    expect(parseTeamCallback("optin_yes", RUNS)).toBeNull();
  });
});

describe("карточка забега", () => {
  const rows = [
    row({ name: "Первый", reminder_sent_at: "2026-09-18T07:00:00Z", pace: "6:30" }),
    row({ name: "Второй", confirmed_at: "2026-09-11T10:00:00Z", tg_chat_id: 7, pace: "7:00" }),
    row({ name: "Третий" }),
  ];

  it("называет все четыре цифры воронки", () => {
    const text = runCardText(LUZH, summarizeSignups(rows, NOW), 42, null, NOW);
    expect(text).toContain("Заявок: 3");
    expect(text).toContain("Подтвердили в боте: 2");
    expect(text).toContain("Напоминание ушло: 1");
    expect(text).toContain("Не подтвердились: 1");
    expect(text).toContain("Приглашений разослано: 42");
  });

  it("про неподтвердившихся говорит прямым текстом — это и есть главная строка", () => {
    const text = runCardText(LUZH, summarizeSignups(rows, NOW), 0, null, NOW);
    expect(text).toContain("не дойдёт ни напоминание, ни перенос, ни отмена");
  });

  it("когда все подтвердились — не пугает предупреждением", () => {
    const ok = [row({ confirmed_at: "2026-09-11T10:00:00Z", tg_chat_id: 7 })];
    expect(runCardText(LUZH, summarizeSignups(ok, NOW), 0, null, NOW)).not.toContain("⚠️");
  });

  it("если напоминаний ещё нет — сам объясняет, когда они уйдут", () => {
    const text = runCardText(LUZH, summarizeSignups([row()], NOW), 0, null, NOW);
    expect(text).toContain("2026-09-19"); // накануне забега 20-го
    expect(text).toContain("10:00 МСК");
  });

  it("у прошедшего забега не выдумывает время и адрес", () => {
    // Записи в расписании больше нет, и «сбор в 9:30» здесь был бы не фактом,
    // а привычкой автора кода.
    const text = runCardText(LUZH_PAST, summarizeSignups([row()], NOW), 0, null, NOW);
    expect(text).toContain("Забег прошёл");
    expect(text).not.toContain("сбор");
    expect(text).not.toContain("Дистанция");
  });
});

describe("динамика набора", () => {
  it("сравнивает с той же точкой отсчёта и называет обе цифры прошлого забега", () => {
    const lines = dynamicsLines({
      daysBefore: 5,
      now: 10,
      previous: [
        { date: "2026-09-13", atSameLead: 12, final: 37, opened: true },
        { date: "2026-09-06", atSameLead: 9, final: 39, opened: true },
      ],
      typical: 11,
      comparable: 2,
    });
    const text = lines.join("\n");
    expect(text).toContain("За 5 дней до старта");
    expect(text).toContain("сейчас — 10");
    // Обе цифры рядом: «было 12» отвечает на вопрос о темпе, «в итоге 37» —
    // о том, куда это приедет.
    expect(text).toContain("13 сентября — было 12, в итоге 37");
  });

  it("выносит вердикт словами, а не заставляет вычитать в уме", () => {
    const ahead = dynamicsLines({
      daysBefore: 3,
      now: 20,
      previous: [{ date: "2026-09-13", atSameLead: 12, final: 37, opened: true }],
      typical: 12,
      comparable: 2,
    }).join("\n");
    expect(ahead).toContain("на 8 больше, чем обычно");

    const behind = dynamicsLines({
      daysBefore: 3,
      now: 4,
      previous: [{ date: "2026-09-13", atSameLead: 12, final: 37, opened: true }],
      typical: 12,
      comparable: 2,
    }).join("\n");
    expect(behind).toContain("на 8 меньше, чем обычно");

    const same = dynamicsLines({
      daysBefore: 3,
      now: 12,
      previous: [{ date: "2026-09-13", atSameLead: 12, final: 37, opened: true }],
      typical: 12,
      comparable: 2,
    }).join("\n");
    expect(same).toContain("столько же");
  });

  it("забег без открытой записи показан словами, а не нулём", () => {
    // Ноль читается как «людей не было». Было — «не звали», и это другое.
    const text = dynamicsLines({
      daysBefore: 6,
      now: 10,
      previous: [{ date: "2026-09-13", atSameLead: 0, final: 37, opened: false }],
      typical: null,
      comparable: 0,
    }).join("\n");
    expect(text).toContain("13 сентября — записи ещё не открывали, в итоге 37");
    expect(text).not.toContain("было 0");
    // И никакого бодрого вердикта: сравнивать не с чем, так и говорим.
    expect(text).toContain("сравнить не с чем");
  });

  it("одно наблюдение — это «в прошлый раз», а не «обычно»", () => {
    // Слово «обычно» поверх единственного числа придаёт ему вес нормы,
    // которой оно не является.
    const text = dynamicsLines({
      daysBefore: 6,
      now: 10,
      previous: [{ date: "2026-09-06", atSameLead: 2, final: 39, opened: true }],
      typical: 2,
      comparable: 1,
    }).join("\n");
    expect(text).toContain("в прошлый сравнимый раз");
    expect(text).not.toContain("обычно");
  });

  it("не говорит «за 1 дней»", () => {
    const one = dynamicsLines({ daysBefore: 1, now: 5, previous: [], typical: null, comparable: 0 }).join("\n");
    const two = dynamicsLines({ daysBefore: 2, now: 5, previous: [], typical: null, comparable: 0 }).join("\n");
    const five = dynamicsLines({ daysBefore: 5, now: 5, previous: [], typical: null, comparable: 0 }).join("\n");
    expect(one).toContain("За 1 день до старта");
    expect(two).toContain("За 2 дня до старта");
    expect(five).toContain("За 5 дней до старта");
  });

  it("попадает в карточку забега целиком", () => {
    const text = runCardText(LUZH, summarizeSignups([row()], NOW), 0, {
      daysBefore: 2,
      now: 10,
      previous: [{ date: "2026-09-13", atSameLead: 12, final: 37, opened: true }],
      typical: 12,
      comparable: 2,
    }, NOW);
    expect(text).toContain("За 2 дня до старта");
    expect(text).toContain("в итоге 37");
  });
});

describe("списки людей", () => {
  const views = viewSignups([
    row({ name: "Напомнили", tg_username: "one", reminder_sent_at: "2026-09-18T07:00:00Z" }),
    row({ name: "Ждёт", tg_username: "two", confirmed_at: "2026-09-11T10:00:00Z", tg_chat_id: 2 }),
    row({ name: "Висит", tg_username: null }),
  ]);

  it("/who разводит людей по трём группам с одинаковыми значками", () => {
    const text = rosterText(LUZH, views);
    expect(text).toContain("⚠️ Не подтвердились: 1");
    expect(text).toContain("⏳ Ждут напоминания: 1");
    expect(text).toContain("✅ Напоминание ушло: 1");
    expect(text).toContain("@one");
    // Без ника показываем имя, а не «@null».
    expect(text).toContain("Висит");
    expect(text).not.toContain("@null");
  });

  it("/notif называет время каждого напоминания по Москве", () => {
    const text = remindersText(
      LUZH,
      views,
      summarizeSignups([row({ reminder_sent_at: "2026-09-18T07:00:00Z" })], NOW),
      NOW,
    );
    expect(text).toContain("✅ Напомнили (@one) — 10:00");
    expect(text).toContain("Не уйдёт — не подтвердились в боте: 1");
  });

  it("/contacts предупреждает, что это персональные данные", () => {
    const text = contactsText(LUZH, views);
    expect(text).toContain("Персональные данные");
    expect(text).toContain("+7 999 000-00-00");
  });

  it("пустой забег не притворяется списком", () => {
    expect(rosterText(LUZH, [])).toContain("Заявок пока нет");
    expect(contactsText(LUZH, [])).toContain("Заявок пока нет");
  });

  it("длинный список обрезается с честным хвостом и влезает в сообщение Telegram", () => {
    const many = viewSignups(
      Array.from({ length: 120 }, (_, i) => row({ name: `Бегун ${i}`, tg_username: `run${i}` })),
    );
    const text = rosterText(LUZH, many);
    expect(text).toContain("и ещё 60");
    expect(text.length).toBeLessThan(4096);
  });
});

describe("список забегов и история", () => {
  it("строка забега несёт три цифры, у прошедшего — пометку", () => {
    expect(runSummaryLine(LUZH, agg())).toContain("заявок 10");
    expect(runSummaryLine(LUZH_PAST, agg({ date: "2026-09-13" }))).toContain("прошёл");
    expect(runSummaryLine(LUZH, agg())).not.toContain("прошёл");
  });

  it("пустой список отправляет в историю, а не в тупик", () => {
    expect(runsOverviewText([])).toContain("/history");
  });

  it("история группирует по спотам и считает долю подтвердившихся", () => {
    const text = historyText(
      [
        { run: LUZH_PAST, agg: agg({ date: "2026-09-13", total: 37, confirmed: 37 }) },
        { run: USACH, agg: agg({ spot: "usachevo", date: "2026-09-19", total: 5, confirmed: 4 }) },
      ],
      (s) => (s === "luzhniki" ? "Лужники" : "Усачёва"),
    );
    expect(text).toContain("Лужники — 1 забег, 37 заявок");
    expect(text).toContain("(100%)");
    expect(text).toContain("Усачёва");
    // Будущий забег в истории помечен: его цифры ещё не окончательные.
    expect(text).toContain("(впереди)");
  });

  it("пустая база не притворяется историей", () => {
    expect(historyText([], (s) => s)).toContain("нет ни одной заявки");
  });
});

