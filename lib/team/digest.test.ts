import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoffeeRun } from "../coffeerun/run";
import { MemoryFactStore } from "./attendance";
import { dispatchTeamDigests, type DigestDispatchDeps } from "./digest";
import { dailyDigestText } from "./digest-copy";
import { MemoryEventStore } from "./events";
import { MemoryTeamForms } from "./form";
import type { SignupRow } from "./stats";

const msk = (local: string) => new Date(`${local}+03:00`);
const run: CoffeeRun = {
  spot: "usachevo", landing: "/coffeerunsurfsport", spotName: "Surf Coffee® × Sport, Усачёва", date: "2026-10-13",
  dateLabel: "13 октября", weekday: "вторник", gatherTime: "9:30", startTime: "10:00", address: "Москва, ул. Усачёва, 62",
  place: "спот", distance: "5 км", mapUrl: "https://example",
};
const signup = (over: Partial<SignupRow>): SignupRow => ({
  name: "Аня", contact: "+7", pace: "6:30", created_at: "2026-10-05T09:00:00Z", confirmed_at: null,
  reminder_sent_at: null, tg_username: null, tg_chat_id: null, ...over,
});

describe("сводка дня", () => {
  let events: MemoryEventStore;
  let facts: MemoryFactStore;
  let sent: Array<{ chat: number; text: string }>;
  let claimed: Set<string>;
  let runs: CoffeeRun[];
  let signups: SignupRow[];
  const deps = (): DigestDispatchDeps => ({
    events, facts, forms: new MemoryTeamForms(), runs, throttleMs: 0,
    fetchSignups: async () => signups,
    recipients: async () => [1, 2],
    claimDaily: async (ymd) => (claimed.has(ymd) ? false : (claimed.add(ymd), true)),
    markDailySent: async () => {},
    send: async (chat, text) => (sent.push({ chat, text }), { ok: true }),
  });

  beforeEach(() => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "");
    events = new MemoryEventStore();
    facts = new MemoryFactStore();
    sent = [];
    claimed = new Set();
    runs = [];
    signups = [];
  });
  afterEach(() => vi.unstubAllEnvs());

  it("в 8:00 уходит всем без /mute, до 8:00 — нет", async () => {
    await events.create({ kind: "meeting", club: null, title: "Планёрка", starts_at: msk("2026-10-13T19:00").toISOString(), place: "Zoom", responsible_chat_id: null, created_by: 1 }, msk("2026-10-10T12:00"));
    await dispatchTeamDigests({ now: msk("2026-10-13T07:45"), deps: deps() });
    expect(sent).toEqual([]);
    await dispatchTeamDigests({ now: msk("2026-10-13T08:00"), deps: deps() });
    expect(sent.map((s) => s.chat)).toEqual([1, 2]);
    expect(sent[0].text).toContain("<b>Сегодня, Вт 13.10</b>");
    expect(sent[0].text).toContain("19:00 Планёрка · Zoom");
  });

  it("пустой день — сводки нет", async () => {
    const res = await dispatchTeamDigests({ now: msk("2026-10-13T08:00"), deps: deps() });
    expect(sent).toEqual([]);
    expect(res.skipped).toBe("нечего слать");
  });

  it("повтор после деплоя: второй проход в тот же день молчит", async () => {
    await events.create({ kind: "other", club: null, title: "Съёмка", starts_at: msk("2026-10-13T15:00").toISOString(), place: null, responsible_chat_id: null, created_by: 1 }, msk("2026-10-10T12:00"));
    await dispatchTeamDigests({ now: msk("2026-10-13T08:00"), deps: deps() });
    await dispatchTeamDigests({ now: msk("2026-10-13T08:15"), deps: deps() });
    await dispatchTeamDigests({ now: msk("2026-10-13T09:40"), deps: deps() });
    expect(sent).toHaveLength(2);
  });

  it("два события в один день и кофе-ран: темпы, неподтверждённые, тревога о рассылке", async () => {
    runs = [run];
    signups = [
      signup({ confirmed_at: "2026-10-06T10:00:00Z", tg_chat_id: 7, pace: "6:30" }),
      signup({ confirmed_at: "2026-10-06T10:00:00Z", tg_chat_id: 8, pace: "7:00" }),
      signup({ pace: null }),
    ];
    await events.create({ kind: "meeting", club: null, title: "Планёрка", starts_at: msk("2026-10-13T19:00").toISOString(), place: "Zoom", responsible_chat_id: null, created_by: 1 }, msk("2026-10-10T12:00"));
    await events.create({ kind: "club_event", club: "run", title: "Интервалы", starts_at: msk("2026-10-13T08:30").toISOString(), place: null, responsible_chat_id: null, created_by: 1 }, msk("2026-10-10T12:00"));
    await dispatchTeamDigests({ now: msk("2026-10-13T08:05"), deps: deps() });
    const text = sent[0].text;
    const order = ["08:30 🏃 Интервалы", "10:00 🏃 Кофе-ран Усачёва · Беговой клуб", "19:00 Планёрка"].map((s) => text.indexOf(s));
    expect(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1]))).toBe(true);
    expect(text).toContain("ждём 2 из 3: 6:30 мин/км — 1, 7:00 мин/км — 1, без темпа — 1");
    expect(text).toContain("⚠️ не подтвердились 1");
    expect(text).toContain("🚨 Кофе-ран Усачёва: вчера окно рассылки напоминаний прошло, а не ушло ни одного");
  });

  it("если напоминания ушли — без тревоги", () => {
    const text = dailyDigestText("2026-10-13", [{ kind: "run", run, stats: {
      total: 2, reminded: 2, waiting: 0, unconfirmed: 0, confirmed: 2, byPace: [{ pace: "6:30", count: 2 }],
      last24h: 0, lastSignupAt: null, lastReminderAt: "2026-10-12T07:00:00Z" } }], msk("2026-10-13T08:00"));
    expect(text).not.toContain("🚨");
    expect(text).not.toContain("⚠️");
  });
});
