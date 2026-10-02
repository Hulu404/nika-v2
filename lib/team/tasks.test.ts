import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bot, type Api } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { MemoryStore } from "../databot/data/memory-store";
import { handleTeamTaskUpdate, type TeamTaskDeps } from "./tasks";
import type { TeamMember } from "./access";
import { setTeamCommands, TEAM_COMMANDS, TEAM_MEMBER_COMMANDS } from "./bot";

const NOW = new Date("2026-10-01T09:00:00Z");
const people: TeamMember[] = [
  { chat_id: 9, username: "owner", display_name: "Owner", role: "owner", joined_at: NOW.toISOString(),
    added_by: null, last_seen_at: null, digest_opt_in: true },
  { chat_id: 1, username: "alice", display_name: "Alice", role: "member", joined_at: NOW.toISOString(),
    added_by: 9, last_seen_at: null, digest_opt_in: true },
  { chat_id: 2, username: "bob", display_name: "Bob", role: "member", joined_at: NOW.toISOString(),
    added_by: 9, last_seen_at: null, digest_opt_in: true },
];
const person = (id: number, username: string) => ({ id, is_bot: false, first_name: username, username });
let store: MemoryStore;
let calls: Array<{ method: string; payload: Record<string, unknown> }>;
let send: (text: string, id?: number, username?: string, messageId?: number) => Promise<void>;
let press: (data: string, id?: number, username?: string) => Promise<void>;

beforeEach(() => {
  vi.stubEnv("DATABOT_OWNER_IDS", "");
  store = new MemoryStore();
  store.clock = () => NOW;
  calls = [];
  const deps: TeamTaskDeps = {
    store,
    findMember: async id => people.find(member => member.chat_id === id) ?? null,
    listTeam: async () => people,
  };
  const bot = new Bot("999:test", { botInfo: {
    id: 999, is_bot: true, first_name: "Пятница", username: "test_team_bot",
  } as UserFromGetMe });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: { message_id: 100 + calls.length } } as Awaited<ReturnType<typeof _prev>>;
  });
  bot.use(ctx => handleTeamTaskUpdate(ctx, deps, NOW).then(() => {}));
  let updateId = 0;
  send = async (text, id = 9, username = "owner", messageId = 10) => {
    await bot.handleUpdate({ update_id: ++updateId, message: { message_id: messageId, date: 100,
      chat: { id, type: "private", first_name: username }, from: person(id, username), text } } as Update);
  };
  press = async (data, id = 1, username = "alice") => {
    await bot.handleUpdate({ update_id: ++updateId, callback_query: { id: `cb${updateId}`, from: person(id, username),
      chat_instance: "test", data, message: { message_id: 500, date: 100,
        chat: { id, type: "private", first_name: username } } } } as Update);
  };
});
afterEach(() => vi.unstubAllEnvs());

