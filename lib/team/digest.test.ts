import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../databot/data/memory-store";
import type { TeamMember } from "./access";
import { MemoryParticipantStore } from "./ai/stores";
import { MemoryFactStore } from "./attendance";
import { dispatchTeamDigests, type DigestDispatchDeps } from "./digest";
import { founderCoffeeLines } from "./digest-copy";
import { MemoryEventStore, scopedEvents } from "./events";
import { DEFAULT_PROJECTS } from "./projects/projects";
import { MemoryTeamForms } from "./form";
import { MY_DAY_EMPTY, MY_DAY_FOOTER } from "./my-day";
import type { SignupRow } from "./stats";
import { syncTeamTaskMembers } from "./tasks";

const msk = (local: string) => new Date(`${local}+03:00`);
const signup = (over: Partial<SignupRow>): SignupRow => ({
  name: "Аня", contact: "+7", pace: "6:30", created_at: "2026-10-05T09:00:00Z", confirmed_at: null,
  reminder_sent_at: null, tg_username: null, tg_chat_id: null, ...over,
});
const member = (chat_id: number, username: string, digest_opt_in = true): TeamMember => ({
  chat_id, username, display_name: username, role: "member", joined_at: "2026-10-01T00:00:00Z",
  added_by: null, last_seen_at: null, digest_opt_in,
});

