import { beforeEach, describe, expect, it } from "vitest";
import { noticeDue, reminderAt, sendAssignedReminders } from "./assigned-reminders";
import { MemoryStore } from "./data/memory-store";
import type { AssignedTask } from "./task-list";

const msk = (local: string) => new Date(`${local}+03:00`);
const task = (patch: Partial<AssignedTask>): AssignedTask => ({
  id: 1, line: 1, username: "alice", what: "Макет", due_at: msk("2026-10-03T18:00").toISOString(),
  source_chat_id: 9, source_message_id: 10, assignee_id: 1, assigned_by: 9,
  created_at: msk("2026-10-01T12:00").toISOString(), delivery_state: "sent", delivered_message_id: 5,
  status: "open", status_at: msk("2026-10-01T12:00").toISOString(), reminded_at: null, overdue_notified_at: null,
  ...patch,
});

describe("reminderAt", () => {
  it("за сутки, за три часа или никогда — по тому, за сколько дали задачу", () => {
    expect(reminderAt(task({}))).toEqual(msk("2026-10-02T18:00"));
    expect(reminderAt(task({ due_at: msk("2026-10-02T08:00").toISOString() }))).toEqual(msk("2026-10-02T05:00"));
    expect(reminderAt(task({ due_at: msk("2026-10-01T17:00").toISOString() }))).toBeNull();
    expect(reminderAt(task({ due_at: null }))).toBeNull();
  });
});

describe("noticeDue", () => {
  it("напоминание с момента reminderAt, один раз", () => {
    expect(noticeDue(task({}), msk("2026-10-02T17:59"))).toBeNull();
    expect(noticeDue(task({}), msk("2026-10-02T18:00"))).toBe("reminder");
    expect(noticeDue(task({ reminded_at: "x" }), msk("2026-10-02T19:00"))).toBeNull();
  });

  it("ночью молчит; напоминание к сроку «до пятницы» уходит в 9 утра пятницы", () => {
    const eod = task({ due_at: msk("2026-10-02T23:59").toISOString(), created_at: msk("2026-09-29T12:00").toISOString() });
    expect(noticeDue(eod, msk("2026-10-01T23:59"))).toBeNull();
    expect(noticeDue(eod, msk("2026-10-02T08:59"))).toBeNull();
    expect(noticeDue(eod, msk("2026-10-02T09:00"))).toBe("reminder");
  });

  it("просрочка — отдельное событие, даже если напоминания не было; закрытые не трогаем", () => {
    expect(noticeDue(task({}), msk("2026-10-03T18:00"))).toBe("overdue");
    expect(noticeDue(task({ overdue_notified_at: "x" }), msk("2026-10-03T19:00"))).toBeNull();
    expect(noticeDue(task({ status: "done" }), msk("2026-10-03T19:00"))).toBeNull();
    expect(noticeDue(task({ status: "taken" }), msk("2026-10-03T19:00"))).toBe("overdue");
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

  it("напоминает исполнителю один раз, сколько бы ни было проходов", async () => {
    await sendAssignedReminders({ store, api }, msk("2026-10-02T18:05"));
    await sendAssignedReminders({ store, api }, msk("2026-10-02T18:20"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ chat: 1 });
    expect(sent[0].text).toContain("Срок задачи #1: сб 03.10, 18:00");
  });

  it("о просрочке пишет исполнителю и владельцу, тоже один раз", async () => {
    const res = await sendAssignedReminders({ store, api }, msk("2026-10-03T18:15"));
    await sendAssignedReminders({ store, api }, msk("2026-10-03T18:30"));
    expect(res).toEqual({ reminders: 0, overdue: 1 });
    expect(sent.map(s => s.chat)).toEqual([1, 9]);
    expect(sent[1].text).toContain("Просрочена задача #1 у @alice");
  });

  it("закрытая задача и новый срок: молчит, а после правки срока напоминает заново", async () => {
    await sendAssignedReminders({ store, api }, msk("2026-10-02T18:05"));
    await store.editAssignedTask(1, 9, { due: msk("2026-10-06T18:00").toISOString() });
    await sendAssignedReminders({ store, api }, msk("2026-10-05T18:05"));
    expect(sent).toHaveLength(2);
    await store.setAssignedStatus(1, 1, "done");
    await sendAssignedReminders({ store, api }, msk("2026-10-06T19:00"));
    expect(sent).toHaveLength(2);
  });
});
