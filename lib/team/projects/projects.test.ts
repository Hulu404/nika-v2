import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { MemoryStore } from "../../databot/data/memory-store";
import { MemoryEventStore, scopedEvents } from "../events";
import { syncTeamTaskMembers } from "../tasks";
import { executeTool, type ToolContext } from "../ai/tools";
import { MemoryReminderStore } from "../ai/stores";
import { TEAM } from "../ai/test-harness";
import { MemoryMembershipStore, projectTeam } from "./members";
import { MemoryProjectStore, NIKA, RESCAN, hasModule } from "./projects";
import { projectsOf, resolveScope, scopeFor } from "./scope";

const NOW = new Date("2026-10-14T12:00:00+03:00");
const DIMA = 9; // фаундер
const VIKA = 4; // dissidenceandtea — в обоих проектах
const MASHA = 5; // mouserdyuk — в обоих проектах
const SALMA = 7; // только nika
const OUTSIDER = 50; // только rescan, в nika его нет

describe("проекты и участники", () => {
  let projects: MemoryProjectStore;
  let memberships: MemoryMembershipStore;
  beforeEach(async () => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "8,9");
    projects = new MemoryProjectStore();
    memberships = new MemoryMembershipStore();
    for (const id of [1, 2, 3, VIKA, MASHA, 6, SALMA]) await memberships.add({ project_id: NIKA, chat_id: id }, NOW);
    await memberships.add({ project_id: NIKA, chat_id: 3, role: "admin" }, NOW); // уже есть — не меняется
    await memberships.update(NIKA, 3, { role: "admin" });
    await memberships.add({ project_id: RESCAN, chat_id: VIKA, title: "Разработчик", departments: ["dev"] }, NOW);
    await memberships.add({ project_id: RESCAN, chat_id: MASHA, title: "Дизайнер", departments: ["design"] }, NOW);
    await memberships.add({ project_id: RESCAN, chat_id: 3 }, NOW);
    await memberships.add({ project_id: RESCAN, chat_id: OUTSIDER }, NOW);
  });
  afterEach(() => vi.unstubAllEnvs());
  const deps = () => ({ projects, memberships });

  it("модули: ядро у всех, ивенты и кофе-ран — у nika, план развития и «О проекте» — у rescan", async () => {
    const [nika, rescan] = await projects.list();
    for (const m of ["tasks", "schedule", "team", "my_day", "assistant"] as const) expect(hasModule(nika, m) && hasModule(rescan, m)).toBe(true);
    expect(["events", "coffee_run", "attendance", "founders_digest", "social"].every((m) => hasModule(nika, m as never))).toBe(true);
    expect(hasModule(rescan, "events") || hasModule(rescan, "coffee_run")).toBe(false);
    expect(hasModule(rescan, "roadmap") && hasModule(rescan, "about")).toBe(true);
  });

  it("фаундер — во всех проектах и админ везде; Вика — в двух; Сальма — только в nika", async () => {
    expect((await projectsOf(deps(), DIMA)).map((p) => p.id)).toEqual([NIKA, RESCAN]);
    expect((await projectsOf(deps(), VIKA)).map((p) => p.id)).toEqual([NIKA, RESCAN]);
    expect((await projectsOf(deps(), SALMA)).map((p) => p.id)).toEqual([NIKA]);
    expect((await projectsOf(deps(), OUTSIDER)).map((p) => p.id)).toEqual([RESCAN]);
    const rescan = await resolveScope(deps(), DIMA, RESCAN);
    expect(rescan!.project.id).toBe(RESCAN);
    expect(rescan!.isAdmin(DIMA)).toBe(true);
    expect(await resolveScope(deps(), 777, null)).toBeNull();
  });

  it("текущий проект — current_project, если человек в нём; иначе первый; запись из кнопки важнее", async () => {
    expect((await resolveScope(deps(), VIKA, RESCAN))!.project.id).toBe(RESCAN);
    expect((await resolveScope(deps(), SALMA, RESCAN))!.project.id).toBe(NIKA);
    expect((await resolveScope(deps(), VIKA, NIKA, RESCAN))!.project.id).toBe(RESCAN);
  });

  it("админ nika, не фаундер, в rescan прав не имеет", async () => {
    const [nika, rescan] = await projects.list();
    const n = await scopeFor(deps(), nika, [nika, rescan]);
    const r = await scopeFor(deps(), rescan, [nika, rescan]);
    expect(n.isAdmin(3)).toBe(true);
    expect(r.isAdmin(3)).toBe(false);
    expect(r.isAdmin(DIMA)).toBe(true);
  });

  it("команда проекта: должность и отделы — из проекта; фаундеры видны везде; чужих нет", async () => {
    const team = projectTeam([...TEAM, { ...TEAM[0], chat_id: OUTSIDER, username: "outsider", first_name: "Олег" }], await memberships.ofProject(RESCAN));
    // Вика, Маша, Вика из SMM (chat 3) и Олег — участники rescan; Али и Дмитрий — фаундеры.
    expect(team.map((m) => m.username)).toEqual(["tora_co", "dissidenceandtea", "mouserdyuk", "Hulu404", "srbrkvss", "outsider"]);
    expect(team.find((m) => m.username === "mouserdyuk")).toMatchObject({ title: "Дизайнер", departments: ["design"] });
    expect(team.some((m) => m.username === "salmasxsx")).toBe(false);
  });

  it("миграция 058: всё существующее остаётся в nika (default 'nika'), оба проекта создаются, участники — в nika", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/058_projects.sql", import.meta.url), "utf8");
    for (const table of ["databot_assigned_tasks", "team_events", "team_reminders", "team_ai_turns", "team_ai_drafts", "team_digests"]) {
      expect(sql).toContain(`alter table public.${table}`);
    }
    expect(sql.match(/project_id text not null default 'nika'/g)).toHaveLength(6);
    expect(sql).toContain("('nika', 'NIKA', '🏃'");
    expect(sql).toContain("('rescan', 'RESCAN', '🔬'");
    expect(sql).toMatch(/insert into public\.project_members \(project_id, chat_id, title, departments, joined_at\)\s+select 'nika'/);
  });
});

