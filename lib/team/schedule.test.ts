import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import type { CoffeeRun } from "../coffeerun/run";
import type { TeamMember } from "./access";
import { scheduleScreen } from "./copy";
import {
  EventParseError,
  MemoryEventStore,
  canManageEvent,
  coffeeRunTitle,
  groupByDay,
  parseEventLine,
  scheduleItems,
  weekRange,
  type TeamEvent,
} from "./events";
import { MemoryTeamForms } from "./form";
import { handleScheduleUpdate, type ScheduleDeps } from "./schedule";

const msk = (local: string) => new Date(`${local}+03:00`);
const NOW = msk("2026-10-08T12:00"); // чт 08.10, 12:00 МСК

const run = (patch: Partial<CoffeeRun>): CoffeeRun => ({
  spot: "usachevo", landing: "/coffeerunsurfsport", spotName: "Surf Coffee® × Sport, Усачёва",
  date: "2026-10-11", dateLabel: "11 октября", weekday: "воскресенье", gatherTime: "9:30", startTime: "10:00",
  address: "Москва, ул. Усачёва, 62", place: "спот", distance: "5 км", mapUrl: "https://example", ...patch,
});
const event = (patch: Partial<TeamEvent>): TeamEvent => ({
  id: 1, kind: "meeting", club: null, title: "Планёрка", starts_at: msk("2026-10-09T19:00").toISOString(),
  place: "Zoom", notes: null, responsible_chat_id: null, created_by: 1, created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(), cancelled_at: null, ...patch,
});

describe("разбор /event", () => {
  it("понимает формат задач: «пт 19:00», «завтра 12:00», «03.10 18:00», место и ответственного", () => {
    expect(parseEventLine("/event Планёрка / пт 19:00 / Zoom", NOW)).toEqual({
      title: "Планёрка", startsAt: msk("2026-10-09T19:00").toISOString(), place: "Zoom", responsible: null,
    });
    expect(parseEventLine("/event Созвон / завтра 12:00", NOW).startsAt).toBe(msk("2026-10-09T12:00").toISOString());
    expect(parseEventLine("/event Книжный клуб / 15.10 19:30 / Surf Coffee / @Masha", NOW)).toEqual({
      title: "Книжный клуб", startsAt: msk("2026-10-15T19:30").toISOString(), place: "Surf Coffee", responsible: "masha",
    });
    expect(parseEventLine("/event Разбор / пт 18:00 / @bob", NOW)).toMatchObject({ place: null, responsible: "bob" });
  });

  it("без времени, в прошлом или с лишними полями — понятная ошибка", () => {
    expect(() => parseEventLine("/event Планёрка / пт", NOW)).toThrow(/Не вижу времени/);
    expect(() => parseEventLine("/event Планёрка / 01.10 10:00", NOW)).toThrow(EventParseError);
    expect(() => parseEventLine("/event Планёрка / сегодня 09:00", NOW)).toThrow(/уже прошло/);
    expect(() => parseEventLine("/event Планёрка", NOW)).toThrow(/от двух до четырёх полей/);
    expect(() => parseEventLine("/event", NOW)).toThrow(/Формат/);
  });
});

describe("расписание недели", () => {
  it("группирует по дням по Москве: 23:30 МСК остаётся в своём дне", () => {
    const late = event({ id: 2, title: "Поздний созвон", starts_at: msk("2026-10-09T23:30").toISOString() });
    const early = event({ id: 3, title: "Ранний", starts_at: msk("2026-10-10T00:30").toISOString() });
    const { days } = weekRange(NOW);
    const groups = groupByDay(scheduleItems([late, early], days, []));
    expect(groups.map((g) => g.ymd)).toEqual(["2026-10-09", "2026-10-10"]);
  });

  it("неделя — семь московских дней с сегодня; следующая — со смещением", () => {
    expect(weekRange(NOW).days).toEqual(["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"]);
    expect(weekRange(NOW, 1).fromYmd).toBe("2026-10-15");
  });

  it("подмешивает кофе-раны из COFFEE_RUNS как ивент «Бегового клуба», только на этой неделе", () => {
    const { days } = weekRange(NOW);
    const items = scheduleItems([event({})], days, [run({}), run({ spot: "luzhniki", spotName: "Surf Coffee® Лужники", date: "2026-10-25" })]);
    expect(items.map((i) => i.source)).toEqual(["event", "coffeerun"]);
    const screen = scheduleScreen(items, days, 0);
    expect(screen.text).toContain("<b>Пт 09.10</b>\n19:00 Планёрка · Zoom");
    expect(screen.text).toContain("<b>Вс 11.10</b>\n10:00 🏃 Кофе-ран Усачёва · Беговой клуб");
    expect(screen.text).not.toContain("Лужники");
    expect(coffeeRunTitle({ spotName: "Surf Coffee® Лужники" })).toBe("Кофе-ран Лужники");
  });

  it("два ивента разных клубов и кофе-ран в одну неделю", () => {
    const { days } = weekRange(NOW);
    const items = scheduleItems([
      event({ id: 5, kind: "club_event", club: "run", title: "Интервалы", starts_at: msk("2026-10-10T08:00").toISOString() }),
      event({ id: 6, kind: "club_event", club: "book", title: "Книжный клуб", starts_at: msk("2026-10-10T19:00").toISOString() }),
    ], days, [run({})]);
    expect(items).toHaveLength(3);
    expect(scheduleScreen(items, days, 0).text).toContain("08:00 🏃 Интервалы · Беговой клуб");
  });

  it("пустая неделя — так и говорит и предлагает добавить событие", () => {
    const { days } = weekRange(NOW);
    const screen = scheduleScreen([], days, 0);
    expect(screen.text).toContain("На этой неделе ничего не запланировано");
    const labels = screen.keyboard.inline_keyboard.flat().map((b) => b.text);
    expect(labels).toEqual(["Следующая неделя", "Добавить событие"]);
  });
});

