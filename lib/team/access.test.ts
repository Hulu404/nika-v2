import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import type { TeamMember } from "./access";

// Состав команды вместо Supabase: проверяем права, а не базу.
const roster = new Map<number, TeamMember>();
const removed: string[] = [];
vi.mock("./access", () => ({
  findMember: async (id: number) => roster.get(id) ?? null,
  touchMember: async () => {},
  joinTeam: async () => ({ status: "failed" }),
  listTeam: async () => [...roster.values()],
  setDigestOptIn: async () => true,
  removeMember: async (target: string) => {
    removed.push(target);
    const m = [...roster.values()].find((x) => `@${x.username}` === target);
    return m ? { status: "removed", member: m } : { status: "not_found" };
  },
}));

import { founderIds, isFounder } from "./config";
import { registerHandlers } from "./bot";

const member = (chat_id: number, username: string, role: TeamMember["role"] = "member"): TeamMember => ({
  chat_id, username, display_name: username, role, joined_at: "2026-10-01T00:00:00Z",
  added_by: null, last_seen_at: null, digest_opt_in: true,
});

describe("фаундеры из TEAM_FOUNDER_IDS", () => {
  it("разбирает ID через запятую, с пробелами и мусором", () => {
    expect([...founderIds(" 111, 222 ,abc,,-333")]).toEqual([111, 222, -333]);
    expect(founderIds(undefined).size).toBe(0);
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
