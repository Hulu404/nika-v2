import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../databot/data/memory-store";
import { MemorySettingsStore } from "./settings";
import { syncTeamTaskMembers } from "./tasks";
import type { TeamMember } from "./access";
import { OVERDUE_CLEANUP_SETTING, cleanupListedOverdue } from "./overdue-cleanup";

const msk = (local: string) => new Date(`${local}+03:00`);
const member = (chat_id: number, username: string): TeamMember => ({
  chat_id, username, display_name: username, role: "member", joined_at: "2026-10-01T00:00:00Z",
  added_by: null, last_seen_at: null, digest_opt_in: true,
});

describe("разовая чистка просроченных задач по списку", () => {
  let tasks: MemoryStore;
  let settings: MemorySettingsStore;
  const NOW = msk("2026-11-11T20:00");
  const task = (line: number, username: string, what: string, due: string) => ({ line, username, what, due_at: msk(due).toISOString() });

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tasks = new MemoryStore();
    settings = new MemorySettingsStore();
    await syncTeamTaskMembers({ store: tasks }, NOW, [member(8, "srbrkvss"), member(1, "hulu404"), member(2, "zuzya_zyzya"), member(3, "ananas_2711"), member(4, "dissidenceandtea")]);
    tasks.clock = () => msk("2026-10-20T12:00");
    await tasks.importAssignedTasks(8, 101, [
      task(1, "hulu404", "FE5 · D1–D2: очередь врача и шаг после визита", "2026-10-23T20:00"),
      task(2, "hulu404", "B8 · Маршрут после визита", "2026-10-23T20:00"),
      task(3, "zuzya_zyzya", "Кофе-ран · Усачёва, вс 01.11: контент и анонсы\n— анонс-пост в ТГК и Instagram, до вт 12:00", "2026-10-27T12:00"),
      task(4, "hulu404", "FE6 · A1–A2: настройки клиники, стоп-кнопка, загрузки", "2026-10-27T20:00"),
      task(5, "hulu404", "FE7 · A3: отчёт и выгрузка", "2026-10-27T20:00"),
      task(6, "hulu404", "B9 · Дожим «не записался за 7 дней»", "2026-10-27T20:00"),
      task(7, "dissidenceandtea", "B10 · Отчёт 30 дней против контроля", "2026-10-27T20:00"),
      task(8, "ananas_2711", "смонтировать 3 варианта релсов из всех материалов которые были за все кофе-раны на финальный кофе-ран который будет 1 ноября", "2026-10-28T12:00"),
      // Не из списка: другой исполнитель, свежий срок, другой текст.
      task(9, "zuzya_zyzya", "B8 · Маршрут после визита", "2026-10-23T20:00"),
      task(10, "hulu404", "FE5 · D1–D2: очередь врача и шаг после визита", "2026-11-20T20:00"),
      task(11, "hulu404", "Позвонить в студию", "2026-10-23T20:00"),
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("отменяет ровно восемь задач из списка, остальные не трогает; второй запуск ничего не делает", async () => {
    expect(await cleanupListedOverdue({ tasks, settings }, NOW)).toBe(8);
    const byLine = new Map([...tasks.assignedTasks.values()].map((t) => [t.line, t.status]));
    for (const line of [1, 2, 3, 4, 5, 6, 7, 8]) expect(byLine.get(line), `строка ${line}`).toBe("cancelled");
    for (const line of [9, 10, 11]) expect(byLine.get(line), `строка ${line}`).toBe("open");
    expect(await settings.get(OVERDUE_CLEANUP_SETTING)).toContain("8 @");
    expect(await cleanupListedOverdue({ tasks, settings }, NOW)).toBeNull();
  });
});
