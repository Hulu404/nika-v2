import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Update, UserFromGetMe } from "grammy/types";
import { createDatabot } from "./bot";
import { MemoryStore } from "./data/memory-store";
import { databotTaskConfig } from "./config";

const text = "Что: Страница\nКто делает: @Alice\nК какому дню и часу: 2026-10-01T18:00+03:00";
const group = { id: -1001, type: "supergroup", title: "test" };
const source = { message_id: 100, date: 100, chat: group, message_thread_id: 10, text };
const person = (id: number, username = "alice") => ({ id, is_bot: false, first_name: "Test", username });
let store: MemoryStore;
let calls: Array<{ method: string; payload: Record<string, unknown> }>;
let send: (u: Record<string, unknown>) => Promise<void>;
let failPin: boolean;
let failSend: boolean;
let rejectSend: boolean;
let failUnpin: boolean;
let failEdit: boolean;
let canPin: boolean;
let nextWorkMessageId: number;
beforeEach(async () => {
  vi.stubEnv("DATABOT_OWNER_IDS", "9");
  vi.stubEnv("DATABOT_TASK_CHAT_ID", "-1001");
  vi.stubEnv("DATABOT_TASK_SOURCE_THREAD_IDS", "10,11");
  vi.stubEnv("DATABOT_TASK_WORK_THREAD_ID", "20");
  store = new MemoryStore(); calls = []; failPin = false; failSend = false; rejectSend = false; failUnpin = false; failEdit = false; canPin = true; nextWorkMessageId = 777;
  for (const [chat_id, username] of [[1, "alice"], [9, "admin"]] as const)
    await store.upsertMember({ chat_id, username, zone: "smm", display_name: null, is_owner: chat_id === 9, invited_by: null }, new Date());
  const bot = createDatabot("999:test", { store, botInfo: { id: 999, is_bot: true, first_name: "test", username: "test_bot" } as UserFromGetMe });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "pinChatMessage" && failPin) throw new Error("pin failed");
    if (method === "unpinChatMessage" && failUnpin) throw new Error("unpin failed");
    if (method === "editMessageText" && failEdit) throw new Error("edit failed");
    if (method === "sendMessage" && "chat_id" in payload && payload.chat_id === -1001 && "message_thread_id" in payload && payload.message_thread_id === 20 && failSend) throw new Error("network uncertain");
    if (method === "sendMessage" && "chat_id" in payload && payload.chat_id === -1001 && "message_thread_id" in payload && payload.message_thread_id === 20 && rejectSend) throw Object.assign(new Error("Forbidden"), { error_code: 403 });
    return { ok: true, result: method === "getChat" ? { id: 1, type: "private", username: "alice", first_name: "Test" } :
      method === "getChatMember" ? { status: "administrator", can_pin_messages: canPin } :
      method === "sendMessage" && "chat_id" in payload && payload.chat_id === -1001 && "message_thread_id" in payload && payload.message_thread_id === 20
        ? { message_id: nextWorkMessageId++ } : { message_id: 777 } } as Awaited<ReturnType<typeof _prev>>;
  });
  let n = 0;
  send = async u => { await bot.handleUpdate({ update_id: ++n, ...u } as Update); };
});
afterEach(() => vi.unstubAllEnvs());
const privateMessage = (text: string, uid = 1, username = "alice") => ({ message: { message_id: 1, date: 100, chat: { id: uid, type: "private", first_name: "Test" }, from: person(uid, username), text } });
const pin = () => send({ message: { ...source, message_id: 101, text: undefined, pinned_message: source, from: person(9) } });
const groupCommand = (text: string, uid = 9) => send({ message: { ...source, message_id: 102, text, from: person(uid), reply_to_message: source } });
const press = (data: string, uid = 1, username = "alice") => send({ callback_query: { id: `cb${Math.random()}`, from: person(uid, username), chat_instance: "test",
  data, message: { message_id: 99, date: 100, chat: { id: uid, type: "private", first_name: "Test" } } } });
const replies = () => calls.filter(c => c.method === "sendMessage").map(c => String(c.payload.text)).join("\n");

