import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoffeeRun } from "../coffeerun/run";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { MemoryFactStore, attendanceAsksDue, attendanceNoticeText, dispatchAttendanceAsks, parseAttended, saveAttendance, canFixAttendance } from "./attendance";
import { handleEventsUpdate, type EventsDeps } from "./ivents";
import { openTeamForm } from "./form";
import { MemoryEventStore, type TeamEvent } from "./events";
import { MemoryTeamForms } from "./form";

const msk = (local: string) => new Date(`${local}+03:00`);
const event = (patch: Partial<TeamEvent>): TeamEvent => ({
  id: 1, kind: "club_event", club: "run", title: "Интервалы", starts_at: msk("2026-10-13T19:00").toISOString(), place: null,
  notes: null, responsible_chat_id: 5, created_by: 1, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
  cancelled_at: null, ...patch,
});
const run: CoffeeRun = {
  spot: "luzhniki", landing: "/coffeerunluzhniki", spotName: "Surf Coffee® Лужники", date: "2026-10-13", dateLabel: "13 октября",
  weekday: "вторник", gatherTime: "9:30", startTime: "10:00", address: "Москва", place: "спот", distance: "5 км", mapUrl: "x",
};

describe("когда и кого спрашивать о явке", () => {
  it("через 3 часа после начала, ответственному", () => {
    expect(attendanceAsksDue([event({})], new Map(), msk("2026-10-13T21:59"))).toEqual([]);
    expect(attendanceAsksDue([event({})], new Map(), msk("2026-10-13T22:00")))
      .toEqual([{ key: "event:1", title: "Интервалы", to: [5] }]);
  });

  it("без ответственного — автору события; фаундерам вопрос не уходит", () => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "9,10");
    const due = attendanceAsksDue([event({ responsible_chat_id: null, created_by: 3 })], new Map(), msk("2026-10-13T22:00"));
    expect(due).toEqual([{ key: "event:1", title: "Интервалы", to: [3] }]);
    expect(due.flatMap((d) => d.to)).not.toContain(9);
    vi.unstubAllEnvs();
  });

  it("не спрашивает, если явка уже внесена, ивент не клубный, отменён или давно прошёл", () => {
    const now = msk("2026-10-13T22:00");
    expect(attendanceAsksDue([event({})], new Map([["event:1", 12]]), now)).toEqual([]);
    expect(attendanceAsksDue([event({ kind: "meeting", club: null })], new Map(), now)).toEqual([]);
    expect(attendanceAsksDue([event({ cancelled_at: "x" })], new Map(), now)).toEqual([]);
    expect(attendanceAsksDue([event({})], new Map(), msk("2026-10-20T22:00"))).toEqual([]);
  });
});

describe("вопрос о явке", () => {
  let events: MemoryEventStore;
  let facts: MemoryFactStore;
  let forms: MemoryTeamForms;
  let sent: Array<{ chat: number; text: string }>;
  const deps = () => ({ events, facts, forms, send: async (chat: number, text: string) => (sent.push({ chat, text }), { ok: true }) });

  beforeEach(async () => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "9");
    events = new MemoryEventStore();
    facts = new MemoryFactStore();
    forms = new MemoryTeamForms();
    sent = [];
  });
  afterEach(() => vi.unstubAllEnvs());

  it("уходит один раз ответственному и ждёт число следующим сообщением", async () => {
    await events.create({ kind: "club_event", club: "run", title: "Интервалы", starts_at: msk("2026-10-13T19:00").toISOString(),
      place: null, responsible_chat_id: 5, created_by: 1 }, msk("2026-10-10T12:00"));
    await dispatchAttendanceAsks(deps(), msk("2026-10-13T22:05"));
    await dispatchAttendanceAsks(deps(), msk("2026-10-13T22:20"));
    expect(sent).toEqual([{ chat: 5, text: "Сколько человек пришло на «Интервалы»? Пришли число следующим сообщением." }]);
    expect((await forms.get(5))?.params).toEqual({ key: "event:1", title: "Интервалы" });
  });

  it("без ответственного — автору, фаундеру нет", async () => {
    await events.create({ kind: "club_event", club: "run", title: "Интервалы", starts_at: msk("2026-10-13T19:00").toISOString(),
      place: null, responsible_chat_id: null, created_by: 3 }, msk("2026-10-10T12:00"));
    await dispatchAttendanceAsks(deps(), msk("2026-10-13T22:05"));
    expect(sent.map((s) => s.chat)).toEqual([3]);
  });
});

