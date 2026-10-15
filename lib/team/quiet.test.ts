import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../databot/data/memory-store";
import { dispatchTeamMinute } from "./ai/assistant";
import { MemoryDraftStore, MemoryReminderStore } from "./ai/stores";
import { MASHA_EVENTS, TEAM, call, harness } from "./ai/test-harness";
import { AWAY_HEAD, MemoryOutboxStore, configureOutbox, flushOutbox, quietApi, sendOrQueue } from "./outbox";
import { isQuiet, isQuietEve, quietEnd } from "./quiet";
import { deliverAssigned, syncTeamTaskMembers } from "./tasks";

const msk = (local: string) => new Date(`${local}+03:00`);

type Sent = { chat: number; text: string; buttons: string[] };
function fakeApi() {
  const sent: Sent[] = [];
  const api = {
    sendMessage: async (chat: number, text: string, other?: { reply_markup?: { inline_keyboard?: Array<Array<{ text: string }>> } }) => {
      sent.push({ chat, text, buttons: (other?.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.text) });
      return { message_id: sent.length } as never;
    },
  };
  return { api, sent };
}

describe("тихие часы 22:00–09:00 МСК", () => {
  it("границы и утро", () => {
    expect(isQuiet(msk("2026-10-15T21:59"))).toBe(false);
    expect(isQuiet(msk("2026-10-15T22:00"))).toBe(true);
    expect(isQuiet(msk("2026-10-16T08:59"))).toBe(true);
    expect(isQuiet(msk("2026-10-16T09:00"))).toBe(false);
    expect(isQuietEve(msk("2026-10-15T21:30"))).toBe(true);
    expect(isQuietEve(msk("2026-10-15T21:29"))).toBe(false);
    expect(quietEnd(msk("2026-10-15T23:40")).toISOString()).toBe(msk("2026-10-16T09:00").toISOString());
    expect(quietEnd(msk("2026-10-16T03:00")).toISOString()).toBe(msk("2026-10-16T09:00").toISOString());
  });
});

describe("очередь team_outbox", () => {
  let outbox: MemoryOutboxStore;
  beforeEach(() => {
    outbox = new MemoryOutboxStore();
  });

  it("днём — сразу; ночью — в очередь до 09:00; в 09:00 одно сообщение уходит как было", async () => {
    const { api, sent } = fakeApi();
    expect((await sendOrQueue(api as never, { chatId: 1, kind: "x", text: "днём" }, msk("2026-10-15T12:00"), outbox)).queued).toBeNull();
    const res = await sendOrQueue(api as never, { chatId: 1, kind: "x", text: "a < b", options: { reply_markup: { inline_keyboard: [[{ text: "Ок", callback_data: "ok" }]] } } }, msk("2026-10-15T23:00"), outbox);
    expect(res.queued?.toISOString()).toBe(msk("2026-10-16T09:00").toISOString());
    expect(sent.map((s) => s.text)).toEqual(["днём"]);
    expect(await flushOutbox(api as never, msk("2026-10-16T08:59"), outbox)).toBe(0);
    expect(await flushOutbox(api as never, msk("2026-10-16T09:00"), outbox)).toBe(1);
    expect(sent[1]).toEqual({ chat: 1, text: "a &lt; b", buttons: ["Ок"] });
    expect(await flushOutbox(api as never, msk("2026-10-16T09:01"), outbox)).toBe(0);
  });

  it("накопленные к 09:00 уведомления — одним сообщением «Пока тебя не было:»", async () => {
    const { api, sent } = fakeApi();
    const night = quietApi(api, "auto", msk("2026-10-15T23:10"), { outbox });
    await night.sendMessage(5, "Сколько пришло на «Кофе-ран»?", { reply_markup: { inline_keyboard: [[{ text: "Внести явку", callback_data: "at" }]] } } as never);
    await night.sendMessage(5, "Завтра кофе-ран. Проводим?", { reply_markup: { inline_keyboard: [[{ text: "Проводим", callback_data: "cc" }]] } } as never);
    await night.sendMessage(6, "Одно", undefined as never);
    expect(sent).toHaveLength(0);
    await flushOutbox(api as never, msk("2026-10-16T09:00"), outbox);
    expect(sent).toHaveLength(2);
    const five = sent.find((s) => s.chat === 5)!;
    expect(five.text.startsWith(`<b>${AWAY_HEAD}</b>`)).toBe(true);
    expect(five.text).toContain("• Сколько пришло");
    expect(five.text).toContain("• Завтра кофе-ран");
    expect(five.buttons).toEqual(["Внести явку", "Проводим"]);
    expect(sent.find((s) => s.chat === 6)!.text).toBe("Одно");
  });

  it("quietApi: нажавшему кнопку ночью — сразу, остальным — утром", async () => {
    const { api, sent } = fakeApi();
    const night = quietApi(api, "coffee", msk("2026-10-15T23:10"), { outbox, except: 8 });
    await night.sendMessage(8, "тебе", undefined as never);
    await night.sendMessage(1, "команде", undefined as never);
    expect(sent.map((s) => s.chat)).toEqual([8]);
    expect(outbox.rows.map((r) => r.chat_id)).toEqual([1]);
  });
});

