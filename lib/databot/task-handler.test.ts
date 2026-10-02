import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Update, UserFromGetMe } from "grammy/types";
import { createDatabot } from "./bot";
import { MemoryStore } from "./data/memory-store";

const group = { id: -1001, type: "supergroup", title: "test" };
const person = (id: number, username: string) => ({ id, is_bot: false, first_name: username, username });
let store: MemoryStore;
let calls: Array<{ method: string; payload: Record<string, unknown> }>;
let send: (update: Record<string, unknown>) => Promise<void>;

beforeEach(async () => {
  vi.stubEnv("DATABOT_OWNER_IDS", "9");
  // Even old group settings must not enable a second task source.
  vi.stubEnv("DATABOT_TASK_CHAT_ID", "-1001");
  vi.stubEnv("DATABOT_TASK_SOURCE_THREAD_IDS", "10");
  store = new MemoryStore();
  calls = [];
  await store.upsertMember({ chat_id: 9, username: "owner", zone: "smm", display_name: null,
    is_owner: true, invited_by: null }, new Date());
  const bot = createDatabot("999:test", { store, botInfo: {
    id: 999, is_bot: true, first_name: "test", username: "test_bot",
  } as UserFromGetMe });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: { message_id: 777 } } as Awaited<ReturnType<typeof _prev>>;
  });
  let nextId = 0;
  send = async update => { await bot.handleUpdate({ update_id: ++nextId, ...update } as Update); };
});
afterEach(() => vi.unstubAllEnvs());

describe("single task source", () => {
  it("ignores pinned and edited group messages even with legacy group settings", async () => {
    const source = { message_id: 100, date: 100, chat: group, message_thread_id: 10,
      from: person(9, "owner"), text: "Что: Макет\nКто делает: @owner\nК какому дню и часу: 2026-10-03T18:00+03:00" };
    await send({ message: { ...source, message_id: 101, text: undefined, pinned_message: source } });
    await send({ edited_message: { ...source, edit_date: 200 } });
    expect(store.tasks.size).toBe(0);
    expect(store.assignedTasks.size).toBe(0);
    expect(calls.filter(call => call.method === "sendMessage")).toHaveLength(0);
  });

  it("leaves configured groups", async () => {
    await send({ my_chat_member: { chat: group, from: person(9, "owner"), date: 100,
      old_chat_member: { status: "left", user: { id: 999, is_bot: true, first_name: "test" } },
      new_chat_member: { status: "member", user: { id: 999, is_bot: true, first_name: "test" } } } });
    expect(calls.some(call => call.method === "leaveChat" && call.payload.chat_id === group.id)).toBe(true);
    expect(store.tasks.size).toBe(0);
  });
});
