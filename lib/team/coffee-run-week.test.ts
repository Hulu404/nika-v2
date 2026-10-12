import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { MemoryStore } from "../databot/data/memory-store";
import type { TeamMember } from "./access";
import { COFFEE_RUN_TASKS } from "./coffee-run-template";
import {
  MemoryRsvpStore,
  MemoryWeekStore,
  coffeeTaskDue,
  dispatchCoffeeRunWeek,
  handleCoffeeWeekUpdate,
  rsvpLine,
  weekStartOf,
  type CoffeeWeekDeps,
  type WeekApi,
} from "./coffee-run-week";
import { MemoryEventStore, scheduleItems, weekRange } from "./events";
import { MemoryTeamForms } from "./form";

const msk = (local: string) => new Date(`${local}+03:00`);
const MON = msk("2026-10-12T12:05"); // пн 12.10, неделя 12.10–18.10

const member = (chat_id: number, username: string, departments: string[] = []): TeamMember => ({
  chat_id, username, display_name: username, role: "member", joined_at: "2026-10-01T00:00:00Z",
  added_by: null, last_seen_at: null, digest_opt_in: true, departments,
});

describe("кофе-ран недели", () => {
  let people: TeamMember[];
  let deps: CoffeeWeekDeps;
  let weeks: MemoryWeekStore;
  let events: MemoryEventStore;
  let tasks: MemoryStore;
  let enabled: boolean;
  let calls: Array<{ method: string; chat: number; text: string; markup?: { inline_keyboard?: Array<Array<{ text: string; callback_data?: string }>> } }>;
  let api: WeekApi;
  let press: (data: string, from: number, now?: Date) => Promise<void>;
  let send: (text: string, from: number, now?: Date) => Promise<void>;

  const sentTo = (re: RegExp) => calls.filter((c) => c.method === "sendMessage" && re.test(c.text)).map((c) => c.chat).sort((a, b) => a - b);
  const lastTo = (chat: number) => calls.filter((c) => c.chat === chat).at(-1)!;

  beforeEach(() => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "8,9");
    people = [
      member(8, "ali"), member(9, "nika"),
      member(1, "vika", ["smm"]), member(2, "salma", ["smm"]), member(3, "danya", ["events"]),
    ];
    weeks = new MemoryWeekStore();
    events = new MemoryEventStore();
    tasks = new MemoryStore();
    enabled = true;
    calls = [];
    deps = {
      weeks, events, tasks, rsvp: new MemoryRsvpStore(), forms: new MemoryTeamForms(),
      listTeam: async () => people, enabled: async () => enabled, founders: () => [8, 9],
    };
    let mid = 100;
    api = {
      sendMessage: async (chat, text, other) => {
        calls.push({ method: "sendMessage", chat, text, markup: other?.reply_markup });
        return { message_id: ++mid };
      },
      editMessageText: async (chat, _id, text) => {
        calls.push({ method: "editMessageText", chat, text });
        return true;
      },
    };
    const bot = new Bot("1:x", { botInfo: { id: 1, is_bot: true, first_name: "П", username: "t_bot" } as UserFromGetMe });
    bot.api.config.use(async (_prev, method, payload) => {
      const p = payload as { chat_id: number; text?: string; reply_markup?: never };
      if (method === "sendMessage" || method === "editMessageText") calls.push({ method, chat: p.chat_id, text: String(p.text), markup: p.reply_markup });
      return { ok: true, result: method === "sendMessage" ? { message_id: ++mid, date: 1, chat: { id: p.chat_id, type: "private" } } : true } as never;
    });
    let clock = MON;
    bot.use((ctx) => handleCoffeeWeekUpdate(ctx, deps, clock).then(() => {}));
    let id = 0;
    const chat = (from: number) => ({ id: from, type: "private" as const, first_name: "x" });
    const user = (from: number) => ({ id: from, is_bot: false, first_name: "x" });
    press = async (data, from, now = MON) => {
      clock = now;
      await bot.handleUpdate({ update_id: ++id, callback_query: { id: `c${id}`, chat_instance: "x", data, from: user(from),
        message: { message_id: 50, date: 1, text: "x", chat: chat(from) } } } as Update);
    };
    send = async (text, from, now = MON) => {
      clock = now;
      await bot.handleUpdate({ update_id: ++id, message: { message_id: id, date: 1, text, chat: chat(from), from: user(from) } } as Update);
    };
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("вопрос в понедельник", () => {
    it("до 12:00 молчит; в 12:00 — фаундерам один раз, сколько бы тикер ни прошёл", async () => {
      expect(await dispatchCoffeeRunWeek(deps, api, msk("2026-10-12T11:45"))).toEqual([]);
      expect(await dispatchCoffeeRunWeek(deps, api, MON)).toEqual(["ask 2026-10-12"]);
      await dispatchCoffeeRunWeek(deps, api, msk("2026-10-12T12:20"));
      await dispatchCoffeeRunWeek(deps, api, msk("2026-10-12T13:00"));
      expect(sentTo(/Проводим кофе-ран на этой неделе/)).toEqual([8, 9]);
      const buttons = calls[0].markup!.inline_keyboard!.flat().map((b) => b.text);
      expect(buttons.slice(1)).toEqual(["Да, выбрать день и место", "Нет, пропускаем"]);
    });

    it("во вторник и при выключенных кофе-ранах вопроса нет", async () => {
      expect(await dispatchCoffeeRunWeek(deps, api, msk("2026-10-13T12:05"))).toEqual([]);
      enabled = false;
      expect(await dispatchCoffeeRunWeek(deps, api, MON)).toEqual([]);
      expect(calls).toEqual([]);
    });

    it("«Как в прошлый раз» — день, время и спот прошлого кофе-рана", async () => {
      await events.create({ kind: "club_event", club: "run", format: "coffee_run", spot: "luzhniki", title: "Кофе-ран · Лужники",
        starts_at: msk("2026-10-10T09:00").toISOString(), place: null, responsible_chat_id: null, created_by: 8 }, msk("2026-10-05T12:00"));
      await dispatchCoffeeRunWeek(deps, api, MON);
      expect(calls[0].markup!.inline_keyboard![0][0]).toEqual({ text: "Как в прошлый раз: сб 09:00, Лужники", callback_data: "cw:same:2026-10-12" });
      await press("cw:same:2026-10-12", 8);
      expect([...events.events.values()].at(-1)).toMatchObject({ spot: "luzhniki", starts_at: msk("2026-10-17T09:00").toISOString() });
    });

    it("в 16:00 одно напоминание, если не решено; после решения — нет", async () => {
      await dispatchCoffeeRunWeek(deps, api, MON);
      await dispatchCoffeeRunWeek(deps, api, msk("2026-10-12T16:00"));
      await dispatchCoffeeRunWeek(deps, api, msk("2026-10-12T16:15"));
      expect(sentTo(/ещё не решён, СММ ждёт анонс до вторника 12:00/)).toEqual([8, 9]);

      const other = new MemoryWeekStore();
      deps.weeks = other;
      calls = [];
      await dispatchCoffeeRunWeek(deps, api, msk("2026-10-19T12:00"));
      await press("cw:no:2026-10-19", 8, msk("2026-10-19T13:00"));
      await dispatchCoffeeRunWeek(deps, api, msk("2026-10-19T16:00"));
      expect(sentTo(/ещё не решён/)).toEqual([]);
    });
  });

  describe("решение", () => {
    beforeEach(async () => {
      await dispatchCoffeeRunWeek(deps, api, MON);
      calls = [];
    });

    it("«Да»: день → время → спот; событие, анонс, ответственный, задачи, опрос", async () => {
      await press("cw:pick:2026-10-12", 8);
      await press("cw:d:2026-10-12:2026-10-18", 8);
      expect(lastTo(8).markup!.inline_keyboard!.flat().map((b) => b.text)).toEqual(["08:00", "09:00", "10:00", "11:00", "Другое"]);
      await press("cw:t:2026-10-12:2026-10-18:1000", 8);
      await press("cw:s:2026-10-12:2026-10-18:1000:usachevo", 8);

      const ev = [...events.events.values()];
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ title: "Кофе-ран · Усачёва", format: "coffee_run", spot: "usachevo", created_by: 8,
        starts_at: msk("2026-10-18T10:00").toISOString(), place: "Москва, ул. Усачёва, 62" });
      // У обоих фаундеров вопрос превратился в итог.
      expect(calls.filter((c) => c.method === "editMessageText" && c.text === "✅ Решено @ali: кофе-ран вс 18.10, 10:00, Усачёва").map((c) => c.chat)).toEqual([8, 9]);
      expect(sentTo(/^🏃 Кофе-ран · Усачёва, вс 18\.10, 10:00\. Подробности в 🏃 Ивенты\.$/)).toEqual([1, 2, 3, 8, 9]);
      expect(sentTo(/Кто ответственный/)).toEqual([8]);
      expect(sentTo(/^Будешь на кофе-ране вс 18\.10\?$/)).toEqual([1, 2, 3, 8, 9]);

      // Ответственный — Даня: ему уведомление с карточкой.
      await press(`cr:${ev[0].id}:3`, 8);
      expect(events.events.get(ev[0].id)!.responsible_chat_id).toBe(3);
      expect(sentTo(/Ты ответственный за кофе-ран/)).toEqual([3]);
    });

    it("своё время и своё место — сообщениями", async () => {
      await press("cw:to:2026-10-12:2026-10-17", 9);
      await send("8:30", 9);
      expect(lastTo(9).text).toContain("Где?");
      await press("cw:so:2026-10-12:2026-10-17:0830", 9);
      await send("Парк Горького, вход у Нескучного", 9);
      expect([...events.events.values()][0]).toMatchObject({ title: "Кофе-ран · Парк Горького, вход у Нескучного", spot: null,
        starts_at: msk("2026-10-17T08:30").toISOString(), place: "Парк Горького, вход у Нескучного" });
    });

    it("гонка двух фаундеров: решение одно, второму — кто и что решил", async () => {
      await press("cw:t:2026-10-12:2026-10-18:1000", 9);
      await press("cw:s:2026-10-12:2026-10-18:1000:usachevo", 8);
      await press("cw:s:2026-10-12:2026-10-18:1100:luzhniki", 9);
      await press("cw:no:2026-10-12", 9);
      expect(events.events.size).toBe(1);
      expect(calls.filter((c) => c.chat === 9 && c.text === "Уже решено: @ali, проводим вс 18.10 10:00.")).toHaveLength(2);
      expect((await weeks.get("2026-10-12"))!.decided_by).toBe(8);
    });

    it("решения принимают только фаундеры", async () => {
      await press("cw:s:2026-10-12:2026-10-18:1000:usachevo", 1);
      expect(events.events.size).toBe(0);
      expect(lastTo(1).text).toContain("принимают фаундеры");
    });

    it("«Нет»: команде одно сообщение, ни события, ни задач", async () => {
      await press("cw:no:2026-10-12", 9);
      expect(events.events.size).toBe(0);
      expect(tasks.assignedTasks.size).toBe(0);
      expect(sentTo(/^На этой неделе кофе-рана не будет\.$/)).toEqual([1, 2, 3, 8, 9]);
      expect(calls.filter((c) => c.method === "editMessageText").map((c) => c.chat)).toEqual([8, 9]);
    });
  });

  describe("задачи отделам", () => {
    beforeEach(async () => {
      await dispatchCoffeeRunWeek(deps, api, MON);
    });

    it("каждая задача — всем членам отдела одной строкой, автор — ответивший фаундер", async () => {
      await press("cw:s:2026-10-12:2026-10-18:1000:usachevo", 8);
      const all = [...tasks.assignedTasks.values()];
      const smm = COFFEE_RUN_TASKS.filter((t) => t.department === "smm").length;
      const ev = COFFEE_RUN_TASKS.filter((t) => t.department === "events").length;
      expect(all).toHaveLength(smm * 2 + ev);
      expect(new Set(all.map((t) => t.source_message_id)).size).toBe(1);
      expect(all.every((t) => t.assigned_by === 8)).toBe(true);
      const announce = all.filter((t) => t.what.startsWith("Анонс кофе-рана"));
      expect(announce.map((t) => t.username).sort()).toEqual(["salma", "vika"]);
      expect(new Set(announce.map((t) => t.line)).size).toBe(1);
      expect(announce[0].what).toBe("Анонс кофе-рана: пост в ТГК и Instagram · Кофе-ран · Усачёва, вс 18.10");
      const surf = all.filter((t) => t.what.startsWith("Договориться о посте-анонсе в Surf Coffee"));
      expect(surf.map((t) => t.username)).toEqual(["danya"]);
      expect(all.every((t) => t.delivery_state === "sent")).toBe(true);
    });

    it("пустой отдел — задач нет, фаундеру сообщение", async () => {
      people = people.map((m) => (m.username === "danya" ? { ...m, departments: [] } : m));
      await press("cw:s:2026-10-12:2026-10-18:1000:usachevo", 8);
      expect([...tasks.assignedTasks.values()].some((t) => t.username === "danya")).toBe(false);
      expect(sentTo(/^В отделе Ивенты никого нет, задачи не созданы\. Назначь людей в 👥 Команда\.$/)).toEqual([8]);
    });
  });

  describe("сроки задач", () => {
    const due = (what: RegExp, run: string, now: Date) => {
      const t = COFFEE_RUN_TASKS.find((x) => what.test(x.what))!;
      return coffeeTaskDue(t, weekStartOf(now), run, now);
    };

    it("решение в понедельник, забег в воскресенье и в субботу", () => {
      expect(due(/^Анонс/, "2026-10-18", MON)).toEqual({ due: msk("2026-10-13T12:00"), late: false });
      expect(due(/^Рилсы/, "2026-10-18", MON)).toEqual({ due: msk("2026-10-14T23:59"), late: false });
      expect(due(/пейсеров/, "2026-10-18", MON)).toEqual({ due: msk("2026-10-16T20:00"), late: false });
      expect(due(/пейсеров/, "2026-10-17", MON)).toEqual({ due: msk("2026-10-15T20:00"), late: false });
      expect(due(/Surf Coffee/, "2026-10-17", MON)).toEqual({ due: msk("2026-10-13T18:00"), late: false });
    });

    it("решение вечером вторника: прошедшие сроки — через 3 часа и с пометкой", () => {
      const tue = msk("2026-10-13T20:00");
      expect(due(/^Анонс/, "2026-10-18", tue)).toEqual({ due: msk("2026-10-13T23:00"), late: true });
      expect(due(/Surf Coffee/, "2026-10-18", tue)).toEqual({ due: msk("2026-10-13T23:00"), late: true });
      expect(due(/^Рилсы/, "2026-10-17", tue)).toEqual({ due: msk("2026-10-14T23:59"), late: false });
    });

    it("в карточке поздней задачи — «срок сдвинут: решение принято поздно»", async () => {
      const tue = msk("2026-10-13T20:00");
      await weeks.open("2026-10-12");
      await press("cw:s:2026-10-12:2026-10-18:1000:usachevo", 8, tue);
      const cards = calls.filter((c) => c.method === "sendMessage" && c.chat === 1 && /Анонс кофе-рана/.test(c.text));
      expect(cards.at(-1)!.text).toContain("срок сдвинут: решение принято поздно");
    });
  });

  describe("после решения", () => {
    let id: number;
    beforeEach(async () => {
      await dispatchCoffeeRunWeek(deps, api, MON);
      await press("cw:s:2026-10-12:2026-10-18:1000:usachevo", 8);
      id = [...events.events.values()][0].id;
      await press(`cr:${id}:3`, 8);
      calls = [];
    });

    it("опрос: ответ можно поменять, строка в экране ивента", async () => {
      await press(`rs:${id}:y`, 1);
      await press(`rs:${id}:y`, 2);
      await press(`rs:${id}:y`, 3);
      await press(`rs:${id}:n`, 3);
      expect(await rsvpLine(deps, events.events.get(id)!)).toBe("Из команды будут: @vika, @salma · не смогут: @danya · не ответили: 2");
    });

    it("в «Расписании» и «Ивентах» — один кофе-ран", () => {
      const { days } = weekRange(msk("2026-10-15T12:00"));
      const items = scheduleItems([...events.events.values()], days);
      expect(items.filter((i) => i.source === "event" && /Кофе-ран/.test(i.event.title))).toHaveLength(1);
    });

    it("за сутки — «Проводим?» ответственному, один раз; «Проводим» — команде", async () => {
      await dispatchCoffeeRunWeek(deps, api, msk("2026-10-17T09:45"));
      expect(calls).toEqual([]);
      await dispatchCoffeeRunWeek(deps, api, msk("2026-10-17T10:00"));
      await dispatchCoffeeRunWeek(deps, api, msk("2026-10-17T10:15"));
      expect(sentTo(/^Завтра кофе-ран · усачёва, 10:00\. Проводим\?$/)).toEqual([3]);
      await press(`cc:${id}:y`, 3, msk("2026-10-17T11:00"));
      expect(sentTo(/^✅ Кофе-ран завтра в 10:00 подтверждён/)).toEqual([1, 2, 3, 8, 9]);
      // Подтверждено — фаундеров за 12 часов не дёргаем.
      await dispatchCoffeeRunWeek(deps, api, msk("2026-10-17T22:00"));
      expect(sentTo(/не подтвердил/)).toEqual([]);
    });

    it("за 12 часов без ответа — фаундерам", async () => {
      await dispatchCoffeeRunWeek(deps, api, msk("2026-10-17T10:00"));
      await dispatchCoffeeRunWeek(deps, api, msk("2026-10-17T22:00"));
      await dispatchCoffeeRunWeek(deps, api, msk("2026-10-17T22:15"));
      expect(sentTo(/^Ответственный @danya не подтвердил кофе-ран на завтра\.$/)).toEqual([8, 9]);
    });

    it("«Отменяем»: событие и незакрытые задачи отменены, команде сообщение, нажавшему — про /cancel", async () => {
      const done = [...tasks.assignedTasks.values()].find((t) => t.username === "vika")!;
      await tasks.setAssignedStatus(done.id, 1, "done");
      await dispatchCoffeeRunWeek(deps, api, msk("2026-10-17T10:00"));
      await press(`cc:${id}:n`, 3, msk("2026-10-17T11:00"));
      expect(events.events.get(id)!.cancelled_at).not.toBeNull();
      const statuses = [...tasks.assignedTasks.values()].map((t) => t.status);
      expect(statuses.filter((s) => s === "done")).toHaveLength(1);
      expect(statuses.filter((s) => s !== "done").every((s) => s === "cancelled")).toBe(true);
      expect(sentTo(/^❌ Кофе-ран завтра отменён$/)).toEqual([1, 2, 3, 8, 9]);
      expect(lastTo(3).text).toBe("Участникам отмену нужно разослать через основного бота командой /cancel.");
    });
  });
});
