import { describe, expect, it, vi } from "vitest";
import { COFFEE_RUNS } from "../coffeerun/run";
import { dispatchAfterEvent, runFollowup, todaysEvents, type FollowupDeps, type FollowupState } from "./after-event-dispatch";
import {
  eventEnd,
  fromRunEvent,
  inAutoWindow,
  isNightMsk,
  pickRecipients,
  type Attendee,
  type Exclusions,
} from "./rules";
import { coffeeRunAttendedForFollowup, clubOrderCounts } from "../telegram/attendance";

const cave = COFFEE_RUNS.find((r) => r.spot === "cave")!; // 15 ноября, старт 12:30, 90 минут → конец 14:00
const at = (hhmm: string, date = cave.date) => new Date(`${date}T${hhmm}:00+03:00`);
const NONE: Exclusions = { askedRecently: new Set(), donatedRecently: new Set(), boughtToday: new Set(), optedOut: new Set() };

function fakeDeps(opts: {
  attendees?: Attendee[];
  exclusions?: Partial<Exclusions>;
  cancelled?: boolean;
  movedStart?: string | null;
  statusFails?: boolean;
  env?: Record<string, string | undefined>;
} = {}) {
  const claims = new Map<string, FollowupState>();
  const asked = new Set<string>();
  const sent: Array<{ chatId: number; text: string }> = [];
  const deps: FollowupDeps = {
    env: opts.env ?? { DONATIONS_AFTER_EVENT: "1" },
    async runStatus() {
      if (opts.statusFails) throw new Error("db down");
      return { cancelled: !!opts.cancelled, movedStart: opts.movedStart ?? null };
    },
    async attendees() {
      return opts.attendees ?? [{ chatId: 1, rowId: "r1", table: "coffee_run_signups" }];
    },
    async exclusions() {
      return { ...NONE, ...opts.exclusions };
    },
    async claim(ref, trigger) {
      if (claims.has(ref)) return false;
      claims.set(ref, { started_at: new Date().toISOString(), sent_count: 0, trigger });
      return true;
    },
    async followup(ref) {
      return claims.get(ref) ?? null;
    },
    async markAsked(a) {
      if (asked.has(a.rowId)) return false;
      asked.add(a.rowId);
      return true;
    },
    async setSentCount(ref, n) {
      claims.get(ref)!.sent_count = n;
    },
    async send(chatId, text) {
      sent.push({ chatId, text });
      return { ok: true };
    },
  };
  return { deps, sent, claims, asked };
}

describe("окно отправки", () => {
  const event = fromRunEvent(cave);

  it("окончание = старт + длительность (кофе-ран по умолчанию 90 минут)", () => {
    expect(eventEnd(event).toISOString()).toBe(at("14:00").toISOString());
  });

  it("пишем с 40-й по 60-ю минуту после окончания", () => {
    expect(inAutoWindow(event, at("14:39"))).toBe(false);
    expect(inAutoWindow(event, at("14:40"))).toBe(true);
    expect(inAutoWindow(event, at("15:00"))).toBe(true);
    expect(inAutoWindow(event, at("15:01"))).toBe(false);
  });

  it("перенос старта сдвигает окно", () => {
    const moved = fromRunEvent(cave, "18:00"); // конец 19:30
    expect(inAutoWindow(moved, at("14:45"))).toBe(false);
    expect(inAutoWindow(moved, at("20:15"))).toBe(true);
  });

  it("ночь 22:00–9:00 по МСК — не пишем и на утро не переносим", () => {
    const late = fromRunEvent(cave, "20:00"); // конец 21:30, окно 22:10–22:30 — уже ночь
    expect(isNightMsk(at("22:00"))).toBe(true);
    expect(isNightMsk(at("08:59"))).toBe(true);
    expect(isNightMsk(at("09:00"))).toBe(false);
    expect(inAutoWindow(late, at("22:15"))).toBe(false);
  });
});