describe("Telegram task boundary", () => {
  it("does not ingest conversation or unknown edits; ignores unconfigured topics", async () => {
    await send({ message: { ...source, from: person(1) } });
    await send({ edited_message: { ...source, text: "разговор", edit_date: 200, from: person(1) } });
    await send({ message: { ...source, message_thread_id: 99, pinned_message: source, text: undefined } });
    expect(store.tasks.size).toBe(0); expect(calls).toHaveLength(0);
  });
  it("accepts pin and admin reply import, deduplicates, rejects member import", async () => {
    await groupCommand("/task_import", 1); expect(store.tasks.size).toBe(0);
    await groupCommand("/task_import"); await pin(); await pin();
    expect(store.tasks.size).toBe(1);
    await send({ edited_message: { ...source, edit_date: 200, text: text.replace("Страница", "Новая страница") } });
    expect([...store.tasks.values()][0].what).toBe("Новая страница");
  });
  it("removes a malformed edited message from the available pool", async () => {
    await pin(); await store.bindTask(1, 1, "alice", 9);
    await send({ edited_message: { ...source, text: "Идея без исполнителя и срока", edit_date: 200, from: person(9) } });
    expect(await store.listAvailableTasks(-1001)).toHaveLength(0);
    expect((await store.getTask(1))?.status).toBe("invalid");
  });
  it("leaves foreign groups, keeps configured group, never routes reports there", async () => {
    await send({ message: { ...source, chat: { ...group, id: -222 }, text: "/tasks" } });
    expect(calls.some(c => c.method === "leaveChat")).toBe(true);
    calls.length = 0;
    await send({ my_chat_member: { chat: group, from: person(9), date: 1, new_chat_member: { status: "administrator" } } });
    await groupCommand("/pro");
    expect(calls).toHaveLength(0);
  });
  it("binding and take publish once in work topic and pin", async () => {
    await pin();
    await send(privateMessage("/task_bind 1 1", 9, "admin"));
    await send(privateMessage("/task_take 1"));
    await send(privateMessage("/task_take 1"));
    const publications = calls.filter(c => c.method === "sendMessage" && c.payload.message_thread_id === 20);
    expect(publications).toHaveLength(1);
    expect(publications[0].payload).toMatchObject({ chat_id: -1001, parse_mode: "HTML", message_thread_id: 20 });
    expect(publications[0].payload.text).toContain("Что: Страница\nКто делает: @alice\nСрок:");
    expect(publications[0].payload.text).toContain('href="https://t.me/c/1/100"');
    expect(calls.filter(c => c.method === "pinChatMessage").map(c => c.payload.message_id)).toEqual([777]);
    expect((await store.getTask(1))?.claim).toMatchObject({ taken_by: 1, work_message_id: 777, send_state: "sent", pin_state: "pinned" });
    await send(privateMessage("/task_done 1"));
    expect((await store.getTask(1))?.status).toBe("done");
    expect((await store.listAvailableTasks(-1001))).toHaveLength(0);
    expect(calls.filter(c => c.method === "unpinChatMessage").map(c => c.payload.message_id).sort()).toEqual([100, 777]);
    expect(calls.some(c => c.method === "unpinAllChatMessages" || c.method === "unpinAllForumTopicMessages")).toBe(false);
  });
  it("retries pin without sending again", async () => {
    await pin(); await store.bindTask(1, 1, "alice", 9); failPin = true;
    await send(privateMessage("/task_take 1"));
    expect((await store.getTask(1))?.claim?.pin_state).toBe("failed");
    failPin = false; await send(privateMessage("/task_retry 1"));
    expect((await store.getTask(1))?.claim?.pin_state).toBe("pinned");
    expect(calls.filter(c => c.method === "sendMessage" && c.payload.message_thread_id === 20 && String(c.payload.text).startsWith("Задача #"))).toHaveLength(1);
  });
  it("uncertain send preserves claim and requires admin recovery", async () => {
    await pin(); await store.bindTask(1, 1, "alice", 9); failSend = true;
    await send(privateMessage("/task_take 1"));
    await send(privateMessage("/task_retry 1"));
    expect((await store.getTask(1))?.claim?.send_state).toBe("uncertain");
    expect(calls.filter(c => c.method === "sendMessage" && c.payload.message_thread_id === 20)).toHaveLength(1);
    expect(replies()).toContain("task_recover");
    store.clock = () => new Date(Date.now() + 61_000);
    await send(privateMessage("/task_reset_send 1 no_message", 9, "admin"));
    expect((await store.getTask(1))?.claim?.send_state).toBe("pending");
    failSend = false;
    await send(privateMessage("/task_retry 1"));
    expect((await store.getTask(1))?.claim?.send_state).toBe("sent");
  });
  it("explicit Telegram 403 can be retried after permissions are fixed", async () => {
    await pin(); await store.bindTask(1, 1, "alice", 9); rejectSend = true;
    await press("d:tsk:take:1");
    expect((await store.getTask(1))?.claim?.send_state).toBe("rejected");
    rejectSend = false;
    await send(privateMessage("/task_retry 1"));
    expect((await store.getTask(1))?.claim).toMatchObject({ send_state: "sent", pin_state: "pinned" });
  });
  it("uses ID and active membership; rejects changed username", async () => {
    await pin(); await store.bindTask(1, 1, "alice", 9);
    await send(privateMessage("/task_take 1", 1, "renamed"));
    expect((await store.getTask(1))?.status).toBe("available");
    await store.removeMember(1, new Date());
    await send(privateMessage("/tasks"));
    expect(replies()).toContain("Доступ только");
  });
  it("rejects another member's button and forged callback for both actions", async () => {
    await store.upsertMember({ chat_id: 2, username: "bob", zone: "smm", display_name: null, is_owner: false, invited_by: 9 }, new Date());
    await pin(); await store.bindTask(1, 1, "alice", 9);
    await press("d:tsk:take:1", 2, "bob");
    await press("d:tsk:take:999", 2, "bob");
    expect((await store.getTask(1))?.status).toBe("available");
    await press("d:tsk:take:1");
    await press("d:tsk:done:1", 2, "bob");
    expect((await store.getTask(1))?.status).toBe("active");
    expect(calls.filter(c => c.method === "sendMessage" && c.payload.message_thread_id === 20)).toHaveLength(1);
  });
  it("recovers a publication when DB fails after Telegram accepted send", async () => {
    await pin(); await store.bindTask(1, 1, "alice", 9);
    const original = store.taskAction.bind(store);
    let failSentOnce = true;
    store.taskAction = async (action, args) => {
      if (action === "sent" && failSentOnce) { failSentOnce = false; throw new Error("database unavailable"); }
      return original(action, args);
    };
    await press("d:tsk:take:1");
    expect((await store.getTask(1))?.claim).toMatchObject({ send_state: "uncertain", work_message_id: null });
    await press("d:tsk:retry:1");
    expect(calls.filter(c => c.method === "sendMessage" && c.payload.message_thread_id === 20)).toHaveLength(1);
    await send({ message: { message_id: 888, date: 100, chat: group, message_thread_id: 20, from: person(9, "admin"),
      text: "/task_recover 1", reply_to_message: { message_id: 777, date: 100, chat: group, message_thread_id: 20,
        from: { id: 999, is_bot: true, first_name: "test", username: "test_bot" }, text: "Задача #1\nЧто: Страница" } } });
    expect((await store.getTask(1))?.claim).toMatchObject({ send_state: "sent", work_message_id: 777, pin_state: "pinned" });
    expect(calls.filter(c => c.method === "sendMessage" && c.payload.message_thread_id === 20 && String(c.payload.text).startsWith("Задача #"))).toHaveLength(1);
  });
  it("DB failure before claim leaves task available and sends nothing to the group", async () => {
    await pin(); await store.bindTask(1, 1, "alice", 9);
    const original = store.taskAction.bind(store);
    store.taskAction = async (action, args) => {
      if (action === "take") throw new Error("database unavailable");
      return original(action, args);
    };
    await press("d:tsk:take:1");
    expect((await store.getTask(1))?.status).toBe("available");
    expect(calls.filter(c => c.method === "sendMessage" && c.payload.message_thread_id === 20)).toHaveLength(0);
  });
  it("menu shows only confirmed tasks, slots and the four-task rule; callback rechecks status", async () => {
    await pin();
    await send(privateMessage("/mytasks"));
    expect(replies()).toContain("свободных слотов: 4/4");
    expect(replies()).toContain("Сначала можно взять до четырёх задач");
    expect(calls.filter(c => c.payload.reply_markup && JSON.stringify(c.payload.reply_markup).includes("d:tsk:take"))).toHaveLength(0);
    await store.bindTask(1, 1, "alice", 9);
    calls.length = 0;
    await send(privateMessage("/mytasks"));
    expect(calls.some(c => JSON.stringify(c.payload.reply_markup ?? null).includes("d:tsk:take:1"))).toBe(true);
    await press("d:tsk:take:1");
    await press("d:tsk:take:1");
    expect(calls.filter(c => c.method === "sendMessage" && c.payload.message_thread_id === 20)).toHaveLength(1);
    expect((await store.getTask(1))?.status).toBe("active");
  });
  it("callback caps active tasks at four and allows a new one after completion", async () => {
    for (let message_id = 100; message_id < 105; message_id++) {
      await send({ message: { ...source, message_id: message_id + 100, text: undefined, from: person(9),
        pinned_message: { ...source, message_id } } });
      await store.bindTask(message_id - 99, 1, "alice", 9);
    }
    for (let taskId = 1; taskId <= 5; taskId++) await press(`d:tsk:take:${taskId}`);
    expect(await store.listActiveTasks(1, -1001)).toHaveLength(4);
    expect(replies()).toContain("четыре активные задачи");
    await press("d:tsk:done:1");
    await press("d:tsk:take:5");
    expect(await store.listActiveTasks(1, -1001)).toHaveLength(4);
  });
  it("refuses before claim if Telegram pin rights are absent", async () => {
    await pin(); await store.bindTask(1, 1, "alice", 9); canPin = false;
    await press("d:tsk:take:1");
    expect((await store.getTask(1))?.status).toBe("available");
    expect(replies()).toContain("Задача не взята");
  });
  it("completion button requests result, unpins exact messages and retries failures", async () => {
    await pin();
    await store.importTask({ ...([...store.tasks.values()][0]), requires_result: true, source_version: 101 });
    await store.bindTask(1, 1, "alice", 9);
    await press("d:tsk:take:1");
    await press("d:tsk:done:1");
    expect(replies()).toContain("пришлите ссылку");
    expect((await store.getTask(1))?.status).toBe("active");
    failUnpin = true;
    await send(privateMessage("/task_done 1 https://example.org/result"));
    expect((await store.getTask(1))?.claim?.work_unpin_state).toBe("failed");
    expect((await store.getTask(1))?.status).toBe("completing");
    expect(await store.listActiveTasks(1, -1001)).toHaveLength(1);
    failUnpin = false;
    await send(privateMessage("/mytasks"));
    expect(calls.some(c => JSON.stringify(c.payload.reply_markup ?? null).includes("Повторить оформление"))).toBe(true);
    await press("d:tsk:done:1");
    const unpins = calls.filter(c => c.method === "unpinChatMessage");
    expect(unpins.some(c => c.payload.message_id === 777)).toBe(true);
    expect(unpins.some(c => c.payload.message_id === 100)).toBe(true);
    expect((await store.getTask(1))?.claim).toMatchObject({ work_unpin_state: "done", source_unpin_state: "done", edit_state: "done" });
    expect((await store.getTask(1))?.status).toBe("done");
    expect(calls.some(c => c.method === "editMessageText" && String(c.payload.text).includes("<s>"))).toBe(true);
    expect(JSON.stringify(store.audit)).not.toContain("https://example.org/result");
  });
  it("edit failure keeps the slot occupied and retries without repeated unpins", async () => {
    await pin(); await store.bindTask(1, 1, "alice", 9);
    await press("d:tsk:take:1");
    failEdit = true;
    await press("d:tsk:done:1");
    expect((await store.getTask(1))?.status).toBe("completing");
    expect((await store.listActiveTasks(1, -1001))).toHaveLength(1);
    const unpinsBefore = calls.filter(c => c.method === "unpinChatMessage").length;
    failEdit = false;
    await press("d:tsk:done:1");
    expect((await store.getTask(1))?.status).toBe("done");
    expect(calls.filter(c => c.method === "unpinChatMessage")).toHaveLength(unpinsBefore);
  });
  it("escapes task text in the published HTML", async () => {
    await send({ message: { ...source, message_id: 102, text: undefined, from: person(9),
      pinned_message: { ...source, text: text.replace("Страница", "Страница <b>& детали") } } });
    await store.bindTask(1, 1, "alice", 9);
    await press("d:tsk:take:1");
    const published = calls.find(c => c.method === "sendMessage" && c.payload.message_thread_id === 20);
    expect(published?.payload.text).toContain("&lt;b&gt;&amp; детали");
    expect(published?.payload.text).toContain("Источник: <a href=");
    expect(store.audit.some(a => JSON.stringify(a).includes("детали"))).toBe(false);
  });
  it("shows an identity error for a missing or ambiguous username", async () => {
    await pin(); await store.bindTask(1, 1, "alice", 9);
    await send(privateMessage("/mytasks", 1, ""));
    expect(replies()).toContain("ник отсутствует");
    await store.upsertMember({ chat_id: 2, username: "ALICE", zone: "smm", display_name: null, is_owner: false, invited_by: 9 }, new Date());
    calls.length = 0;
    await send(privateMessage("/mytasks"));
    expect(replies()).toContain("неоднозначен");
  });
  it("fails closed on incomplete or invalid config", () => {
    vi.stubEnv("DATABOT_TASK_SOURCE_THREAD_IDS", ""); expect(databotTaskConfig()).toBeNull();
    vi.stubEnv("DATABOT_TASK_SOURCE_THREAD_IDS", "10");
    vi.stubEnv("DATABOT_TASK_WORK_THREAD_ID", ""); expect(databotTaskConfig()?.workThread).toBeNull();
  });
});