describe("уведомление фаундерам о явке", () => {
  const NOW = msk("2026-10-13T22:30");
  let events: MemoryEventStore;
  let facts: MemoryFactStore;
  let forms: MemoryTeamForms;
  let sent: Array<{ chat: number; text: string; buttons: string[] }>;
  let send: (text: string, from: number) => Promise<void>;
  let press: (data: string, from: number) => Promise<void>;
  let clock: Date;
  const team = [3, 4, 9, 10].map((id) => ({ chat_id: id, username: id === 3 ? "salma" : id === 4 ? "danya" : `f${id}`, display_name: null, role: "member" as const,
    joined_at: NOW.toISOString(), added_by: null, last_seen_at: null, digest_opt_in: true }));

  beforeEach(async () => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "9,10");
    events = new MemoryEventStore();
    facts = new MemoryFactStore();
    forms = new MemoryTeamForms();
    sent = [];
    await events.create({ kind: "club_event", club: "run", title: "Интервалы", starts_at: msk("2026-10-11T10:00").toISOString(),
      place: null, responsible_chat_id: 3, created_by: 9 }, msk("2026-10-01T12:00"));
    const deps: EventsDeps = {
      events, facts, forms, fetchArchive: async () => [], fetchSignups: async () => [],
      findMember: async (id) => team.find((m) => m.chat_id === id) ?? null, listTeam: async () => team,
    };
    const bot = new Bot("1:x", { botInfo: { id: 1, is_bot: true, first_name: "П", username: "t_bot" } as UserFromGetMe });
    bot.api.config.use(async (_prev, method, payload) => {
      const p = payload as { chat_id: number; text: string; reply_markup?: { inline_keyboard?: Array<Array<{ text: string }>> } };
      if (method === "sendMessage" || method === "editMessageText")
        sent.push({ chat: p.chat_id, text: String(p.text), buttons: (p.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.text) });
      return { ok: true, result: true } as never;
    });
    clock = NOW;
    bot.use((ctx) => handleEventsUpdate(ctx, deps, clock).then(() => {}));
    let id = 0;
    press = async (data, from) => {
      await bot.handleUpdate({ update_id: ++id, callback_query: { id: `c${id}`, chat_instance: "x", data, from: { id: from, is_bot: false, first_name: "x" },
        message: { message_id: 1, date: 1, text: "x", chat: { id: from, type: "private", first_name: "x" } } } } as Update);
    };
    send = async (text, from) => {
      await bot.handleUpdate({ update_id: ++id, message: { message_id: id, date: 1, text,
        chat: { id: from, type: "private", first_name: "x" }, from: { id: from, is_bot: false, first_name: "x" } } } as Update);
    };
  });
  afterEach(() => vi.unstubAllEnvs());

  it("внёсший явку исправляет её и через месяц: кнопка «Исправить явку» у прошедшего ивента; другим участникам — нет", async () => {
    const ev = [...events.events.values()][0];
    await press(`ie:ae:${ev.id}`, 3);
    await send("17", 3);
    expect((await facts.get(`event:${ev.id}`))?.attended).toBe(17);
    clock = msk("2026-11-20T12:00");
    sent = [];
    await press(`ie:e:${ev.id}`, 4);
    expect(sent.at(-1)!.buttons).not.toContain("Исправить явку");
    await press(`ie:ae:${ev.id}`, 4);
    expect(sent.at(-1)!.text).toBe("Явку уже внесли: 17. Исправить могут фаундеры и тот, кто её внёс.");
    await press(`ie:e:${ev.id}`, 3);
    expect(sent.at(-1)!.buttons).toContain("Исправить явку");
    await press(`ie:ae:${ev.id}`, 3);
    expect(sent.at(-1)!.text).toContain("Сейчас записано: 17.");
    await send("19", 3);
    expect((await facts.get(`event:${ev.id}`))?.attended).toBe(19);
    expect(sent.filter((s) => s.chat === 9 && /исправлено, было 17/.test(s.text))).toHaveLength(1);
  });

  it("после внесения каждый фаундер получает ровно одно уведомление", async () => {
    await forms.set(3, openTeamForm("attend", { key: "event:1", title: "Интервалы" }, NOW));
    await send("17", 3);
    const notes = sent.filter((s) => s.text.startsWith("✅ Явка внесена"));
    expect(notes.map((s) => s.chat).sort((a, b) => a - b)).toEqual([9, 10]);
    expect(notes[0].text).toBe("✅ Явка внесена · Интервалы, вс 11.10 · пришло 17 · от @salma");
  });

  it("исправление фаундером — другим фаундерам с пометкой «исправлено, было …»", async () => {
    await facts.save("event:1", 15, 3, NOW, false);
    await forms.set(9, openTeamForm("attend", { key: "event:1", title: "Интервалы" }, NOW));
    await send("17", 9);
    const notes = sent.filter((s) => s.text.startsWith("✅ Явка внесена"));
    expect(notes.map((s) => s.chat)).toEqual([10]);
    expect(notes[0].text).toContain("пришло 17 · исправлено, было 15 · от @f9");
  });

  it("текст для кофе-рана с заявками", () => {
    expect(attendanceNoticeText({ title: "Кофе-ран · Усачёва", day: "вс 11.10", attended: 17, total: 23, previous: null, by: "@salma" }))
      .toBe("✅ Явка внесена · Кофе-ран · Усачёва, вс 11.10 · пришло 17 из 23 заявок · от @salma");
  });
});