describe("задачи ночью", () => {
  let outbox: MemoryOutboxStore;
  beforeEach(() => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "8,9");
    outbox = new MemoryOutboxStore();
    configureOutbox(outbox);
  });
  afterEach(() => {
    configureOutbox(undefined);
    vi.unstubAllEnvs();
  });

  it("задача, поставленная в 23:40, создаётся сразу, а исполнителю приходит в 09:00", async () => {
    const store = new MemoryStore();
    const night = msk("2026-10-15T23:40");
    await syncTeamTaskMembers({ store }, night, TEAM);
    store.clock = () => night;
    const tasks = await store.importAssignedTasks(9, 1, [{ line: 1, username: "gusarovame", what: "Найти пейсеров", due_at: null }]);
    const { api, sent } = fakeApi();
    const res = await deliverAssigned(api as never, store, tasks, "srbrkvss", night);
    expect(res.queued).toEqual([{ assignee: MASHA_EVENTS, at: msk("2026-10-16T09:00") }]);
    expect(sent).toHaveLength(0);
    expect((await store.getAssignedTask(tasks[0].id))!.delivery_state).toBe("sent");
    await flushOutbox(api as never, msk("2026-10-16T09:00"), outbox);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ chat: MASHA_EVENTS });
    expect(sent[0].text).toContain("Новая задача от @srbrkvss");
  });

  it("ассистент ночью: автор видит «Маша получит задачу в 9:00»", async () => {
    const h = harness();
    h.clock = msk("2026-10-15T23:40");
    h.script = [call("create_task", { assignees: [{ name: "Маше", qualifier: "из ивента" }], what: "Найти пейсеров", due: "2026-10-17" })];
    await h.say("поставь Маше из ивента найти пейсеров до субботы", 9);
    await h.press(h.button("✅ Подтвердить")!, 9);
    expect(h.last().text).toContain("🌙 Маша получит задачу в 9:00.");
    expect(h.sent.some((s) => s.chat === MASHA_EVENTS)).toBe(false);
    expect(outbox.rows.map((r) => r.chat_id)).toEqual([MASHA_EVENTS]);
  });

  it("личное «напомни в 23:30» приходит в 23:30", async () => {
    const reminders = new MemoryReminderStore();
    await reminders.create({ chat_id: 1, text: "выключить утюг", remind_at: msk("2026-10-15T23:30").toISOString(), task_id: null });
    const { api, sent } = fakeApi();
    await dispatchTeamMinute({ reminders, drafts: new MemoryDraftStore(), tasks: new MemoryStore(), outbox }, api as never, msk("2026-10-15T23:30"));
    expect(sent.map((s) => s.text)).toEqual(["⏰ Напоминание: выключить утюг"]);
    expect(outbox.rows).toHaveLength(0);
  });
});