describe("утренняя сводка — «Мой день»", () => {
  let events: MemoryEventStore;
  let participants: MemoryParticipantStore;
  let tasks: MemoryStore;
  let team: TeamMember[];
  let sent: Array<{ chat: number; text: string }>;
  let claimed: Set<string>;
  let signups: SignupRow[];
  let aiEnabled: boolean;
  const deps = (): DigestDispatchDeps => ({
    events, participants, tasks, facts: new MemoryFactStore(), forms: new MemoryTeamForms(), throttleMs: 0, aiEnabled,
    fetchSignups: async () => signups,
    recipients: async () => team.filter((m) => m.digest_opt_in).map((m) => m.chat_id),
    claimDaily: async (ymd) => (claimed.has(ymd) ? false : (claimed.add(ymd), true)),
    markDailySent: async () => {},
    send: async (chat, text) => (sent.push({ chat, text }), { ok: true }),
  });
  const textOf = (chat: number) => sent.find((s) => s.chat === chat)!.text;
  const create = (title: string, local: string, patch: Record<string, unknown> = {}) =>
    events.create({ kind: "meeting", club: null, title, starts_at: msk(local).toISOString(), place: null, responsible_chat_id: null, created_by: 9, ...patch }, msk("2026-10-10T12:00"));

  beforeEach(async () => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "9");
    events = new MemoryEventStore();
    participants = new MemoryParticipantStore();
    tasks = new MemoryStore();
    team = [member(1, "vika"), member(2, "salma"), member(3, "danya", false), member(9, "ali")];
    await syncTeamTaskMembers({ store: tasks }, msk("2026-10-10T12:00"), team);
    sent = [];
    claimed = new Set();
    signups = [];
    aiEnabled = true;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("в 8:00 — каждому своё сообщение, кроме /mute; до 8:00 и повторно — нет", async () => {
    await create("Планёрка", "2026-10-13T19:00", { place: "Zoom" });
    await dispatchTeamDigests({ now: msk("2026-10-13T07:45"), deps: deps() });
    expect(sent).toEqual([]);
    await dispatchTeamDigests({ now: msk("2026-10-13T08:00"), deps: deps() });
    await dispatchTeamDigests({ now: msk("2026-10-13T08:15"), deps: deps() });
    expect(sent.map((s) => s.chat)).toEqual([1, 2, 9]);
    expect(textOf(1)).toBe(["☀️ План на вт 13.10", "", "🗓 События", "- 19:00 Планёрка · Zoom", "", MY_DAY_FOOTER].join("\n"));
  });

  it("пустой день не отправляется", async () => {
    await dispatchTeamDigests({ now: msk("2026-10-13T08:00"), deps: deps() });
    expect(sent).toEqual([]);
    expect(MY_DAY_EMPTY).toBe("На сегодня ничего не запланировано.");
  });

  it("человек в двух проектах — одно сообщение, блоки 🏃 NIKA и 🔬 RESCAN; в одном проекте — без меток", async () => {
    await create("Планёрка", "2026-10-13T19:00", { place: "Zoom" });
    await scopedEvents(events, "rescan").create({ kind: "meeting", club: null, title: "Созвон RESCAN", starts_at: msk("2026-10-13T12:00").toISOString(), place: null, responsible_chat_id: null, created_by: 9 }, msk("2026-10-10T12:00"));
    await tasks.importAssignedTasks(9, 50, [{ line: 1, username: "vika", what: "Макет пациента", due_at: msk("2026-10-13T18:00").toISOString() }], { projectId: "rescan" });
    await dispatchTeamDigests({ now: msk("2026-10-13T08:00"), deps: { ...deps(),
      projectsOf: async (chat) => (chat === 1 ? DEFAULT_PROJECTS.slice() : DEFAULT_PROJECTS.slice(0, 1)),
      eventsFor: (id) => scopedEvents(events, id),
    } });
    expect(sent.filter((s) => s.chat === 1)).toHaveLength(1);
    expect(textOf(1)).toBe([
      "☀️ План на вт 13.10", "",
      "<b>🏃 NIKA</b>", "🗓 События", "- 19:00 Планёрка · Zoom", "",
      "<b>🔬 RESCAN</b>", "🗓 События", "- 12:00 Созвон RESCAN", "", "📋 Твои задачи на сегодня", "1. Макет пациента (до 18:00)",
      "", MY_DAY_FOOTER,
    ].join("\n"));
    expect(textOf(2)).toBe(["☀️ План на вт 13.10", "", "🗓 События", "- 19:00 Планёрка · Zoom", "", MY_DAY_FOOTER].join("\n"));
  });

  it("встреча с участниками — только им; общее событие — всем", async () => {
    const meeting = await create("Сбивка по кофе-рану", "2026-10-13T16:00", { place: "малая переговорная" });
    await participants.add(meeting.id, [9, 2]);
    await create("Планёрка", "2026-10-13T19:00", { place: "Zoom" });
    await dispatchTeamDigests({ now: msk("2026-10-13T08:00"), deps: deps() });
    expect(textOf(2)).toContain("🗓 События\n- 16:00 Сбивка по кофе-рану · малая переговорная\n- 19:00 Планёрка · Zoom");
    expect(textOf(1)).not.toContain("Сбивка");
    expect(textOf(1)).toContain("- 19:00 Планёрка · Zoom");
  });

  it("задачи: на сегодня — по порядку, просроченные — отдельно; чужие и закрытые — нет", async () => {
    const [today] = await tasks.importAssignedTasks(9, 1, [{ line: 1, username: "vika", what: "Найти пейсеров на кофе-ран", due_at: msk("2026-10-13T20:00").toISOString() }]);
    await tasks.importAssignedTasks(9, 2, [{ line: 1, username: "vika", what: "Анонс кофе-рана в ТГК", due_at: msk("2026-10-12T12:00").toISOString() }]);
    await tasks.importAssignedTasks(9, 3, [{ line: 1, username: "vika", what: "Рилсы", due_at: msk("2026-10-14T23:59").toISOString() }]);
    await tasks.importAssignedTasks(9, 4, [{ line: 1, username: "salma", what: "Чужая задача", due_at: msk("2026-10-13T12:00").toISOString() }]);
    const [done] = await tasks.importAssignedTasks(9, 5, [{ line: 1, username: "vika", what: "Уже сделано", due_at: msk("2026-10-13T10:00").toISOString() }]);
    await tasks.setAssignedStatus(done.id, 1, "done");
    expect(today.id).toBeGreaterThan(0);
    await dispatchTeamDigests({ now: msk("2026-10-13T08:00"), deps: deps() });
    expect(textOf(1)).toBe([
      "☀️ План на вт 13.10", "",
      "📋 Твои задачи на сегодня",
      "1. Найти пейсеров на кофе-ран (до 20:00)",
      "⏰ Просрочено: Анонс кофе-рана в ТГК (срок вчера 12:00)",
      "", MY_DAY_FOOTER,
    ].join("\n"));
    // У Али задач на сегодня нет — пустой день ему не отправляется.
    expect(sent.some((s) => s.chat === 9)).toBe(false);
  });

  it("кофе-ран: фаундеру — ожидаемая явка и тревога рассылки, участнику — только строка события", async () => {
    await create("Кофе-ран · Усачёва", "2026-10-13T10:00", { kind: "club_event", club: "run", format: "coffee_run", spot: "usachevo" });
    signups = [
      signup({ confirmed_at: "2026-10-06T10:00:00Z", tg_chat_id: 7, pace: "6:30" }),
      signup({ confirmed_at: "2026-10-06T10:00:00Z", tg_chat_id: 8, pace: "7:00" }),
      signup({ pace: null }),
    ];
    await dispatchTeamDigests({ now: msk("2026-10-13T08:05"), deps: deps() });
    expect(textOf(9)).toContain("🏃 Кофе-ран · Усачёва, 10:00: ждём 2 из 3 — 6:30 мин/км — 1, 7:00 мин/км — 1, без темпа — 1");
    expect(textOf(9)).toContain("⚠️ не подтвердились 1");
    expect(textOf(9)).toContain("🚨 Кофе-ран · Усачёва: вчера окно рассылки напоминаний прошло, а не ушло ни одного");
    expect(textOf(1)).toContain("- 10:00 Кофе-ран · Усачёва");
    expect(textOf(1)).not.toContain("ждём");
    expect(textOf(1)).not.toContain("🚨");
  });

  it("если напоминания ушли — без тревоги", () => {
    const coffee = { id: 1, kind: "club_event" as const, club: "run", title: "Кофе-ран · Усачёва", starts_at: msk("2026-10-13T10:00").toISOString(),
      place: null, notes: null, responsible_chat_id: null, created_by: 1, created_at: "", updated_at: "", cancelled_at: null, format: "coffee_run" as const, spot: "usachevo" };
    const lines = founderCoffeeLines([{ kind: "event", event: coffee, runDate: "2026-10-13", stats: {
      total: 2, reminded: 2, waiting: 0, unconfirmed: 0, confirmed: 2, byPace: [{ pace: "6:30", count: 2 }],
      last24h: 0, lastSignupAt: null, lastReminderAt: "2026-10-12T07:00:00Z" } }], msk("2026-10-13T08:00"));
    expect(lines.join("\n")).not.toContain("🚨");
    expect(lines.join("\n")).not.toContain("⚠️");
  });
});
