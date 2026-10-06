import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoffeeRun } from "../coffeerun/run";
import { MemoryFactStore, attendanceAsksDue, dispatchAttendanceAsks, parseAttended, saveAttendance } from "./attendance";
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

describe("когда спрашивать о явке", () => {
  it("через 3 часа после начала, ответственному", () => {
    expect(attendanceAsksDue([event({})], new Map(), msk("2026-10-13T21:59"), [], [9])).toEqual([]);
    expect(attendanceAsksDue([event({})], new Map(), msk("2026-10-13T22:00"), [], [9]))
      .toEqual([{ key: "event:1", title: "Интервалы", to: [5] }]);
  });

  it("без ответственного — фаундерам; у кофе-рана ответственного нет — тоже фаундерам", () => {
    const due = attendanceAsksDue([event({ responsible_chat_id: null })], new Map(), msk("2026-10-13T22:00"), [run], [9, 10]);
    expect(due).toEqual([
      { key: "event:1", title: "Интервалы", to: [9, 10] },
      { key: "coffeerun:luzhniki:2026-10-13", title: "Кофе-ран Лужники, 13.10", to: [9, 10] },
    ]);
  });

  it("не спрашивает, если явка уже внесена, ивент не клубный, отменён или давно прошёл", () => {
    const now = msk("2026-10-13T22:00");
    expect(attendanceAsksDue([event({})], new Map([["event:1", 12]]), now, [], [9])).toEqual([]);
    expect(attendanceAsksDue([event({ kind: "meeting", club: null })], new Map(), now, [], [9])).toEqual([]);
    expect(attendanceAsksDue([event({ cancelled_at: "x" })], new Map(), now, [], [9])).toEqual([]);
    expect(attendanceAsksDue([event({})], new Map(), msk("2026-10-20T22:00"), [], [9])).toEqual([]);
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

  it("без ответственного — фаундерам", async () => {
    await events.create({ kind: "club_event", club: "run", title: "Интервалы", starts_at: msk("2026-10-13T19:00").toISOString(),
      place: null, responsible_chat_id: null, created_by: 1 }, msk("2026-10-10T12:00"));
    await dispatchAttendanceAsks(deps(), msk("2026-10-13T22:05"));
    expect(sent.map((s) => s.chat)).toContain(9);
    expect(sent.map((s) => s.chat)).not.toContain(1);
  });
});

describe("права на явку", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("внести может любой, исправить уже внесённую — только фаундер", async () => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "9");
    const store = new MemoryFactStore();
    const now = msk("2026-10-13T22:00");
    expect(await saveAttendance(store, "event:1", "17", 3, now)).toEqual({ status: "saved", attended: 17 });
    expect(await saveAttendance(store, "event:1", "20", 4, now)).toEqual({ status: "exists", attended: 17 });
    expect((await store.get("event:1"))?.attended).toBe(17);
    expect(await saveAttendance(store, "event:1", "пришло 21", 9, now)).toEqual({ status: "saved", attended: 21 });
    expect((await store.get("event:1"))?.entered_by).toBe(9);
  });

  it("число из сообщения: одно, от 0 до 10 000", () => {
    expect(parseAttended("17")).toBe(17);
    expect(parseAttended("пришло 0")).toBe(0);
    expect(parseAttended("много")).toBeNull();
    expect(parseAttended("12 и 15")).toBeNull();
    expect(parseAttended("99999")).toBeNull();
  });
});
