import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { MemoryStore } from "../../databot/data/memory-store";
import { MENU, menuKeyboard, menuSection } from "../copy";
import { MemoryTeamForms } from "../form";
import { handleTeamTaskUpdate, syncTeamTaskMembers, type TeamTaskDeps } from "../tasks";
import type { TeamMember } from "../access";
import { DEFAULT_PROJECTS, RESCAN } from "./projects";

const rows = (kb: ReturnType<typeof menuKeyboard>) => kb.keyboard.map((r) => r.map((b) => (typeof b === "string" ? b : b.text)));
const [NIKA_P, RESCAN_P] = DEFAULT_PROJECTS;

describe("клавиатура по проекту", () => {
  it("человек в одном проекте NIKA — как раньше, без переключателя", () => {
    expect(rows(menuKeyboard(NIKA_P, false))).toEqual([[MENU.tasks, MENU.assign], [MENU.schedule, MENU.events], [MENU.team]]);
    expect(rows(menuKeyboard())).toEqual(rows(menuKeyboard(NIKA_P, false)));
  });

  it("RESCAN: план развития и «О проекте» вместо ивентов; переключатель — первой строкой", () => {
    expect(rows(menuKeyboard(RESCAN_P, true))).toEqual([
      ["🔀 Проект: RESCAN"], [MENU.tasks, MENU.assign], [MENU.roadmap, MENU.schedule], [MENU.about, MENU.team],
    ]);
    expect(rows(menuKeyboard(NIKA_P, true))[0]).toEqual(["🔀 Проект: NIKA"]);
    expect(rows(menuKeyboard(RESCAN_P, true)).flat()).not.toContain(MENU.events);
  });

  it("кнопка переключателя — раздел project", () => {
    expect(menuSection("🔀 Проект: RESCAN")).toBe("project");
    expect(menuSection(MENU.roadmap)).toBe("roadmap");
    expect(menuSection(MENU.about)).toBe("about");
  });
});

describe("кнопка из старого сообщения — в проекте записи", () => {
  const NOW = new Date("2026-10-14T09:00:00Z");
  const member = (chat_id: number, username: string): TeamMember => ({
    chat_id, username, display_name: username, role: "member", joined_at: NOW.toISOString(), added_by: null, last_seen_at: null, digest_opt_in: true,
  });
  const people = [member(9, "dima"), member(4, "vika")];
  let store: MemoryStore;
  let calls: Array<{ method: string; text: string; chat: number }>;
  let press: (data: string, id: number) => Promise<void>;
  let rescopes: string[];

  beforeEach(async () => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "9");
    store = new MemoryStore();
    store.clock = () => NOW;
    calls = [];
    rescopes = [];
    await syncTeamTaskMembers({ store }, NOW, people);
    const base = { store, forms: new MemoryTeamForms(), findMember: async (id: number) => people.find((m) => m.chat_id === id) ?? null, listTeam: async () => people };
    const rescanDeps: TeamTaskDeps = { ...base, projectId: RESCAN };
    const deps: TeamTaskDeps = { ...base, projectId: "nika", rescope: async (p) => (rescopes.push(p), p === RESCAN ? rescanDeps : null) };
    const bot = new Bot("1:x", { botInfo: { id: 1, is_bot: true, first_name: "П", username: "t_bot" } as UserFromGetMe });
    bot.api.config.use(async (_prev, method, payload) => {
      const p = payload as { chat_id: number; text?: string };
      calls.push({ method, text: String(p.text ?? ""), chat: p.chat_id });
      return { ok: true, result: { message_id: 100 + calls.length } } as never;
    });
    bot.use((ctx) => handleTeamTaskUpdate(ctx, deps, NOW).then(() => {}));
    let id = 0;
    press = async (data, from) => {
      await bot.handleUpdate({ update_id: ++id, callback_query: { id: `c${id}`, chat_instance: "x", data, from: { id: from, is_bot: false, first_name: "x" },
        message: { message_id: 500, date: 1, text: "x", chat: { id: from, type: "private", first_name: "x" } } } } as Update);
    };
  });
  afterEach(() => vi.unstubAllEnvs());

  it("«Взял в работу» у задачи RESCAN при current_project = nika срабатывает в RESCAN", async () => {
    const [task] = await store.importAssignedTasks(9, 1, [{ line: 1, username: "vika", what: "Макет страницы пациента", due_at: null }], { projectId: RESCAN });
    await press(`tk:s:take:${task.id}`, 4);
    expect(rescopes).toEqual([RESCAN]);
    expect(store.assignedTasks.get(task.id)!.status).toBe("taken");
  });

  it("задача nika — без переключения проекта", async () => {
    const [task] = await store.importAssignedTasks(9, 2, [{ line: 1, username: "vika", what: "Пост", due_at: null }]);
    await press(`tk:s:take:${task.id}`, 4);
    expect(rescopes).toEqual([]);
    expect(store.assignedTasks.get(task.id)!.status).toBe("taken");
  });

  it("человек не в проекте задачи — отказ, статус не меняется", async () => {
    const [task] = await store.importAssignedTasks(9, 3, [{ line: 1, username: "vika", what: "Чужое", due_at: null }], { projectId: "other" });
    await press(`tk:s:take:${task.id}`, 4);
    expect(calls.at(-1)!.text).toBe("Эта задача в проекте, где тебя нет.");
    expect(store.assignedTasks.get(task.id)!.status).toBe("open");
  });
});
