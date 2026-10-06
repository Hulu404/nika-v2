import { describe, it, expect } from "vitest";
import type { CoffeeRun } from "../coffeerun/run";
import {
  clubEventScreen,
  coffeeRunScreen,
  dynamicsLines,
  dynamicsOneLine,
  iventCb,
  iventsScreen,
  mskDateTime,
  mskTime,
  participantsText,
  pastIventsScreen,
  remindersText,
  type IventItem,
} from "./copy";
import type { TeamRun } from "./runs";
import type { RunAggregate } from "./history";
import type { TeamEvent } from "./events";
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

});

const ev = (over: Partial<TeamEvent> = {}): TeamEvent => ({
  id: 7, kind: "club_event", club: "run", title: "Интервалы", starts_at: "2026-09-19T05:00:00Z", place: "Лужники",
  notes: null, responsible_chat_id: null, created_by: 1, created_at: "2026-09-10T09:00:00Z",
  updated_at: "2026-09-10T09:00:00Z", cancelled_at: null, ...over,
});

describe("кнопки ивентов", () => {
  it("callback_data умещаются в лимит Telegram (64 байта)", () => {
    for (const data of [iventCb.people("usachevo", "2026-10-04"), iventCb.attendRun("usachevo", "2026-10-04"), iventCb.claim(123456789), iventCb.past(12)])
      expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
  });
});

describe("экран кофе-рана", () => {
  const rows = [
    row({ name: "Первый", reminder_sent_at: "2026-09-18T07:00:00Z", pace: "6:30" }),
    row({ name: "Второй", confirmed_at: "2026-09-11T10:00:00Z", tg_chat_id: 7, pace: "7:00" }),
    row({ name: "Третий" }),
  ];

  it("шапка и цифры в 2–3 строки, динамика одной строкой", () => {
    const dyn = { daysBefore: 2, now: 3, previous: [{ date: "2026-09-13", atSameLead: 2, final: 37, opened: true }], typical: 2, comparable: 1 };
    const { text, keyboard } = coffeeRunScreen(LUZH, summarizeSignups(rows, NOW), dyn, null);
    expect(text).toContain("<b>Кофе-ран Лужники</b>");
    expect(text).toContain("🏃 Беговой клуб");
    expect(text).toContain("Вс 20.09, 10:00 (сбор 9:30)");
    expect(text).toContain("Заявок 3 · подтвердились 2");
    expect(text).toContain("⚠️ Не подтвердились 1 · напоминание ушло 1");
    expect(text).toContain("За 2 дня до старта: 3, в прошлый сравнимый раз 2");
    expect(text).not.toContain("Явка");
    expect(keyboard.inline_keyboard.flat().map((b) => b.text)).toEqual(["Участники", "Рассылка", "← К ивентам"]);
  });

  it("у прошедшего — явка в шапке, без времени и адреса", () => {
    const past = coffeeRunScreen(LUZH_PAST, summarizeSignups(rows, NOW), null, 2, true);
    expect(past.text).toContain("Пришло: 2 из 3 заявок");
    expect(past.text).not.toContain("сбор");
    const none = coffeeRunScreen(LUZH_PAST, summarizeSignups(rows, NOW), null, null, true);
    expect(none.text).toContain("Явка не внесена");
    expect(none.keyboard.inline_keyboard.flat().map((b) => b.text)).toContain("Внести явку");
  });
});

describe("экран ивента без записи через сайт", () => {
  it("рендерится без цифр: клуб, время, ответственный и «Я ответственный»", () => {
    const { text, keyboard } = clubEventScreen(ev(), new Map(), { past: false, canManage: false });
    expect(text).toContain("<b>Интервалы</b>");
    expect(text).toContain("🏃 Беговой клуб");
    expect(text).toContain("Ответственный: не назначен");
    expect(text).not.toContain("Заявок");
    expect(keyboard.inline_keyboard.flat().map((b) => b.text)).toEqual(["Я ответственный", "← К ивентам"]);
  });

  it("прошедший: явка, а ответственный по нику", () => {
    const { text } = clubEventScreen(ev({ responsible_chat_id: 5 }), new Map([[5, "masha"]]), { past: true, fact: 12, canManage: true });
    expect(text).toContain("Ответственный: @masha");
    expect(text).toContain("Пришло: 12");
  });
});

