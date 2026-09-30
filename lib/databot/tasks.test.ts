import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./data/memory-store";
import { normalizeTaskUsername, parseTask, type TaskSource } from "./tasks";

export const taskText = "Что: Выпустить страницу\nКто делает: @Alice\nК какому дню и часу: 2026-10-01T18:00+03:00\nСсылка на результат: да";
const source = (message_id: number): TaskSource => ({ ...parseTask(taskText), chat_id: -1001, message_thread_id: 10,
  message_id, source_text: taskText, source_version: 100, source_was_pinned: true });
let store: MemoryStore;
beforeEach(async () => {
  store = new MemoryStore();
  for (const [chat_id, username] of [[1, "alice"], [2, "bob"], [9, "admin"]] as const)
    await store.upsertMember({ chat_id, username, zone: "council", display_name: null, is_owner: chat_id === 9, invited_by: null }, new Date());
});
async function ready(n: number) {
  const t = (await store.importTask(source(n)))!;
  return store.bindTask(t.id, 1, "@ALICE", 9);
}
describe("task model", () => {
  it("normalizes exact usernames and explicit timezone", () => {
    expect(normalizeTaskUsername("@ALIce")).toBe("alice");
    expect(parseTask(taskText)).toMatchObject({ assignee_username: "alice", due_at: "2026-10-01T15:00:00.000Z", requires_result: true });
  });
  it.each([
    "Идея: сделать страницу", taskText.replace("Кто делает: @Alice", ""),
    taskText.replace("2026-10-01T18:00+03:00", "завтра"),
    taskText.replace("2026-10-01T18:00+03:00", "2026-02-30T18:00+03:00"),
    taskText.replace("@Alice", "@AliceExtra @Alice"), taskText.replace("+03:00", ""),
  ])("rejects incomplete/ambiguous task %s", text => expect(() => parseTask(text)).toThrow("format"));
  it("deduplicates pin/import and ignores out-of-order edits", async () => {
    const t = await ready(1);
    await store.importTask(source(1));
    await store.importTask({ ...source(1), what: "new", source_version: 200 });
    await store.importTask({ ...source(1), what: "old", source_version: 150 });
    expect(await store.listAvailableTasks(-1001)).toHaveLength(1);
    expect(await store.getTask(t.id)).toMatchObject({ what: "new", assignee_id: 1 });
    expect(await store.importTask(source(2), true)).toBeNull();
  });
  it("requires explicit binding; changed source assignee clears it", async () => {
    const t = (await store.importTask(source(1)))!;
    await expect(store.takeTask(t.id, 1, "alice", -1001, 20)).rejects.toThrow("identity");
    await store.bindTask(t.id, 1, "alice", 9);
    await store.importTask({ ...source(1), assignee_username: "bob", source_version: 200 });
    expect(await store.getTask(t.id)).toMatchObject({ assignee_id: null });
  });
  it("one winner for simultaneous claims", async () => {
    const t = await ready(1);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => store.takeTask(t.id, 1, "alice", -1001, 20)));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  });
  it("four active tasks across simultaneous requests, completion frees capacity", async () => {
    const ts = await Promise.all(Array.from({ length: 6 }, (_, i) => ready(i + 1)));
    const rs = await Promise.allSettled(ts.map(t => store.takeTask(t.id, 1, "alice", -1001, 20)));
    expect(rs.filter(r => r.status === "fulfilled")).toHaveLength(4);
    await expect(store.completeTask(ts[0].id, 1, "alice", null)).rejects.toThrow("result");
    await expect(store.completeTask(ts[0].id, 1, "alice", "javascript:bad")).rejects.toThrow("result");
    const completing = await store.completeTask(ts[0].id, 1, "alice", "https://example.org/result");
    expect(completing).toMatchObject({ status: "completing", completed_at: null });
    await expect(store.takeTask(ts[4].id, 1, "alice", -1001, 20)).rejects.toThrow("limit");
    await store.taskDelivery(ts[0].id, "lock");
    await store.taskDelivery(ts[0].id, "sent", 50);
    await store.taskDelivery(ts[0].id, "pinned");
    await store.taskDelivery(ts[0].id, "work_unpinned");
    await store.taskDelivery(ts[0].id, "source_unpinned");
    await store.taskDelivery(ts[0].id, "edited");
    await store.taskDelivery(ts[0].id, "finish");
    expect((await store.getTask(ts[0].id))?.completed_at).toBeTruthy();
    await store.takeTask(ts[4].id, 1, "alice", -1001, 20);
    expect(await store.listActiveTasks(1, -1001)).toHaveLength(4);
    await expect(store.completeTask(ts[0].id, 1, "alice", "https://example.org")).resolves.toMatchObject({ status: "done" });
  });
  it("never transfers an assigned username to a different ID", async () => {
    const t = await ready(1);
    store.members.get(1)!.username = "renamed";
    store.members.get(2)!.username = "alice";
    await expect(store.takeTask(t.id, 2, "alice", -1001, 20)).rejects.toThrow("identity");
    await expect(store.takeTask(t.id, 1, "renamed", -1001, 20)).rejects.toThrow("identity");
    await store.bindTask(t.id, 1, "renamed", 9);
    await store.takeTask(t.id, 1, "renamed", -1001, 20);
    await expect(store.bindTask(t.id, 2, "alice", 9)).rejects.toThrow("state");
  });
  it("rejects duplicate/missing usernames and revoked members", async () => {
    const t = await ready(1);
    await expect(store.takeTask(t.id, 1, "", -1001, 20)).rejects.toThrow("identity");
    store.members.get(2)!.username = "@ALICE";
    await expect(store.takeTask(t.id, 1, "alice", -1001, 20)).rejects.toThrow("identity");
    store.members.get(2)!.username = "bob";
    await store.takeTask(t.id, 1, "alice", -1001, 20);
    await store.removeMember(1, new Date());
    await expect(store.completeTask(t.id, 1, "alice", "https://example.org")).rejects.toThrow("member");
  });
  it("one publication lock, uncertain send cannot be blindly resent", async () => {
    const t = await ready(1);
    await store.takeTask(t.id, 1, "alice", -1001, 20);
    const locks = await Promise.all([store.taskDelivery(t.id, "lock"), store.taskDelivery(t.id, "lock")]);
    expect(locks.filter(Boolean)).toHaveLength(1);
    await store.taskDelivery(t.id, "uncertain");
    expect(await store.taskDelivery(t.id, "lock")).toBeNull();
    await store.taskDelivery(t.id, "recover", 42);
    await store.taskDelivery(t.id, "failed");
    expect((await store.taskDelivery(t.id, "pinned"))?.claim).toMatchObject({ work_message_id: 42, pin_state: "pinned", send_state: "sent" });
  });
});