describe("человек только из rescan не видит ничего из nika", () => {
  let tasks: MemoryStore;
  let events: MemoryEventStore;
  const sent: string[] = [];
  const outsider = { ...TEAM[0], chat_id: OUTSIDER, username: "outsider", first_name: "Олег", title: null, departments: [] };
  const rescanTeam = [TEAM[3], TEAM[4], outsider];

  beforeEach(async () => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "8,9");
    sent.length = 0;
    tasks = new MemoryStore();
    events = new MemoryEventStore();
    await syncTeamTaskMembers({ store: tasks }, NOW, [...TEAM, outsider]);
    // Задачи и событие nika — без project_id, как старые записи.
    await tasks.importAssignedTasks(DIMA, 1, [{ line: 1, username: "outsider", what: "Секрет NIKA для Олега", due_at: null }]);
    await tasks.importAssignedTasks(DIMA, 2, [{ line: 1, username: "salmasxsx", what: "Анонс кофе-рана", due_at: null }]);
    await tasks.importAssignedTasks(DIMA, 3, [{ line: 1, username: "outsider", what: "Макет страницы пациента", due_at: null }], { projectId: RESCAN });
    await events.create({ kind: "meeting", club: null, title: "Планёрка NIKA", starts_at: "2026-10-14T16:00:00.000Z", place: null, responsible_chat_id: null, created_by: DIMA }, NOW);
    await scopedEvents(events, RESCAN).create({ kind: "meeting", club: null, title: "Созвон RESCAN", starts_at: "2026-10-14T17:00:00.000Z", place: null, responsible_chat_id: null, created_by: DIMA }, NOW);
  });
  afterEach(() => vi.unstubAllEnvs());

  const tool = (uid: number, projectId: string, isAdmin = (id: number) => id === 8 || id === 9): ToolContext => ({
    ctx: { reply: async (text: string) => (sent.push(text), { message_id: 1 }) } as never,
    uid, projectId, isAdmin, team: rescanTeam, now: NOW, saidText: "", voice: false, state: { draft_id: null, last_list: null },
    tasks, events: scopedEvents(events, projectId), reminders: new MemoryReminderStore(),
    upsertDraft: async () => {}, setList: async () => {},
    showSchedule: async (ctx) => void (await (ctx as { reply: (t: string) => Promise<unknown> }).reply("🗓")),
    myDay: async () => "☀️", shown: { preview: false, list: false },
  });

  it("задачи: в rescan — только задачи rescan, даже свои задачи nika не видны", async () => {
    const res = JSON.parse(await executeTool(tool(OUTSIDER, RESCAN), { name: "list_tasks", arguments: { scope: "mine", status: "all" } }));
    expect(res.items.map((i: { what: string }) => i.what)).toEqual(["Макет страницы пациента"]);
    expect(sent.join("\n")).not.toContain("Секрет NIKA");
  });

  it("фаундер в rescan видит задачи команды rescan, но не nika", async () => {
    const res = JSON.parse(await executeTool(tool(DIMA, RESCAN), { name: "list_tasks", arguments: { scope: "team", status: "all" } }));
    expect(res.items.map((i: { what: string }) => i.what)).toEqual(["Макет страницы пациента"]);
  });

  it("расписание: события проекта раздельно", async () => {
    const res = JSON.parse(await executeTool(tool(OUTSIDER, RESCAN), { name: "get_schedule", arguments: { range: "today" } }));
    expect(res.items.map((i: { title: string }) => i.title)).toEqual(["Созвон RESCAN"]);
    expect((await scopedEvents(events, NIKA).listBetween(new Date(0), new Date("2027-01-01"))).map((e) => e.title)).toEqual(["Планёрка NIKA"]);
  });

  it("команда: в rescan нет людей только из nika", async () => {
    await executeTool(tool(OUTSIDER, RESCAN), { name: "get_team", arguments: {} });
    expect(sent.join("\n")).not.toMatch(/Сальма|salmasxsx/);
  });

  it("чужую задачу nika по id не закрыть из rescan", async () => {
    const res = JSON.parse(await executeTool(tool(DIMA, RESCAN), { name: "set_task_status", arguments: { task_ids: [1, 2], status: "cancelled" } }));
    expect(res.error).toBeDefined();
  });
});
