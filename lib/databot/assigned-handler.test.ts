import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Update, UserFromGetMe } from "grammy/types";
import { createDatabot } from "./bot";
import { MemoryStore } from "./data/memory-store";

const person = (id: number, username: string) => ({ id, is_bot: false, first_name: username, username });
let store: MemoryStore;
let calls: Array<{ method: string; payload: Record<string, unknown> }>;
let send: (text: string, id?: number, username?: string, messageId?: number) => Promise<void>;
let rejectDelivery: boolean;
let press: (data: string, id?: number, username?: string) => Promise<void>;
// Четверг, 01.10.2026, 12:00 МСК.
const NOW = new Date("2026-10-01T09:00:00Z");

beforeEach(async () => {
  vi.stubEnv("DATABOT_OWNER_IDS", "9");
  vi.stubEnv("DATABOT_TASK_CHAT_ID", "");
  vi.stubEnv("DATABOT_TASK_SOURCE_THREAD_IDS", "");
  store = new MemoryStore(); calls = []; rejectDelivery = false;
  for (const [chat_id, username] of [[9, "owner"], [1, "alice"], [2, "bob"]] as const) {
    await store.upsertMember({ chat_id, username, zone: "smm", display_name: null,
      is_owner: chat_id === 9, invited_by: null }, new Date());
  }
  store.clock = () => NOW;
  const bot = createDatabot("999:test", { store, now: () => NOW, botInfo: {
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
  press = async (data, id = 1, username = "alice") => {
    await bot.handleUpdate({ update_id: ++updateId, callback_query: { id: `cb${updateId}`, from: person(id, username),
      chat_instance: "t", data, message: { message_id: 500, date: 100, chat: { id, type: "private", first_name: username } } } } as Update);
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

const texts = (chat: number) => calls.filter(c => c.method === "sendMessage" && c.payload.chat_id === chat).map(c => String(c.payload.text));
const edits = () => calls.filter(c => c.method === "editMessageText");
const buttonsOf = (payload: Record<string, unknown>) => JSON.stringify(payload.reply_markup ?? null);

describe("lifecycle of assigned tasks", () => {
  it("parses deadlines, delivers with buttons and reports them back to the owner", async () => {
    await send("/assign\n@alice — Макет до пт 18:00\n@bob — Текст");
    const [a, b] = [...store.assignedTasks.values()];
    expect(a).toMatchObject({ what: "Макет", due_at: "2026-10-02T15:00:00.000Z", status: "open" });
    expect(b.due_at).toBeNull();
    const delivery = calls.find(c => c.payload.chat_id === 1)!;
    expect(String(delivery.payload.text)).toContain("Срок: пт 02.10, 18:00");
    expect(buttonsOf(delivery.payload)).toContain("a:take:1");
    expect(texts(9).at(-1)).toContain("#1 @alice — Макет · до пт 02.10, 18:00");
  });

  it("rejects a deadline in the past for the whole list", async () => {
    await send("/assign\n@alice — Макет до 30.09\n@bob — Текст");
    expect(store.assignedTasks.size).toBe(0);
    expect(texts(9).at(-1)).toContain("Строка 2: Срок уже прошёл");
  });

  it("assignee buttons move status, owner hears about done once, others cannot press", async () => {
    await send("/assign\n@alice — Макет");
    await press("a:take:1", 2, "bob");
    expect(store.assignedTasks.get(1)?.status).toBe("open");
    expect(texts(2).at(-1)).toContain("только исполнителю");
    await press("a:take:1");
    expect(store.assignedTasks.get(1)?.status).toBe("taken");
    expect(texts(9).some(t => t.includes("@alice"))).toBe(true); // только подтверждение импорта
    const before = texts(9).length;
    await press("a:done:1"); await press("a:done:1");
    expect(store.assignedTasks.get(1)?.status).toBe("done");
    expect(texts(9).slice(before)).toEqual([expect.stringContaining("задача #1 — сделано")]);
    expect(buttonsOf(edits().at(-1)!.payload)).toContain("a:reopen:1");
    await press("a:reopen:1");
    expect(store.assignedTasks.get(1)?.status).toBe("taken");
    expect(texts(9).at(-1)).toContain("снова в работе");
  });

  it("decline notifies the owner with how to reassign", async () => {
    await send("/assign\n@alice — Макет");
    await press("a:decline:1");
    expect(texts(9).at(-1)).toContain("не сможет");
    expect(texts(9).at(-1)).toContain("/assign_cancel 1");
  });

  it("«Мои задачи» shows open tasks as cards with buttons", async () => {
    await send("/assign\n@alice — Макет до 03.10\n@alice — Звонок");
    await press("a:done:2");
    calls.length = 0;
    await send("Мои задачи", 1, "alice");
    const out = calls.filter(c => c.payload.chat_id === 1);
    expect(String(out[0].payload.text)).toContain("в работе 1 · сделано за 7 дн.: 1");
    expect(String(out[1].payload.text)).toContain("Срок: сб 03.10");
    expect(buttonsOf(out[1].payload)).toContain("a:done:1");
  });

  it("owner overview groups by person, marks overdue and undelivered", async () => {
    rejectDelivery = true;
    await send("/assign\n@alice — Макет до 18:00\n@bob — Текст до завтра");
    rejectDelivery = false;
    store.assignedTasks.get(1)!.due_at = "2026-10-01T08:00:00.000Z";
    await send("/assign_status", 9, "owner", 11);
    const overview = texts(9).at(-1)!;
    expect(overview).toContain("в работе 2, просрочено 1");
    expect(overview).toMatch(/<b>@alice<\/b>\n⚠️ #1 Макет · до чт 01\.10, 11:00 · 📭 не доставлено/);
    expect(overview).toContain("🆕 #2 Текст · до пт 02.10");
    await send("/assign_status", 1, "alice", 12);
    expect(texts(1).at(-1)).toContain("только владелец");
  });

  it("edit, deadline change and cancel reach the assignee", async () => {
    await send("/assign\n@alice — Макет");
    await send("/assign_edit 1 Макет v2 до пт 12:00", 9, "owner", 11);
    expect(store.assignedTasks.get(1)).toMatchObject({ what: "Макет v2", due_at: "2026-10-02T09:00:00.000Z" });
    expect(texts(1).at(-1)).toContain("Задача #1 изменена");
    expect(edits().some(c => c.payload.chat_id === 1 && c.payload.message_id === store.assignedTasks.get(1)!.delivered_message_id)).toBe(true);
    await send("/assign_due 1 нет", 9, "owner", 12);
    expect(store.assignedTasks.get(1)?.due_at).toBeNull();
    await send("/assign_due 1 когда-нибудь", 9, "owner", 13);
    expect(texts(9).at(-1)).toContain("Не понял срок");
    await send("/assign_cancel 1", 9, "owner", 14);
    expect(store.assignedTasks.get(1)?.status).toBe("cancelled");
    expect(texts(1).at(-1)).toContain("Задача #1 отменена");
    await send("/assign_edit 1 Новый текст", 9, "owner", 15);
    expect(texts(9).at(-1)).toContain("уже закрыта");
    await press("a:take:1");
    expect(store.assignedTasks.get(1)?.status).toBe("cancelled");
  });
});