describe("список ивентов", () => {
  it("два ивента разных клубов и кофе-ран в одну неделю", () => {
    const items: IventItem[] = [
      { kind: "event", event: ev({ id: 1, title: "Интервалы", starts_at: "2026-09-19T05:00:00Z" }) },
      { kind: "run", run: LUZH, startsAt: "2026-09-20T07:00:00Z", agg: agg({ total: 23, confirmed: 18 }) },
      { kind: "event", event: ev({ id: 2, club: "book", title: "Книжный клуб", starts_at: "2026-09-23T16:30:00Z", responsible_chat_id: 5 }) },
    ];
    const { text, keyboard } = iventsScreen(items, new Map([[5, "masha"]]));
    expect(text).toContain("🏃 Интервалы · сб 19.09");
    expect(text).toContain("🏃 Кофе-ран Лужники · вс 20.09 · 23 заявки, 18 подтв.");
    expect(text).toContain("Книжный клуб · ср 23.09 · отв. @masha");
    expect(keyboard.inline_keyboard.flat().map((b) => (b as { callback_data?: string }).callback_data)).toEqual(["ie:e:1", "ie:r:luzhniki:2026-09-20", "ie:e:2", "ie:p:0"]);
  });

  it("пусто: «Ближайших ивентов нет», «Прошедшие» и «Добавить событие»", () => {
    const { text, keyboard } = iventsScreen([], new Map());
    expect(text).toContain("Ближайших ивентов нет");
    expect(keyboard.inline_keyboard.flat().map((b) => b.text)).toEqual(["Прошедшие", "Добавить событие"]);
  });

  it("прошедшие по 10 на страницу, от новых к старым, с явкой", () => {
    const items: IventItem[] = Array.from({ length: 12 }, (_, i) => ({
      kind: "run" as const, run: { ...LUZH_PAST, date: `2026-08-${String(30 - i).padStart(2, "0")}` },
      startsAt: `2026-08-${String(30 - i).padStart(2, "0")}T07:00:00Z`, agg: agg({ total: 31 }), fact: i === 0 ? 22 : null,
    }));
    const first = pastIventsScreen(items, 0);
    expect(first.text).toContain("Кофе-ран Лужники · 30.08 · заявок 31, пришло 22");
    expect(first.text).toContain("Кофе-ран Лужники · 29.08 · заявок 31, явка не внесена");
    expect(first.text).not.toContain("19.08");
    expect(first.keyboard.inline_keyboard.flat().map((b) => b.text)).toContain("Ещё");
    expect(pastIventsScreen(items, 1).text).toContain("19.08");
  });

  it("динамика одной строкой: «обычно» только при нескольких сравнимых", () => {
    expect(dynamicsOneLine({ daysBefore: 3, now: 15, previous: [], typical: 12, comparable: 2 })).toBe("За 3 дня до старта: 15, обычно к этому дню 12");
    expect(dynamicsOneLine({ daysBefore: 1, now: 5, previous: [], typical: null, comparable: 0 })).toBe("За 1 день до старта: 5, сравнить не с чем");
  });
});

describe("участники и рассылка кофе-рана", () => {
  const views = viewSignups([
    row({ name: "Напомнили", tg_username: "one", reminder_sent_at: "2026-09-18T07:00:00Z" }),
    row({ name: "Ждёт", tg_username: "two", confirmed_at: "2026-09-11T10:00:00Z", tg_chat_id: 2 }),
    row({ name: "Висит", tg_username: null }),
  ]);

  it("«Участники»: один список со статусом и контактом, неподтверждённые первыми", () => {
    const text = participantsText(LUZH, views);
    expect(text).toContain("Персональные данные");
    const lines = text.split("\n");
    expect(lines.findIndex((l) => l.startsWith("⚠️ Висит"))).toBeLessThan(lines.findIndex((l) => l.startsWith("✅ Напомнили")));
    expect(text).toContain("⚠️ Висит — +7 999 000-00-00");
    expect(text).toContain("✅ Напомнили — +7 999 000-00-00 · @one");
    expect(text).not.toContain("@null");
  });

  it("«Рассылка» называет время каждого напоминания по Москве", () => {
    const text = remindersText(LUZH, views, summarizeSignups([row({ reminder_sent_at: "2026-09-18T07:00:00Z" })], NOW), NOW);
    expect(text).toContain("✅ Напомнили (@one) — 10:00");
    expect(text).toContain("Не уйдёт — не подтвердились в боте: 1");
  });

  it("пустой забег и длинный список", () => {
    expect(participantsText(LUZH, [])).toContain("Заявок пока нет");
    const many = viewSignups(Array.from({ length: 120 }, (_, i) => row({ name: `Бегун ${i}`, tg_username: `run${i}` })));
    const text = participantsText(LUZH, many);
    expect(text).toContain("и ещё 60");
    expect(text.length).toBeLessThan(4096);
  });
});