describe("Пятница: задачи команды", () => {
  it("delivers a shared row to each named member and keeps retries idempotent", async () => {
    const list = "/assign\nМакет / пт 18:00 / @alice + @bob\nТекст / 03.10 / @bob";
    await send(list);
    await send(list);
    expect(store.assignedTasks.size).toBe(3);
    expect([...store.assignedTasks.values()].map(task => [task.line, task.username, task.assignee_id]))
      .toEqual([[2, "alice", 1], [2, "bob", 2], [3, "bob", 2]]);
    const ownerReport = calls.filter(call => call.method === "sendMessage" && call.payload.chat_id === 9)
      .map(call => String(call.payload.text)).find(text => text.includes("Сохранено задач: 3"))!;
    expect(ownerReport).toContain("Макет -- пт 02.10, 18:00 -- @alice + @bob");
    expect(ownerReport).toContain("#3 @bob — Текст");
    expect(ownerReport).not.toContain("#1 @alice — Макет");
    expect(ownerReport).not.toContain("#2 @bob — Макет");
    expect(calls.filter(call => call.method === "sendMessage" && call.payload.chat_id === 1 &&
      String(call.payload.text).includes("Макет"))).toHaveLength(1);
    expect(calls.filter(call => call.method === "sendMessage" && call.payload.chat_id === 2 &&
      String(call.payload.text).includes("Макет"))).toHaveLength(1);
    expect(calls.some(call => call.method === "sendMessage" && call.payload.chat_id === 1 &&
      String(call.payload.text).includes("Макет") && String(call.payload.text).includes("Вместе с вами: @bob"))).toBe(true);
    expect(calls.some(call => call.method === "sendMessage" && call.payload.chat_id === 2 &&
      String(call.payload.text).includes("Макет") && String(call.payload.text).includes("Вместе с вами: @alice"))).toBe(true);
    expect(calls.some(call => call.method === "sendMessage" && call.payload.chat_id === 2 &&
      String(call.payload.text).includes("Текст") && String(call.payload.text).includes("Вместе с вами"))).toBe(false);
    await press("a:done:1", 1, "alice");
    expect(store.assignedTasks.get(1)?.status).toBe("done");
    expect(store.assignedTasks.get(2)?.status).toBe("open");
    expect(calls.some(call => call.method === "editMessageText" &&
      String(call.payload.text).includes("Вместе с вами: @bob"))).toBe(true);
    await send("/assigned", 2, "bob", 11);
    expect(calls.some(call => call.method === "sendMessage" && call.payload.chat_id === 2 &&
      String(call.payload.text).includes("Макет") && String(call.payload.text).includes("Вместе с вами: @alice"))).toBe(true);
  });

  it("rejects an unknown co-assignee before saving any tasks", async () => {
    await send("/assign\nМакет / завтра / @alice + @missing");
    expect(store.assignedTasks.size).toBe(0);
  });
  it("publishes owner task commands only in the owner's chat menu", async () => {
    const setMyCommands = vi.fn().mockResolvedValue(true);
    const api = { setMyCommands } as unknown as Api;
    await setTeamCommands(api, people[0]);
    expect(setMyCommands).toHaveBeenCalledWith(TEAM_COMMANDS,
      { scope: { type: "chat", chat_id: 9 } });
    await setTeamCommands(api, people[1]);
    expect(setMyCommands).toHaveBeenCalledWith(TEAM_MEMBER_COMMANDS,
      { scope: { type: "chat", chat_id: 1 } });
    expect(TEAM_COMMANDS.map(c => c.command)).toEqual(expect.arrayContaining(["assign", "assign_status", "tasks", "today"]));
    expect(TEAM_MEMBER_COMMANDS.some(c => c.command === "assign")).toBe(false);
  });

  it("takes owner tasks, delivers by username, and shows completion in the owner overview", async () => {
    await send("/assign\nПодготовить макет / пт 18:00 / @alice");
    expect(store.assignedTasks.size).toBe(1);
    expect(calls.some(call => call.method === "sendMessage" && call.payload.chat_id === 1 &&
      String(call.payload.text).includes("Подготовить макет"))).toBe(true);
    await send("/tasks", 1, "alice", 11);
    expect(calls.some(call => call.payload.chat_id === 1 && String(call.payload.text).includes("Срок: пт 02.10, 18:00"))).toBe(true);
    await press("a:done:1");
    await send("/assign_status", 9, "owner", 12);
    expect(calls.some(call => call.payload.chat_id === 9 && String(call.payload.text).includes("✅ #1 Подготовить макет"))).toBe(true);
  });

  it("does not allow a team member to import tasks", async () => {
    await send("/assign\nЧужая задача / завтра / @alice", 1, "alice");
    expect(store.assignedTasks.size).toBe(0);
  });

  it("lets the owner cancel the pending task list", async () => {
    await send("/tasks", 9, "owner", 20);
    await send("/cancel", 9, "owner", 21);
    await send("Макет / завтра / @alice", 9, "owner", 22);
    expect(store.assignedTasks.size).toBe(0);
    expect(calls.some(call => call.payload.chat_id === 9 && call.payload.text === "Загрузка задач отменена.")).toBe(true);
  });
});
