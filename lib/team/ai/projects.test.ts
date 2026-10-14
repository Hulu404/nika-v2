import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryAboutStore } from "../about/store";
import { DEFAULT_PROJECTS, NIKA, RESCAN, projectInText, type Project } from "../projects/projects";
import { RESCAN_ABOUT, RESCAN_QUESTIONS } from "../projects/rescan-about-seed";
import { rescanSeed } from "../projects/rescan-seed";
import { MemoryRoadmapStore } from "../roadmap/store";
import type { AssistantDeps } from "./assistant";
import { SALMA, TEAM, VIKA_DEV, call, harness, reply } from "./test-harness";

const [NIKA_P, RESCAN_P] = DEFAULT_PROJECTS;
const MASHA_DESIGN = 5; // mouserdyuk — в RESCAN
const DIMA = 9; // фаундер — во всех проектах
const rescanTeam = TEAM.filter((m) => [VIKA_DEV, MASHA_DESIGN, 8, DIMA].includes(m.chat_id));
const owners = (u: string) => ({ dissidenceandtea: VIKA_DEV, mouserdyuk: MASHA_DESIGN } as Record<string, number>)[u] ?? null;
const system = (h: ReturnType<typeof harness>, i = 0) => (h.inputs[i].messages[0] as { text: string }).text;
/** Результат инструмента, который увидела модель на шаге i. */
const toolResult = (h: ReturnType<typeof harness>, i = 1) => JSON.stringify(h.inputs[i].messages.at(-1));

describe("проект во фразе", () => {
  const both = [NIKA_P, RESCAN_P] as Project[];
  it("«в рескане», RESCAN, «в проекте Ника» — проект; «Ника» как имя и оба сразу — нет", () => {
    expect(projectInText("в рескане поставь Вике задачу", both)?.id).toBe(RESCAN);
    expect(projectInText("что по RESCAN на неделе", both)?.id).toBe(RESCAN);
    expect(projectInText("в проекте Ника задачи Сальмы", both)?.id).toBe(NIKA);
    expect(projectInText("в NIKA что горит?", both)?.id).toBe(NIKA);
    expect(projectInText("Ника, поставь задачу", both)).toBeNull();
    expect(projectInText("сравни NIKA и RESCAN", both)).toBeNull();
    expect(projectInText("в рескане", [NIKA_P])).toBeNull();
  });
});