describe("права на событие", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("менять и отменять: автор, ответственный, фаундер; остальным нельзя", () => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "9");
    const ev = event({ created_by: 1, responsible_chat_id: 2 });
    expect(canManageEvent(ev, 1)).toBe(true);
    expect(canManageEvent(ev, 2)).toBe(true);
    expect(canManageEvent(ev, 9)).toBe(true);
    expect(canManageEvent(ev, 3)).toBe(false);
  });
});

describe("сценарий /event в боте", () => {
  const member = (chat_id: number, username: string): TeamMember => ({
    chat_id, username, display_name: username, role: "member", joined_at: NOW.toISOString(),
    added_by: null, last_seen_at: null, digest_opt_in: true,
  });
  const people = [member(1, "alice"), member(2, "bob"), member(3, "carol"), member(9, "founder")];
  let events: MemoryEventStore;
  let calls: Array<{ method: string; payload: Record<string, unknown> }>;
  let send: (text: string, from?: number) => Promise<void>;
  let press: (data: string, from?: number) => Promise<void>;

  beforeEach(() => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "9");
    events = new MemoryEventStore();
    calls = [];
    const deps: ScheduleDeps = {
      events, forms: new MemoryTeamForms(),
      findMember: async (id) => people.find((m) => m.chat_id === id) ?? null,
      listTeam: async () => people,
    };
    const bot = new Bot("1:x", { botInfo: { id: 1, is_bot: true, first_name: "П", username: "t_bot" } as UserFromGetMe });
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      return { ok: true, result: { message_id: calls.length } } as Awaited<ReturnType<typeof _prev>>;
    });
    bot.use((ctx) => handleScheduleUpdate(ctx, deps, NOW).then(() => {}));
    let id = 0;
    const chat = (from: number) => ({ id: from, type: "private" as const, first_name: "x" });
    const user = (from: number) => ({ id: from, is_bot: false, first_name: "x" });
    send = async (text, from = 1) => {
      await bot.handleUpdate({ update_id: ++id, message: { message_id: id, date: 1, text, chat: chat(from), from: user(from) } } as Update);
    };
    press = async (data, from = 1) => {
      await bot.handleUpdate({ update_id: ++id, callback_query: { id: `c${id}`, chat_instance: "x", data, from: user(from),
        message: { message_id: 50, date: 1, text: "x", chat: chat(from) } } } as Update);
    };
  });
  afterEach(() => vi.unstubAllEnvs());

  it("ивент клуба: тип, клуб, рассылка всем, кроме автора", async () => {
    await send("/event Интервалы / сб 08:00 / Лужники / @bob");
    await press("ev:k:club");
    await press("ev:c:run");
    await press("ev:n:1");
    const ev = events.events.get(1)!;
    expect(ev).toMatchObject({ kind: "club_event", club: "run", title: "Интервалы", place: "Лужники", responsible_chat_id: 2, created_by: 1 });
    const announced = calls.filter((c) => c.method === "sendMessage" && String(c.payload.text).includes("В расписании: Интервалы"));
    expect(announced.map((c) => c.payload.chat_id).sort()).toEqual([2, 3, 9]);
  });

  it("планёрка без рассылки, ответственного нет в команде — ошибка", async () => {
    await send("/event Планёрка / пт 19:00 / Zoom / @nobody");
    expect(String(calls.at(-1)!.payload.text)).toContain("Не нашла @nobody");
    await send("Планёрка / пт 19:00 / Zoom");
    await press("ev:k:meeting");
    await press("ev:n:0");
    expect(events.events.get(1)).toMatchObject({ kind: "meeting", club: null });
    expect(calls.some((c) => String(c.payload.text).includes("В расписании"))).toBe(false);
  });

  it("отменить может автор, ответственный или фаундер; при отмене спрашивает про рассылку", async () => {
    await events.create({ kind: "meeting", club: null, title: "Планёрка", starts_at: msk("2026-10-09T19:00").toISOString(),
      place: null, responsible_chat_id: 2, created_by: 1 }, NOW);
    await press("ev:x:1", 3);
    expect(String(calls.at(-1)!.payload.text)).toContain("автор, ответственный и фаундеры");
    expect(events.events.get(1)!.cancelled_at).toBeNull();
    await press("ev:x:1", 2);
    expect(String(calls.at(-1)!.payload.text)).toContain("Сообщить команде об отмене?");
    await press("ev:X:1:1", 2);
    expect(events.events.get(1)!.cancelled_at).not.toBeNull();
    const told = calls.filter((c) => c.method === "sendMessage" && String(c.payload.text).includes("Отменено: Планёрка"));
    expect(told.map((c) => c.payload.chat_id).sort()).toEqual([1, 3, 9]);
  });

  it("фаундер меняет время чужого события", async () => {
    await events.create({ kind: "other", club: null, title: "Съёмка", starts_at: msk("2026-10-09T19:00").toISOString(),
      place: null, responsible_chat_id: null, created_by: 1 }, NOW);
    await press("ev:t:1", 9);
    await send("сб 11:00", 9);
    expect(events.events.get(1)!.starts_at).toBe(msk("2026-10-10T11:00").toISOString());
  });
});
