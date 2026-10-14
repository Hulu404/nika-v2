import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { MemoryStore } from "../../databot/data/memory-store";
import { MemoryTeamForms } from "../form";
import { rescanSeed } from "../projects/rescan-seed";
import { syncTeamTaskMembers } from "../tasks";
import { startTaskDraft } from "../ai/assistant";
import { validateIntent } from "../ai/intent";
import { TEAM, harness } from "../ai/test-harness";
import { checkRoadmapCompletion } from "./complete";
import { roadmapHome } from "./copy";
import { dispatchRoadmapReminders, milestoneReminderText, roadmapDigestLines } from "./reminders";
import { handleRoadmapUpdate, parseRoadmapAdd, type RoadmapDeps } from "./screen";
import { MemoryRoadmapStore } from "./store";
import { DEFAULT_PROJECTS, RESCAN } from "../projects/projects";

const msk = (local: string) => new Date(`${local}+03:00`);
const NOW = msk("2026-10-14T12:00"); // ср 14.10
const VIKA = 4; // dissidenceandtea
const MASHA = 5; // mouserdyuk
const DIMA = 9;
const owners = (u: string) => ({ dissidenceandtea: VIKA, mouserdyuk: MASHA } as Record<string, number>)[u] ?? null;
const rescanTeam = TEAM.filter((m) => [VIKA, MASHA, 8, 9].includes(m.chat_id));

describe("сид плана развития RESCAN", () => {
  it("4 контрольные точки, 4 этапа, пункты по группам; повторный запуск ничего не дублирует", async () => {
    const store = new MemoryRoadmapStore();
    const added = await store.seed(RESCAN, rescanSeed(owners), NOW);
    const items = await store.list(RESCAN);
    expect(added).toBe(items.length);
    expect(items.filter((i) => i.kind === "milestone").map((i) => `${i.code} ${i.due_date} ${i.title}`)).toEqual([
      "КТ1 2026-10-16 Можно ли брать данные", "КТ2 2026-10-27 Можно ли стартовать",
      "КТ3 2026-12-18 Первый отчёт, 30 дней", "КТ4 2027-01-12 Решение: покупают, продлевают или останавливаемся",
    ]);
    expect(items.filter((i) => i.kind === "stage").map((i) => i.title)).toEqual(["Разработка", "Набор пациентов", "Наблюдение 30 дней", "Полный отчёт"]);
    const code = (c: string) => items.find((i) => i.code === c)!;
    expect(items.filter((i) => i.group === "Бэкенд").map((i) => i.code)).toEqual(["B0", ...Array.from({ length: 12 }, (_, i) => `B${i + 1}`)]);
    expect(items.filter((i) => i.group === "Фронтенд")).toHaveLength(9);
    expect(items.filter((i) => i.group === "Дизайн")).toHaveLength(8);
    expect(items.filter((i) => i.group === "Клиника и юрист")).toHaveLength(11);
    expect(items.filter((i) => i.group === "Решения")).toHaveLength(5);
    expect([code("B0").due_date, code("B3").due_date, code("B4").due_date, code("B12").due_date]).toEqual(["2026-10-15", "2026-10-18", "2026-10-23", "2026-10-27"]);
    expect([code("FE2").due_date, code("FE5").due_date, code("FE9").due_date]).toEqual(["2026-10-18", "2026-10-23", "2026-10-27"]);
    expect([code("D1").due_date, code("D3").due_date, code("D8").due_date]).toEqual(["2026-10-15", "2026-10-19", "2026-10-27"]);
    expect(code("B4").owner_chat_id).toBe(VIKA);
    expect(code("D2").owner_chat_id).toBe(MASHA);
    expect(code("CL1").owner_chat_id).toBeNull();
    expect(items.filter((i) => i.milestone_id === code("КТ1").id)).toHaveLength(11);
    expect(items.filter((i) => i.milestone_id === code("КТ2").id).map((i) => i.code)).toEqual(["GO1", "GO2", "GO3", "GO4"]);

    expect(await store.seed(RESCAN, rescanSeed(owners), NOW)).toBe(0);
    expect(await store.list(RESCAN)).toHaveLength(items.length);
  });

  it("пустой ответственный дописывается, когда человек появился; заполненный не трогается", async () => {
    const store = new MemoryRoadmapStore();
    await store.seed(RESCAN, rescanSeed(() => null), NOW);
    const b4 = (await store.list(RESCAN)).find((i) => i.code === "B4")!;
    expect(b4.owner_chat_id).toBeNull();
    await store.update(b4.id, { owner_chat_id: 99 }, DIMA, NOW);
    await store.seed(RESCAN, rescanSeed(owners), NOW);
    const after = await store.list(RESCAN);
    expect(after.find((i) => i.code === "B4")!.owner_chat_id).toBe(99);
    expect(after.find((i) => i.code === "B5")!.owner_chat_id).toBe(VIKA);
  });
});

