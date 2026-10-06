import { beforeEach, describe, expect, it } from "vitest";
import { noticeDue, reminderThresholds, sendAssignedReminders } from "./assigned-reminders";
import { MemoryStore } from "./data/memory-store";
import type { AssignedTask } from "./task-list";

const msk = (local: string) => new Date(`${local}+03:00`);
const task = (patch: Partial<AssignedTask>): AssignedTask => ({
  id: 1, line: 1, username: "alice", what: "Макет", due_at: msk("2026-10-03T18:00").toISOString(),
  source_chat_id: 9, source_message_id: 10, assignee_id: 1, assigned_by: 9,
  created_at: msk("2026-10-01T12:00").toISOString(), delivery_state: "sent", delivered_message_id: 5,
  status: "open", status_at: msk("2026-10-01T12:00").toISOString(), reminded_at: null,
  reminded_24_at: null, reminded_12_at: null, reminded_3_at: null, overdue_notified_at: null,
  ...patch,
});

describe("reminderThresholds", () => {
  it("порог пропускается, если задачу поставили позже него", () => {
    expect(reminderThresholds(task({}))).toEqual([24, 12, 3]);
    // за 10 часов до срока — только «за 3 часа»
    expect(reminderThresholds(task({ created_at: msk("2026-10-03T08:00").toISOString() }))).toEqual([3]);
    // за 20 часов — «за 12» и «за 3»
    expect(reminderThresholds(task({ created_at: msk("2026-10-02T22:00").toISOString() }))).toEqual([12, 3]);
    expect(reminderThresholds(task({ due_at: null }))).toEqual([]);
  });

  it("задача короче трёх часов — без напоминаний", () => {
    const short = task({ created_at: msk("2026-10-03T16:00").toISOString() });
    expect(reminderThresholds(short)).toEqual([]);
    expect(noticeDue(short, msk("2026-10-03T17:00"))).toBeNull();
  });
});

describe("noticeDue", () => {
  it("каждый порог наступает в свой момент: за 24, 12 и 3 часа", () => {
    expect(noticeDue(task({}), msk("2026-10-02T17:59"))).toBeNull();
    expect(noticeDue(task({}), msk("2026-10-02T18:00"))).toMatchObject({ kind: "reminder", hours: 24, mark: "r24", silent: [] });
    const after24 = task({ reminded_24_at: "x" });
    expect(noticeDue(after24, msk("2026-10-03T05:59"))).toBeNull();
    expect(noticeDue(after24, msk("2026-10-03T06:00"))).toMatchObject({ hours: 12, mark: "r12", silent: [] });
    const after12 = task({ reminded_24_at: "x", reminded_12_at: "x" });
    expect(noticeDue(after12, msk("2026-10-03T14:59"))).toBeNull();
    expect(noticeDue(after12, msk("2026-10-03T15:00"))).toMatchObject({ hours: 3, mark: "r3", silent: [] });
    expect(noticeDue(task({ reminded_24_at: "x", reminded_12_at: "x", reminded_3_at: "x" }), msk("2026-10-03T16:00"))).toBeNull();
  });

  it("пропущенный тикер: уходит только самый поздний порог, ранние помечаются молча", () => {
    expect(noticeDue(task({}), msk("2026-10-03T16:00"))).toEqual({ kind: "reminder", hours: 3, mark: "r3", silent: ["r24", "r12"] });
    expect(noticeDue(task({ reminded_24_at: "x" }), msk("2026-10-03T16:00"))).toEqual({ kind: "reminder", hours: 3, mark: "r3", silent: ["r12"] });
  });

  it("тихих часов нет: напоминание уходит ночью в расчётное время", () => {
    const night = task({ due_at: msk("2026-10-03T02:00").toISOString(), created_at: msk("2026-09-29T12:00").toISOString() });
    expect(noticeDue(night, msk("2026-10-02T02:00"))).toMatchObject({ hours: 24 });
    expect(noticeDue(task({ due_at: msk("2026-10-03T02:00").toISOString(), created_at: msk("2026-09-29T12:00").toISOString(),
      reminded_24_at: "x", reminded_12_at: "x" }), msk("2026-10-02T23:00"))).toMatchObject({ hours: 3 });
  });

  it("просрочка — отдельное событие, даже если напоминания не было; закрытые не трогаем", () => {
    expect(noticeDue(task({}), msk("2026-10-03T18:00"))).toEqual({ kind: "overdue" });
    expect(noticeDue(task({ overdue_notified_at: "x" }), msk("2026-10-03T19:00"))).toBeNull();
    expect(noticeDue(task({ status: "done" }), msk("2026-10-03T19:00"))).toBeNull();
    expect(noticeDue(task({ status: "taken" }), msk("2026-10-03T19:00"))).toEqual({ kind: "overdue" });
    expect(noticeDue(task({ status: "taken" }), msk("2026-10-02T18:00"))).toMatchObject({ hours: 24 });
  });
});