describe("кому писать", () => {
  const a = (chatId: number, rowId = `r${chatId}`): Attendee => ({ chatId, rowId, table: "club_signups" });

  it.each([
    ["получал сообщение меньше 28 дней назад", { askedRecently: new Set([1]) }],
    ["поддерживал клуб меньше 28 дней назад", { donatedRecently: new Set([1]) }],
    ["в этот же день купил билет", { boughtToday: new Set([1]) }],
    ["сделал /stop", { optedOut: new Set([1]) }],
  ])("не пишем тому, кто %s", (_name, ex) => {
    expect(pickRecipients([a(1), a(2)], { ...NONE, ...ex }).map((r) => r.chatId)).toEqual([2]);
  });

  it("одному человеку — одно сообщение, даже если заказов два", () => {
    expect(pickRecipients([a(1, "x"), a(1, "y")], NONE)).toHaveLength(1);
  });

  it("кофе-ран: только «да» в перекличке", () => {
    expect(coffeeRunAttendedForFollowup({ confirmed_at: "x", rollcall_answer: "yes" })).toBe(true);
    expect(coffeeRunAttendedForFollowup({ confirmed_at: "x", rollcall_answer: null })).toBe(false);
    expect(coffeeRunAttendedForFollowup({ confirmed_at: "x", rollcall_answer: "no" })).toBe(false);
  });

  it("клуб: оплаченный или подтверждённый бесплатный заказ", () => {
    expect(clubOrderCounts({ payment_status: "paid", amount_rub: 1000, confirmed_at: null, is_gift: false })).toBe(true);
    expect(clubOrderCounts({ payment_status: "paid", amount_rub: 0, confirmed_at: "x", is_gift: false })).toBe(true);
    expect(clubOrderCounts({ payment_status: "paid", amount_rub: 0, confirmed_at: null, is_gift: false })).toBe(false);
    expect(clubOrderCounts({ payment_status: "waitlist", amount_rub: 1000, confirmed_at: "x", is_gift: false })).toBe(false);
  });
});

describe("рассылка после события", () => {
  it("флаг не задан — никто ничего не получает: ни тикер, ни /done", async () => {
    const { deps, sent } = fakeDeps({ env: {} });
    expect(await dispatchAfterEvent(deps, at("14:45"))).toBe(0);
    expect((await runFollowup(fromRunEvent(cave), "done", 1, deps, at("14:45"))).kind).toBe("disabled");
    expect(sent).toHaveLength(0);
  });

  it("тикер в окне — текст 12 с «кофе-ране» и кнопками сумм", async () => {
    const { deps, sent } = fakeDeps();
    expect(await dispatchAfterEvent(deps, at("14:45"))).toBe(1);
    expect(sent[0].text).toContain("Спасибо, что сегодня был(а) на кофе-ране 🧡");
  });

  it("вне окна — тишина", async () => {
    const { deps, sent } = fakeDeps();
    await dispatchAfterEvent(deps, at("14:30"));
    await dispatchAfterEvent(deps, at("15:05"));
    expect(sent).toHaveLength(0);
  });

  it("отменённый забег — тишина", async () => {
    const { deps, sent } = fakeDeps({ cancelled: true });
    await dispatchAfterEvent(deps, at("14:45"));
    expect(sent).toHaveLength(0);
  });

  it("не прочитали статус забега — сомнение = молчание", async () => {
    const { deps, sent } = fakeDeps({ statusFails: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await todaysEvents(deps, at("14:45"))).toEqual(expect.not.arrayContaining([expect.objectContaining({ ref: "cave:2026-11-15" })]));
    await dispatchAfterEvent(deps, at("14:45"));
    expect(sent).toHaveLength(0);
  });

  it("/done, потом тикер — одно сообщение на событие", async () => {
    const { deps, sent } = fakeDeps();
    const done = await runFollowup(fromRunEvent(cave), "done", 7, deps, at("14:10"));
    expect(done).toEqual({ kind: "sent", sent: 1 });
    await dispatchAfterEvent(deps, at("14:45"));
    expect(sent).toHaveLength(1);
    const again = await runFollowup(fromRunEvent(cave), "done", 7, deps, at("14:50"));
    expect(again).toMatchObject({ kind: "already", state: { sent_count: 1, trigger: "done" } });
  });

  it("/done не ждёт окна 40–60 минут, но ночью не пишет", async () => {
    const { deps, sent } = fakeDeps();
    expect((await runFollowup(fromRunEvent(cave), "done", 7, deps, at("13:00"))).kind).toBe("sent");
    const { deps: night } = fakeDeps();
    expect((await runFollowup(fromRunEvent(cave), "done", 7, night, at("23:00"))).kind).toBe("night");
    expect(sent).toHaveLength(1);
  });

  it("donation_asked_at уже стоит — человеку второй раз не пишем даже при гонке", async () => {
    const { deps, sent, asked } = fakeDeps();
    asked.add("r1");
    await dispatchAfterEvent(deps, at("14:45"));
    expect(sent).toHaveLength(0);
  });
});