describe("экраны плана", () => {
  it("главный: ближайшая точка, этапы, прогресс, кнопки КТ и групп", async () => {
    const store = new MemoryRoadmapStore();
    await store.seed(RESCAN, rescanSeed(owners), NOW);
    const items = await store.list(RESCAN);
    for (const c of ["CL1", "CL2", "CL3"]) await store.update(items.find((i) => i.code === c)!.id, { status: "done" }, DIMA, NOW);
    await store.update(items.find((i) => i.code === "B1")!.id, { status: "done" }, DIMA, NOW);
    const screen = roadmapHome("🔬 RESCAN", await store.list(RESCAN), "2026-10-14");
    expect(screen.text).toBe([
      "<b>🔬 RESCAN · План развития</b>", "",
      "⏳ Ближайшая точка: КТ1 · пт 16.10 · через 2 дня",
      "Можно ли брать данные · готово 3 из 11", "",
      "Этапы",
      "▶️ Разработка · 14.10–27.10 · идёт",
      "○ Набор пациентов · 28.10–08.12",
      "○ Наблюдение 30 дней · до 07.01.2027",
      "○ Полный отчёт · 12.01.2027", "",
      "Прогресс",
      "Бэкенд 1/13 · Фронтенд 0/9 · Дизайн 0/8 · Клиника и юрист 3/11",
    ].join("\n"));
    const labels = screen.keyboard.inline_keyboard.map((r) => r.map((b) => b.text));
    expect(labels).toEqual([["КТ1", "КТ2", "КТ3", "КТ4"], ["Бэкенд", "Фронтенд", "Дизайн"], ["Клиника и юрист", "Решения"]]);
  });

  it("просрочено — строка и кнопка", async () => {
    const store = new MemoryRoadmapStore();
    await store.seed(RESCAN, rescanSeed(owners), NOW);
    const screen = roadmapHome("🔬 RESCAN", await store.list(RESCAN), "2026-10-17");
    expect(screen.text).toContain("⚠️ Просрочено: 16"); // B0, D1, D2 (15.10), 11 условий КТ1, R1 и R4 (16.10)
    expect(screen.keyboard.inline_keyboard.flat().map((b) => b.text)).toContain("⚠️ Просрочено");
  });
});

