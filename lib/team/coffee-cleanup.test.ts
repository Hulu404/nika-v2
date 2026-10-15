import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../databot/data/memory-store";
import { COFFEE_CLEANUP_SETTING, cleanupLegacyCoffeeTasks } from "./coffee-cleanup";
import { MemorySettingsStore } from "./settings";
import { syncTeamTaskMembers } from "./tasks";
import type { TeamMember } from "./access";

const msk = (local: string) => new Date(`${local}+03:00`);
const member = (chat_id: number, username: string): TeamMember => ({
  chat_id, username, display_name: username, role: "member", joined_at: "2026-10-01T00:00:00Z",
  added_by: null, last_seen_at: null, digest_opt_in: true,
});
const SOURCE = 2_000_000_005;

describe("разовая чистка старых задач кофе-рана", () => {
  let tasks: MemoryStore;
  let settings: MemorySettingsStore;
  const NOW = msk("2026-10-16T12:00");

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tasks = new MemoryStore();
    settings = new MemorySettingsStore();
    await syncTeamTaskMembers({ store: tasks }, NOW, [member(8, "ali"), member(1, "vika"), member(2, "salma")]);
    tasks.clock = () => msk("2026-10-12T12:00");
    const old = (what: string, due: string, username = "vika") => ({ line: 1, username, what: `${what} · Кофе-ран · Усачёва, вс 18.10`, due_at: msk(due).toISOString() });
    await tasks.importAssignedTasks(8, SOURCE, [
      old("Анонс кофе-рана: пост в ТГК и Instagram", "2026-10-13T12:00"),
      { ...old("Анонс кофе-рана: пост в ТГК и Instagram", "2026-10-13T12:00", "salma"), line: 1 },
      { ...old("Рилсы про кофе-ран на внутреннюю и внешнюю аудиторию", "2026-10-14T23:59"), line: 2 },
      // Срок ещё не прошёл — не трогаем.
      { ...old("Найти пейсеров (ведущих групп) на кофе-ран", "2026-10-16T20:00", "salma"), line: 3 },
    ]);
    // Обычная задача с тем же текстом, но не из кофе-рана — не трогаем.
    await tasks.importAssignedTasks(8, 77, [{ line: 1, username: "vika", what: "Анонс кофе-рана: пост в ТГК и Instagram", due_at: msk("2026-10-13T12:00").toISOString() }]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("просроченные шаблонные отменены, остальные не тронуты; повторный запуск ничего не делает", async () => {
    const done = [...tasks.assignedTasks.values()].find((t) => t.username === "salma" && t.line === 1)!;
    await tasks.setAssignedStatus(done.id, 2, "done");
    expect(await cleanupLegacyCoffeeTasks({ tasks, settings }, NOW)).toBe(2);
    const status = (id: number) => tasks.assignedTasks.get(id)!.status;
    expect([1, 2, 3, 4, 5].map(status)).toEqual(["cancelled", "done", "cancelled", "open", "open"]);
    expect(await settings.get(COFFEE_CLEANUP_SETTING)).toMatch(/^2 @ /);
    expect(console.log).toHaveBeenCalledWith("[team] cleanup: отменено 2 старых задач кофе-рана");
    expect(await cleanupLegacyCoffeeTasks({ tasks, settings }, msk("2026-10-20T12:00"))).toBeNull();
    expect(status(4)).toBe("open");
  });
});