describe("sendAssignedReminders", () => {
  let store: MemoryStore;
  let sent: Array<{ chat: number; text: string }>;
  const api = { sendMessage: async (chat: number | string, text: string) => {
    sent.push({ chat: Number(chat), text });
    return { message_id: sent.length } as never;
  } };

  beforeEach(async () => {
    store = new MemoryStore(); sent = [];
    for (const [chat_id, username] of [[9, "owner"], [1, "alice"]] as const)
      await store.upsertMember({ chat_id, username, zone: "smm", display_name: null, is_owner: chat_id === 9, invited_by: null }, new Date());
    store.clock = () => msk("2026-10-01T12:00");
    await store.importAssignedTasks(9, 10, [{ line: 1, username: "alice", what: "Макет", due_at: msk("2026-10-03T18:00").toISOString() }]);
  });

  it("напоминает исполнителю один раз на порог, сколько бы ни было проходов", async () => {
    await sendAssignedReminders({ store, api }, msk("2026-10-02T18:05"));
    await sendAssignedReminders({ store, api }, msk("2026-10-02T18:20"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ chat: 1 });
    expect(sent[0].text).toContain("Через 24 часа срок: сб 03.10, 18:00");
    await sendAssignedReminders({ store, api }, msk("2026-10-03T06:05"));
    expect(sent[1].text).toContain("Через 12 часов срок: сб 03.10, 18:00");
  });

  it("после деплоя с пропущенными порогами шлёт одно сообщение, а не три", async () => {
    await sendAssignedReminders({ store, api }, msk("2026-10-03T16:00"));
    await sendAssignedReminders({ store, api }, msk("2026-10-03T16:15"));
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("Через 3 часа срок");
    const t = store.assignedTasks.get(1)!;
    expect([t.reminded_24_at, t.reminded_12_at, t.reminded_3_at].every(Boolean)).toBe(true);
  });

  it("о просрочке пишет исполнителю и автору, тоже один раз", async () => {
    const res = await sendAssignedReminders({ store, api }, msk("2026-10-03T18:15"));
    await sendAssignedReminders({ store, api }, msk("2026-10-03T18:30"));
    expect(res).toEqual({ reminders: 0, overdue: 1 });
    expect(sent.map(s => s.chat)).toEqual([1, 9]);
    expect(sent[1].text).toContain("Просрочена задача #1 у @alice");
  });

  it("закрытая задача и новый срок: молчит, а после правки срока напоминает заново", async () => {
    await sendAssignedReminders({ store, api }, msk("2026-10-02T18:05"));
    await sendAssignedReminders({ store, api }, msk("2026-10-03T15:05"));
    expect(sent).toHaveLength(2);
    await store.editAssignedTask(1, 9, { due: msk("2026-10-06T18:00").toISOString() });
    const reset = store.assignedTasks.get(1)!;
    expect([reset.reminded_24_at, reset.reminded_12_at, reset.reminded_3_at, reset.overdue_notified_at]).toEqual([null, null, null, null]);
    await sendAssignedReminders({ store, api }, msk("2026-10-05T18:05"));
    expect(sent).toHaveLength(3);
    expect(sent[2].text).toContain("Через 24 часа срок: вт 06.10, 18:00");
    await store.setAssignedStatus(1, 1, "done");
    await sendAssignedReminders({ store, api }, msk("2026-10-06T19:00"));
    expect(sent).toHaveLength(3);
  });
});