describe("кнопки и права", () => {
  let store: MemoryRoadmapStore;
  let tasks: MemoryStore;
  let calls: Array<{ method: string; chat: number; text: string; buttons: string[] }>;
  let press: (data: string, from: number) => Promise<void>;
  let send: (text: string, from: number) => Promise<void>;
  let made: number[];

  beforeEach(async () => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "8,9");
    store = new MemoryRoadmapStore();
    await store.seed(RESCAN, rescanSeed(owners), NOW);
    tasks = new MemoryStore();
    calls = [];
    made = [];
    const deps: RoadmapDeps = {
      roadmap: store, tasks, forms: new MemoryTeamForms(), projectId: RESCAN, projectLabel: "🔬 RESCAN", modules: DEFAULT_PROJECTS[1].modules,
      isAdmin: (id) => id === 8 || id === 9, listTeam: async () => rescanTeam, makeTask: async (_ctx, item) => void made.push(item.id),
    };
    const bot = new Bot("1:x", { botInfo: { id: 1, is_bot: true, first_name: "П", username: "t_bot" } as UserFromGetMe });
    bot.api.config.use(async (_prev, method, payload) => {
      const p = payload as { chat_id: number; text?: string; reply_markup?: { inline_keyboard?: Array<Array<{ text: string }>> } };
      calls.push({ method, chat: p.chat_id, text: String(p.text ?? ""), buttons: (p.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.text) });
      return { ok: true, result: { message_id: 1, date: 1, chat: { id: p.chat_id, type: "private" } } } as never;
    });
    bot.use((ctx) => handleRoadmapUpdate(ctx, deps, NOW).then(() => {}));
    let id = 0;
    const chat = (from: number) => ({ id: from, type: "private" as const, first_name: "x" });
    press = async (data, from) => {
      await bot.handleUpdate({ update_id: ++id, callback_query: { id: `c${id}`, chat_instance: "x", data, from: { id: from, is_bot: false, first_name: "x" },
        message: { message_id: 5, date: 1, text: "x", chat: chat(from) } } } as Update);
    };
    send = async (text, from) => {
      const entities = text.startsWith("/") ? [{ type: "bot_command" as const, offset: 0, length: text.split(" ")[0].length }] : undefined;
      await bot.handleUpdate({ update_id: ++id, message: { message_id: id, date: 1, text, entities, chat: chat(from), from: { id: from, is_bot: false, first_name: "x" } } } as Update);
    };
  });
  afterEach(() => vi.unstubAllEnvs());
  const byCode = async (c: string) => (await store.list(RESCAN)).find((i) => i.code === c)!;

  it("/roadmap — главный экран; кнопка КТ — чек-лист условий; группа — пункты с кодом, сроком, ответственным", async () => {
    await send("/roadmap", MASHA);
    expect(calls.at(-1)!.text).toContain("План развития");
    const kt1 = await byCode("КТ1");
    await press(`rm:m:${kt1.id}`, MASHA);
    expect(calls.at(-1)!.text).toContain("Условия · готово 0 из 11");
    expect(calls.at(-1)!.text).toContain("○ CL1 · Объём от 500");
    await press("rm:g:0", MASHA);
    expect(calls.at(-1)!.text).toContain("○ B4 · Очередь врача · до пт 23.10 · Вика");
  });

  it("менять статус могут админ и ответственный; остальные — нет", async () => {
    const b4 = await byCode("B4");
    await press(`rm:s:${b4.id}:w`, MASHA);
    expect(calls.at(-1)!.text).toBe("Менять пункт могут админы проекта и его ответственный.");
    expect((await byCode("B4")).status).toBe("planned");
    await press(`rm:s:${b4.id}:w`, VIKA);
    expect((await byCode("B4")).status).toBe("in_progress");
    await press(`rm:s:${b4.id}:d`, DIMA);
    expect((await byCode("B4")).status).toBe("done");
  });

  it("карточка: связанные задачи и «📋 Сделать задачей»; ответственный и срок", async () => {
    const b4 = await byCode("B4");
    await syncTeamTaskMembers({ store: tasks }, NOW, rescanTeam);
    await tasks.importAssignedTasks(DIMA, 1, [{ line: 1, username: "dissidenceandtea", what: "API очереди", due_at: null }], { projectId: RESCAN, roadmapItemId: b4.id });
    await press(`rm:i:${b4.id}`, VIKA);
    expect(calls.at(-1)!.text).toContain("🆕 @dissidenceandtea · API очереди");
    expect(calls.at(-1)!.buttons).toEqual(expect.arrayContaining(["▶️ В работе", "✅ Готово", "⛔ Блокер", "👤 Ответственный", "📅 Срок", "📋 Сделать задачей"]));
    await press(`rm:tk:${b4.id}`, VIKA);
    expect(made).toEqual([b4.id]);
    await press(`rm:ow:${b4.id}:${MASHA}`, DIMA);
    expect((await byCode("B4")).owner_chat_id).toBe(MASHA);
    await press(`rm:due:${b4.id}`, DIMA);
    await send("25.10", DIMA);
    expect((await byCode("B4")).due_date).toBe("2026-10-25");
  });

  it("/roadmap_add — только админы; пункт с кодом, сроком, ответственным и группой", async () => {
    await send("/roadmap_add B13 Мониторинг / 26.10 / @dissidenceandtea / Бэкенд", VIKA);
    expect(calls.at(-1)!.text).toBe("Пункты плана добавляют только админы проекта.");
    await send("/roadmap_add B13 Мониторинг / 26.10 / @dissidenceandtea / Бэкенд", DIMA);
    expect(await byCode("B13")).toMatchObject({ title: "Мониторинг", due_date: "2026-10-26", owner_chat_id: VIKA, group: "Бэкенд" });
    await send("/roadmap_add B13 Ещё раз", DIMA);
    expect(calls.at(-1)!.text).toBe("Пункт B13 уже есть в плане.");
  });

  it("удаляют пункты только админы, с подтверждением", async () => {
    const r5 = await byCode("R5");
    await press(`rm:del:${r5.id}`, VIKA);
    expect(calls.at(-1)!.text).toBe("Удалять пункты могут только админы проекта.");
    await press(`rm:del:${r5.id}`, DIMA);
    await press(`rm:DEL:${r5.id}`, DIMA);
    expect((await store.list(RESCAN)).some((i) => i.code === "R5")).toBe(false);
  });
});

