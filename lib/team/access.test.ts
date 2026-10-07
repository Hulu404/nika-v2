import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import type { TeamMember } from "./access";

// Состав команды вместо Supabase: проверяем права, а не базу.
const roster = new Map<number, TeamMember>();
const removed: string[] = [];
const touched: Array<{ id: number; at: number }> = [];
vi.mock("./access", () => ({
  findMember: async (id: number) => roster.get(id) ?? null,
  touchMember: async (id: number, now: Date) => {
    touched.push({ id, at: now.getTime() });
  },
  joinTeam: async () => ({ status: "failed" }),
  listTeam: async () => [...roster.values()],
  setDigestOptIn: async () => true,
  removeMember: async (target: string) => {
    removed.push(target);
    const m = [...roster.values()].find((x) => `@${x.username}` === target);
    return m ? { status: "removed", member: m } : { status: "not_found" };
  },
}));

// Хранилища задач и форм — в памяти: обработчик задач идёт в базу раньше, чем ответить.
vi.mock("../databot/data/supabase-store", async () => {
  const { MemoryStore } = await import("../databot/data/memory-store");
  const store = new MemoryStore();
  return { createSupabaseStore: () => store };
});
vi.mock("./form", async (importOriginal) => {
  const real = await importOriginal<typeof import("./form")>();
  const forms = new real.MemoryTeamForms();
  return { ...real, supabaseTeamForms: () => forms };
});

import { founderIds, isFounder } from "./config";
import { registerHandlers } from "./bot";
import { resetSeenCache, shouldTouch, TOUCH_EVERY_MS } from "./seen";

const member = (chat_id: number, username: string, role: TeamMember["role"] = "member"): TeamMember => ({
  chat_id, username, display_name: username, role, joined_at: "2026-10-01T00:00:00Z",
  added_by: null, last_seen_at: null, digest_opt_in: true,
});

describe("фаундеры из TEAM_FOUNDER_IDS", () => {
  it("разбирает ID через запятую, с пробелами и мусором", () => {
    expect([...founderIds(" 111, 222 ,abc,,-333")]).toEqual([111, 222, -333]);
    expect(founderIds("", "").size).toBe(0);
  });

  it("без TEAM_FOUNDER_IDS фаундеры — владельцы «Цифр команды» (DATABOT_OWNER_IDS)", () => {
    expect([...founderIds("", "5, 6")]).toEqual([5, 6]);
    expect([...founderIds("  ", "5")]).toEqual([5]);
    expect([...founderIds("1", "5")]).toEqual([1]);
  });

  it("фаундер — тот, чей ID в списке, а не тот, у кого role=owner", () => {
    expect(isFounder(111, "111,222")).toBe(true);
    expect(isFounder(5, "111,222")).toBe(false);
  });
});

describe("/kick", () => {
  let replies: Array<{ chat: number; text: string }>;
  let send: (text: string, from: number) => Promise<void>;

  beforeEach(() => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "9");
    roster.clear();
    removed.length = 0;
    roster.set(9, member(9, "founder"));
    // Первый вошедший с role=owner по старой схеме — не фаундер.
    roster.set(1, member(1, "alice", "owner"));
    roster.set(2, member(2, "bob"));
    replies = [];
    const bot = new Bot("999:test", { botInfo: { id: 999, is_bot: true, first_name: "Пятница", username: "t_bot" } as UserFromGetMe });
    bot.api.config.use(async (_prev, method, payload) => {
      const p = payload as { chat_id: number; text?: string };
      if (method === "sendMessage") replies.push({ chat: p.chat_id, text: String(p.text) });
      return { ok: true, result: { message_id: 1 } } as Awaited<ReturnType<typeof _prev>>;
    });
    registerHandlers(bot);
    let id = 0;
    send = async (text, from) => {
      await bot.handleUpdate({ update_id: ++id, message: { message_id: id, date: 1, text,
        chat: { id: from, type: "private", first_name: "x" }, from: { id: from, is_bot: false, first_name: "x" },
        entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] } } as Update);
    };
  });
  afterEach(() => vi.unstubAllEnvs());

  it("не-фаундер получает отказ, даже с role=owner в базе", async () => {
    await send("/kick @bob", 1);
    expect(removed).toEqual([]);
    expect(replies.at(-1)?.text).toContain("только фаундеры");
  });

  it("фаундер убирает участника", async () => {
    await send("/kick @bob", 9);
    expect(removed).toEqual(["@bob"]);
    expect(replies.at(-1)?.text).toContain("Убрала: @bob");
  });
});

describe("последний визит", () => {
  let press: (data: string, from: number) => Promise<void>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T09:00:00Z"));
    resetSeenCache();
    touched.length = 0;
    roster.clear();
    roster.set(2, member(2, "bob"));
    const bot = new Bot("999:test", { botInfo: { id: 999, is_bot: true, first_name: "Пятница", username: "t_bot" } as UserFromGetMe });
    bot.api.config.use(async () => ({ ok: true, result: { message_id: 1 } }) as never);
    registerHandlers(bot);
    let id = 0;
    press = async (data, from) => {
      await bot.handleUpdate({ update_id: ++id, callback_query: { id: `c${id}`, chat_instance: "x", data,
        from: { id: from, is_bot: false, first_name: "x" },
        message: { message_id: 5, date: 1, text: "x", chat: { id: from, type: "private", first_name: "x" } } } } as Update);
    };
  });
  afterEach(() => vi.useRealTimers());

  it("нажатие кнопки в карточке задачи обновляет last_seen_at, но не чаще раза в 5 минут", async () => {
    await press("tk:o:1:me:0", 2);
    expect(touched).toEqual([{ id: 2, at: Date.parse("2026-10-07T09:00:00Z") }]);
    vi.setSystemTime(new Date("2026-10-07T09:03:00Z"));
    await press("tk:l:done:0", 2);
    expect(touched).toHaveLength(1);
    vi.setSystemTime(new Date("2026-10-07T09:05:00Z"));
    await press("tk:l:me:0", 2);
    expect(touched).toHaveLength(2);
  });

  it("кэш раз в 5 минут — на человека, а не на всех", () => {
    const cache = new Map<number, number>();
    const t0 = new Date("2026-10-07T09:00:00Z");
    expect(shouldTouch(1, t0, cache)).toBe(true);
    expect(shouldTouch(2, t0, cache)).toBe(true);
    expect(shouldTouch(1, new Date(t0.getTime() + TOUCH_EVERY_MS - 1), cache)).toBe(false);
    expect(shouldTouch(1, new Date(t0.getTime() + TOUCH_EVERY_MS), cache)).toBe(true);
  });
});
