import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Update, UserFromGetMe } from "grammy/types";
import { createDatabot } from "./bot";
import { MemoryStore } from "./data/memory-store";

const person = (id: number, username: string) => ({ id, is_bot: false, first_name: username, username });
let store: MemoryStore;
let calls: Array<{ method: string; payload: Record<string, unknown> }>;
let send: (text: string, id?: number, username?: string, messageId?: number) => Promise<void>;
let rejectDelivery: boolean;

beforeEach(async () => {
  vi.stubEnv("DATABOT_OWNER_IDS", "9");
  vi.stubEnv("DATABOT_TASK_CHAT_ID", "");
  vi.stubEnv("DATABOT_TASK_SOURCE_THREAD_IDS", "");
  store = new MemoryStore(); calls = []; rejectDelivery = false;
  for (const [chat_id, username] of [[9, "owner"], [1, "alice"], [2, "bob"]] as const) {
    await store.upsertMember({ chat_id, username, zone: "smm", display_name: null,
      is_owner: chat_id === 9, invited_by: null }, new Date());
  }
  const bot = createDatabot("999:test", { store, botInfo: {
    id: 999, is_bot: true, first_name: "test", username: "test_bot",
  } as UserFromGetMe });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "sendMessage" && "chat_id" in payload && payload.chat_id === 1 && rejectDelivery)
      throw Object.assign(new Error("Forbidden"), { error_code: 403 });
    return { ok: true, result: { message_id: calls.length + 100 } } as Awaited<ReturnType<typeof _prev>>;
  });
  let updateId = 0;
  send = async (text, id = 9, username = "owner", messageId = 10) => {
    await bot.handleUpdate({ update_id: ++updateId, message: { message_id: messageId, date: 100,
      chat: { id, type: "private", first_name: username }, from: person(id, username), text } } as Update);
  };
});
afterEach(() => vi.unstubAllEnvs());

describe("owner task lists", () => {
  it("splits, sends only to exact recipients, and ignores repeat delivery", async () => {
    const list = "/assign\n@ALICE — Сделать <макет>\n@bob — Проверить текст";
    await send(list); await send(list);
    expect(store.assignedTasks.size).toBe(2);
    expect([...store.assignedTasks.values()].map(t => t.assignee_id)).toEqual([1, 2]);
    expect(calls.filter(c => c.method === "sendMessage" && c.payload.chat_id === 1)).toHaveLength(1);
    expect(calls.filter(c => c.method === "sendMessage" && c.payload.chat_id === 2)).toHaveLength(1);
    expect(String(calls.find(c => c.payload.chat_id === 1)?.payload.text)).toContain("&lt;макет&gt;");
    await send("/assigned", 1, "alice");
    expect(calls.some(c => c.payload.chat_id === 1 && String(c.payload.text).includes("Сделать &lt;макет&gt;"))).toBe(true);
    await send("/assigned", 2, "bob");
    expect(calls.filter(c => c.payload.chat_id === 2 && String(c.payload.text).includes("макет"))).toHaveLength(0);
  });

  it("rejects non-owner and unknown recipients without partial import", async () => {
    await send("/assign\n@bob — Чужая задача", 1, "alice");
    await send("/assign\n@alice — Макет\n@missing — Текст");
    expect(store.assignedTasks.size).toBe(0);
    await send("@alice — Макет\nПроверить текст", 9, "owner", 12);
    expect(store.assignedTasks.size).toBe(0);
  });

  it("keeps a failed delivery and allows explicit retry", async () => {
    rejectDelivery = true;
    await send("/assign\n@alice — Макет");
    const task = [...store.assignedTasks.values()][0];
    expect(task.delivery_state).toBe("failed");
    rejectDelivery = false;
    await send(`/assign_retry ${task.id}`, 9, "owner", 11);
    expect(task.delivery_state).toBe("sent");
    expect(calls.filter(c => c.method === "sendMessage" && c.payload.chat_id === 1)).toHaveLength(2);
  });
});