describe("задачи по пункту", () => {
  beforeEach(() => vi.stubEnv("TEAM_FOUNDER_IDS", "8,9"));
  afterEach(() => vi.unstubAllEnvs());

  it("«📋 Сделать задачей» — обычный предпросмотр, исполнитель — ответственный; после «✅ Подтвердить» задача привязана к пункту", async () => {
    const h = harness();
    h.deps.projectId = RESCAN;
    const parsed = validateIntent({ intent: "create_task", what: "B4 · Очередь врача", due: "2026-10-23", assignees: [{ name: "Вика", qualifier: "разработчик" }] });
    let ctxRef: unknown;
    const capture = { reply: async (text: string, other?: unknown) => { ctxRef = other; h.sent.push({ method: "sendMessage", chat: DIMA, text, buttons: (((other as { reply_markup?: { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> } })?.reply_markup?.inline_keyboard) ?? []).flat().map((b) => ({ text: b.text, data: b.callback_data })) }); return { message_id: 777 }; },
      api: { editMessageText: async () => true } } as never;
    await startTaskDraft(capture, h.deps, DIMA, parsed, { roadmapItemId: 42, picks: { a0: VIKA } }, NOW);
    expect(ctxRef).toBeDefined();
    expect(h.preview().text).toContain("👤 Исполнитель: Вика (Разработчик) @dissidenceandtea");
    await h.press(h.button("✅ Подтвердить")!, DIMA);
    const task = [...h.tasks.assignedTasks.values()][0];
    expect(task).toMatchObject({ roadmap_item_id: 42, project_id: RESCAN, assignee_id: VIKA, assigned_by: DIMA });
  });

  it("все задачи пункта выполнены — вопрос ответственному пункта; пока не все — молчит", async () => {
    const store = new MemoryRoadmapStore();
    await store.seed(RESCAN, rescanSeed(owners), NOW);
    const b4 = (await store.list(RESCAN)).find((i) => i.code === "B4")!;
    const tasks = new MemoryStore();
    await syncTeamTaskMembers({ store: tasks }, NOW, rescanTeam);
    const [a] = await tasks.importAssignedTasks(DIMA, 1, [{ line: 1, username: "dissidenceandtea", what: "API", due_at: null }], { projectId: RESCAN, roadmapItemId: b4.id });
    const [b] = await tasks.importAssignedTasks(DIMA, 2, [{ line: 1, username: "mouserdyuk", what: "Макет", due_at: null }], { projectId: RESCAN, roadmapItemId: b4.id });
    const sent: Array<[number, string]> = [];
    const api = { sendMessage: async (chat: number, text: string) => (sent.push([chat, text]), {} as never) };
    await tasks.setAssignedStatus(a.id, VIKA, "done");
    expect(await checkRoadmapCompletion(api as never, { roadmap: store, tasks }, (await tasks.getAssignedTask(a.id))!)).toBe(false);
    await tasks.setAssignedStatus(b.id, MASHA, "done");
    expect(await checkRoadmapCompletion(api as never, { roadmap: store, tasks }, (await tasks.getAssignedTask(b.id))!)).toBe(true);
    expect(sent).toEqual([[VIKA, "Все задачи по B4 закрыты. Отметить пункт готовым?"]]);
  });
});