describe("права на явку", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("внести может любой; исправить — фаундер и тот, кто внёс, даже спустя месяц; остальные — нет", async () => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "9");
    const store = new MemoryFactStore();
    const now = msk("2026-10-13T22:00");
    expect(await saveAttendance(store, "event:1", "17", 3, now)).toEqual({ status: "saved", attended: 17, previous: null });
    expect(await saveAttendance(store, "event:1", "20", 4, now)).toEqual({ status: "exists", attended: 17 });
    expect((await store.get("event:1"))?.attended).toBe(17);
    // Внёсший исправляет свою явку и через месяц.
    expect(await saveAttendance(store, "event:1", "18", 3, msk("2026-11-15T12:00"))).toEqual({ status: "saved", attended: 18, previous: 17 });
    expect(await saveAttendance(store, "event:1", "пришло 21", 9, now)).toEqual({ status: "saved", attended: 21, previous: 18 });
    // После правки фаундером автор явки прежний: он по-прежнему может исправить.
    expect((await store.get("event:1"))?.entered_by).toBe(3);
    expect(await saveAttendance(store, "event:1", "22", 3, now)).toEqual({ status: "saved", attended: 22, previous: 21 });
    expect(canFixAttendance(await store.get("event:1"), 4)).toBe(false);
    expect(canFixAttendance(await store.get("event:1"), 3)).toBe(true);
  });

  it("число из сообщения: одно, от 0 до 10 000", () => {
    expect(parseAttended("17")).toBe(17);
    expect(parseAttended("пришло 0")).toBe(0);
    expect(parseAttended("много")).toBeNull();
    expect(parseAttended("12 и 15")).toBeNull();
    expect(parseAttended("99999")).toBeNull();
  });
});