describe("ассистент в проектах", () => {
  let h: ReturnType<typeof harness>;
  let roadmap: MemoryRoadmapStore;
  let about: MemoryAboutStore;
  let base: AssistantDeps;
  let projectsOf: (uid: number) => Project[];
  const NOW = new Date("2026-10-14T12:00:00+03:00");

  const inProject = (p: Project): AssistantDeps => ({
    ...base, projectId: p.id, project: p, projects: undefined,
    listTeam: async () => (p.id === RESCAN ? rescanTeam : TEAM),
    teamOf: async (id) => (id === RESCAN ? rescanTeam : TEAM),
    isAdmin: (id) => id === 8 || id === DIMA,
    roadmap, about,
  });
  /** Как bot.ts: проекты человека и зависимости в другом его проекте. */
  const scoped = (p: Project, uid: number): AssistantDeps => ({
    ...inProject(p), projects: projectsOf(uid),
    forProject: async (id) => {
      const other = projectsOf(uid).find((x) => x.id === id);
      return other ? scoped(other, uid) : null;
    },
  });

  beforeEach(async () => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "8,9");
    h = harness();
    h.clock = NOW;
    base = h.deps;
    roadmap = new MemoryRoadmapStore();
    await roadmap.seed(RESCAN, rescanSeed(owners), NOW);
    about = new MemoryAboutStore();
    await about.seed(RESCAN, RESCAN_ABOUT, RESCAN_QUESTIONS, NOW);
    projectsOf = (uid) => (uid === DIMA || uid === 8 ? [NIKA_P, RESCAN_P] : rescanTeam.some((m) => m.chat_id === uid) ? [NIKA_P, RESCAN_P] : [NIKA_P]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("в RESCAN: проект и его команда в инструкции, правило про медицину, инструменты плана и «О проекте», без кофе-ранов", async () => {
    h.deps = scoped(RESCAN_P, DIMA);
    h.script = [reply("Привет!")];
    await h.say("привет", DIMA);
    const sys = system(h);
    expect(sys).toContain("Проект: 🔬 RESCAN");
    expect(sys).toContain("ассистент проекта RESCAN");
    expect(sys).toContain("Не обсуждай медицинскую интерпретацию");
    expect(sys).toContain("get_project_info rules");
    expect(sys).not.toContain("@salmasxsx");
    expect(sys).not.toContain("/moved");
    const tools = h.inputs[0].tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["get_roadmap", "update_roadmap_item", "get_project_info", "list_open_questions", "list_tasks"]));
    expect(tools).not.toContain("answer_faq");
  });

  it("в NIKA — как раньше: команда НИКА, забеги, без инструментов плана", async () => {
    h.deps = scoped(NIKA_P, DIMA);
    h.script = [reply("Привет!")];
    await h.say("привет", DIMA);
    expect(system(h)).toContain("команды НИКА");
    expect(system(h)).toContain("/moved");
    const tools = h.inputs[0].tools.map((t) => t.name);
    expect(tools).toContain("answer_faq");
    expect(tools).not.toContain("get_roadmap");
  });

  it("«что у нас по КТ1?» → get_roadmap(milestone=КТ1): список с кодами показывает бот, модель получает пункты", async () => {
    h.deps = scoped(RESCAN_P, VIKA_DEV);
    h.script = [call("get_roadmap", { milestone: "КТ1" }), reply("До КТ1 два дня.")];
    await h.say("что у нас по КТ1?", VIKA_DEV);
    expect(h.texts().join("\n")).toContain("Условия · готово 0 из 11");
    expect(h.texts().join("\n")).toContain("○ CL1 · Объём от 500");
    const result = toolResult(h);
    expect(result).toContain("CL1");
  });

  it("update_roadmap_item: не ответственный — отказ; ответственная — предпросмотр и «✅ Подтвердить»", async () => {
    h.deps = scoped(RESCAN_P, MASHA_DESIGN);
    h.script = [call("update_roadmap_item", { code: "B4", status: "in_progress" }), reply("Не могу.")];
    await h.say("B4 в работе", MASHA_DESIGN);
    expect(toolResult(h)).toContain("Менять пункт могут админы проекта и его ответственный.");
    expect(h.texts().some((t) => t.startsWith("Проверь"))).toBe(false);

    h.deps = scoped(RESCAN_P, VIKA_DEV);
    h.script = [call("update_roadmap_item", { code: "в4", status: "in_progress", due: "2026-10-22" })];
    await h.say("B4 взяла, сделаю к 22-му", VIKA_DEV);
    const preview = h.preview().text;
    expect(preview).toContain("🗺 Изменю пункт плана: B4 · Очередь врача");
    expect(preview).toContain("Статус: ▶️ в работе (было: запланирован)");
    expect(preview).toContain("⏰ Срок: чт 22.10 (было: пт 23.10)");
    const b4 = (await roadmap.list(RESCAN)).find((i) => i.code === "B4")!;
    expect(b4.status).toBe("planned");
    await h.press(h.button("✅ Подтвердить")!, VIKA_DEV);
    expect(await roadmap.get(b4.id)).toMatchObject({ status: "in_progress", due_date: "2026-10-22", updated_by: VIKA_DEV });
    expect(h.last().text).toBe("✅ Обновила пункт B4.");
  });

  it("админ меняет ответственного — новому ответственному сообщение", async () => {
    h.deps = scoped(RESCAN_P, DIMA);
    h.script = [call("update_roadmap_item", { code: "CL1", owner: { name: "Маше" } })];
    await h.say("CL1 — на Машу", DIMA);
    expect(h.preview().text).toContain("👤 Ответственный: Маша");
    await h.press(h.button("✅ Подтвердить")!, DIMA);
    expect((await roadmap.list(RESCAN)).find((i) => i.code === "CL1")!.owner_chat_id).toBe(MASHA_DESIGN);
    expect(h.sent.find((s) => s.chat === MASHA_DESIGN)?.text).toContain("🗺 Ты ответственный за пункт плана: CL1");
  });

  it("get_project_info и list_open_questions: раздел и вопросы показывает бот", async () => {
    h.deps = scoped(RESCAN_P, VIKA_DEV);
    h.script = [call("get_project_info", { section: "rules" }), reply("Правило 1 — никакой интерпретации.")];
    await h.say("можно показать пациенту, что гемоглобин низкий?", VIKA_DEV);
    expect(h.texts().join("\n")).toContain("Тест для новой фичи");
    expect(toolResult(h)).toContain("Никакой интерпретации");
    h.script = [call("list_open_questions"), reply("")];
    await h.say("какие вопросы открыты?", VIKA_DEV);
    expect(h.texts().join("\n")).toContain("Какая МИС у пилотной клиники");
  });

  it("«поставь Сальме…» у Вики в RESCAN: «Сальма в проекте NIKA. Поставить задачу там?» → задача в NIKA", async () => {
    h.deps = scoped(RESCAN_P, VIKA_DEV);
    h.script = [call("create_task", { assignees: [{ name: "Сальме" }], what: "забронировать зал" }), reply("")];
    await h.say("поставь Сальме забронировать зал", VIKA_DEV);
    const ask = h.last();
    expect(ask.text).toBe("Сальма в проекте NIKA. Поставить задачу там?");
    expect(ask.buttons.map((b) => b.text)).toEqual(["Да, в NIKA", "Отмена"]);
    await h.press(ask.buttons[0].data!, VIKA_DEV);
    expect(h.preview().text).toMatch(/^Проверь, пожалуйста · 🏃 NIKA:/);
    await h.press(h.button("✅ Подтвердить")!, VIKA_DEV);
    const tasks = await h.tasks.listAssignedOverview(new Date(0));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ project_id: NIKA, assignee_id: SALMA, what: "забронировать зал" });
  });

  it("«Отмена» на вопросе про другой проект — ничего не создаётся", async () => {
    h.deps = scoped(RESCAN_P, DIMA);
    h.script = [call("create_task", { assignees: [{ name: "Сальме" }], what: "зал" }), reply("")];
    await h.say("поставь Сальме зал", DIMA);
    await h.press(h.last().buttons[1].data!, DIMA);
    expect(h.last().text).toBe("Отменила.");
    expect(await h.tasks.listAssignedOverview(new Date(0))).toHaveLength(0);
  });

  it("человек только из RESCAN: людей из NIKA не находим и не называем", async () => {
    projectsOf = () => [RESCAN_P];
    h.deps = scoped(RESCAN_P, MASHA_DESIGN);
    h.script = [call("create_task", { assignees: [{ name: "Сальме" }], what: "зал" }), reply("")];
    await h.say("поставь Сальме зал", MASHA_DESIGN);
    expect(h.texts().join("\n")).not.toContain("NIKA");
    expect(h.texts().join("\n")).not.toContain("Поставить задачу там");
  });

  it("проект, названный в речи, важнее текущего: задача уходит в RESCAN", async () => {
    h.deps = scoped(NIKA_P, DIMA);
    h.script = [call("create_task", { assignees: [{ name: "Вике" }], what: "поднять стенд", due: "2026-10-16" })];
    await h.say("в рескане поставь Вике поднять стенд до пятницы", DIMA);
    expect(system(h)).toContain("Проект: 🔬 RESCAN");
    expect(h.preview().text).toMatch(/^Проверь, пожалуйста · 🔬 RESCAN:/);
    await h.press(h.button("✅ Подтвердить")!, DIMA);
    const [task] = await h.tasks.listAssignedOverview(new Date(0));
    expect(task).toMatchObject({ project_id: RESCAN, assignee_id: VIKA_DEV });
  });

  it("память диалога отдельно по проектам", async () => {
    h.deps = scoped(RESCAN_P, DIMA);
    h.script = [reply("Записала про стенд.")];
    await h.say("стенд для клиники в четверг", DIMA);
    h.deps = scoped(NIKA_P, DIMA);
    h.script = [reply("Ок.")];
    await h.say("что у нас сегодня?", DIMA);
    const nikaMessages = h.inputs[1].messages.map((m) => JSON.stringify(m)).join("\n");
    expect(nikaMessages).not.toContain("стенд для клиники");
    h.deps = scoped(RESCAN_P, DIMA);
    h.script = [reply("Ок.")];
    await h.say("и ещё", DIMA);
    expect(h.inputs[2].messages.map((m) => JSON.stringify(m)).join("\n")).toContain("стенд для клиники");
  });

  it("в проекте без плана инструмент плана не срабатывает", async () => {
    h.deps = scoped(NIKA_P, DIMA);
    h.script = [call("get_roadmap", {}), reply("Плана нет.")];
    await h.say("покажи план", DIMA);
    expect(toolResult(h)).toContain("В этом проекте нет плана развития.");
  });
});