describe("напоминания плана", () => {
  beforeEach(() => vi.stubEnv("TEAM_FOUNDER_IDS", "8,9"));
  afterEach(() => vi.unstubAllEnvs());

  it("за 3 дня до КТ — только невыполненные условия с ответственными; один раз", async () => {
    const store = new MemoryRoadmapStore();
    await store.seed(RESCAN, rescanSeed(owners), NOW);
    const items = await store.list(RESCAN);
    const go = items.filter((i) => i.code?.startsWith("GO"));
    await store.update(go[0].id, { status: "done" }, DIMA, NOW);
    await store.update(go[2].id, { status: "done", owner_chat_id: MASHA }, DIMA, NOW);
    await store.update(go[1].id, { owner_chat_id: VIKA }, DIMA, NOW);
    const claimed = new Set<string>();
    const sent: Array<[number, string]> = [];
    const deps = {
      projects: async () => DEFAULT_PROJECTS.slice(), roadmap: store, teamOf: async () => rescanTeam,
      claim: async (k: string, s: string, d: string, p: string) => (claimed.has(`${k}${s}${d}${p}`) ? false : (claimed.add(`${k}${s}${d}${p}`), true)),
      send: async (chat: number, text: string) => void sent.push([chat, text]),
    };
    const at = msk("2026-10-24T10:00"); // сб, КТ2 27.10 — через 3 дня
    expect(await dispatchRoadmapReminders(deps, at)).toEqual(["kt rescan КТ2 -3"]);
    await dispatchRoadmapReminders(deps, msk("2026-10-24T10:15"));
    const texts = [...new Set(sent.map(([, t]) => t))];
    expect(texts).toEqual(["⏳ КТ2 через 3 дня · Можно ли стартовать\nНе готово:\n• GO2 Тексты утверждены клиникой и юристом — Вика\n• GO4 Пороги решения подписаны — без ответственного"]);
    expect(sent.map(([c]) => c).sort()).toEqual(rescanTeam.map((m) => m.chat_id).sort());
    expect(await dispatchRoadmapReminders(deps, msk("2026-10-24T09:00"))).toEqual([]);
  });

  it("за 1 день — «завтра»; без условий — только заголовок", () => {
    const m = { id: 1, kind: "milestone", code: "КТ3", title: "Первый отчёт, 30 дней", due_date: "2026-12-18", status: "planned" } as never;
    expect(milestoneReminderText(m, [], new Map(), "2026-12-17")).toBe("⏳ КТ3 завтра · Первый отчёт, 30 дней");
  });

  it("понедельник: «На этой неделе в плане» — пункты со сроком на неделе; пустая неделя — без сообщения", async () => {
    const store = new MemoryRoadmapStore();
    await store.seed(RESCAN, rescanSeed(owners), NOW);
    const sent: string[] = [];
    const deps = { projects: async () => DEFAULT_PROJECTS.slice(), roadmap: store, teamOf: async () => rescanTeam,
      claim: async () => true, send: async (_c: number, t: string) => void sent.push(t) };
    await dispatchRoadmapReminders(deps, msk("2026-10-19T10:00"));
    const week = sent.find((t) => t.startsWith("🗺 На этой неделе в плане:"))!;
    expect(week).toContain("• B4 Очередь врача · до пт 23.10 · Вика");
    expect(week).toContain("• D3 Макеты пациента · до пн 19.10 · Маша");
    expect(week).not.toContain("B9");
    sent.length = 0;
    await dispatchRoadmapReminders(deps, msk("2027-02-01T10:00"));
    expect(sent.some((t) => t.startsWith("🗺 На этой неделе"))).toBe(false);
  });

  it("строки в сводку фаундерам: ближайшая точка и просрочки", async () => {
    const store = new MemoryRoadmapStore();
    await store.seed(RESCAN, rescanSeed(owners), NOW);
    const lines = await roadmapDigestLines(store, rescanTeam, RESCAN, msk("2026-10-16T10:00"));
    expect(lines[0]).toBe("⏳ КТ1 · пт 16.10 · сегодня · не выполнено условий: 11");
    expect(lines[1]).toBe("⚠️ Просрочено пунктов плана: 3");
  });
});

describe("/roadmap_add — разбор", () => {
  it("код, название, срок, ответственный, группа; всё после названия необязательно", () => {
    expect(parseRoadmapAdd("/roadmap_add FE10 Онбординг клиники / 30.10 / Маша / Фронтенд", rescanTeam, DIMA, NOW))
      .toEqual({ code: "FE10", title: "Онбординг клиники", due: "2026-10-30", owner: MASHA, group: "Фронтенд" });
    expect(parseRoadmapAdd("/roadmap_add Созвон с клиникой", rescanTeam, DIMA, NOW)).toEqual({ code: null, title: "Созвон с клиникой", due: null, owner: null, group: null });
  });
});
