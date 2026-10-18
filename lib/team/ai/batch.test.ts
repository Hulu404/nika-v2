import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALI, MASHA_EVENTS, SALMA, call, harness, reply } from "./test-harness";

const DIMA = 9;
const NASTYA_HEAD = 1;
const VIKA_SMM = 3;
const MASHA_DESIGN = 5;

const SIX = [
  { assignees: [{ name: "Насте", qualifier: "главе SMM" }], what: "Анонс кофе-рана", due: "2026-10-14T12:00" },
  { assignees: [{ name: "Вике", qualifier: "из SMM" }], what: "Рилсы", due: "2026-10-15" },
  { assignees: [{ name: "Маше", qualifier: "дизайнеру" }], what: "Обложка", due: "2026-10-15" },
  { assignees: [{ name: "Сальме" }], what: "Найти пейсеров", due: "2026-10-16T20:00" },
  { assignees: [{ name: "Али" }], what: "Договор с кофейней", due: "2026-10-16" },
  { assignees: [{ name: "мне" }], what: "Отчёт", due: "2026-10-19" },
];

/** Результат инструмента, который увидела модель на шаге i. */
const toolResult = (h: ReturnType<typeof harness>, i = 1) => JSON.stringify(h.inputs[i].messages.at(-1));

describe("пакет задач", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "8,9");
    h = harness();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("6 задач разным людям в одном голосовом → один предпросмотр на 6 строк → «Создать все» создаёт 6 задач", async () => {
    h.transcribe.mockResolvedValueOnce("поставь Насте анонс, Вике рилсы, Маше обложку, Сальме пейсеров, Али договор с кофейней и мне отчёт");
    h.script = [call("create_task", { tasks: SIX }), reply("")];
    await h.voice(12, DIMA);
    const previews = h.sent.filter((s) => s.text.startsWith("Проверь, пожалуйста"));
    expect(previews).toHaveLength(1);
    const text = h.preview().text;
    expect(text).toContain("📋 Задачи (6)");
    expect(text).toContain("1. Анонс кофе-рана · Настя (Глава SMM) · до ср 14.10, 12:00");
    expect(text).toContain("2. Рилсы · Вика (SMM) · до чт 15.10");
    expect(text).toContain("6. Отчёт · ты · до пн 19.10");
    expect(h.preview().buttons.map((b) => b.text)).toEqual(["✅ Создать все", "✏️ Изменить", "✖️ Отмена"]);
    await h.press(h.button("✅ Создать все")!, DIMA);
    const tasks = await h.tasks.listAssignedOverview(new Date(0));
    expect(tasks).toHaveLength(6);
    expect(tasks.map((t) => t.assignee_id).sort((a, b) => a - b)).toEqual([NASTYA_HEAD, VIKA_SMM, MASHA_DESIGN, SALMA, ALI, DIMA].sort((a, b) => a - b));
    expect(tasks.every((t) => t.assigned_by === DIMA)).toBe(true);
    expect(new Set(tasks.map((t) => t.source_message_id)).size).toBe(1);
    expect(h.last().text).toMatch(/^✅ Поставила 6 задач: /);
    // Каждому исполнителю — одно сообщение с его задачей.
    for (const chat of [NASTYA_HEAD, VIKA_SMM, MASHA_DESIGN, SALMA, ALI]) {
      expect(h.sent.filter((s) => s.chat === chat && /Новая задача/.test(s.text))).toHaveLength(1);
    }
  });

  it("правка следующим сообщением: у третьей срок пятница, вторую убрать", async () => {
    h.script = [call("create_task", { tasks: SIX }), reply("")];
    await h.say("шесть задач", DIMA);
    h.script = [call("edit_tasks_draft", { changes: [{ n: 3, due: "2026-10-16" }] }), reply("")];
    await h.say("у третьей срок пятница", DIMA);
    expect(h.preview().text).toContain("3. Обложка · Маша (Главный дизайнер) · до пт 16.10");
    expect(h.inputs[2].messages[0]).toMatchObject({ role: "system" });
    expect(JSON.stringify(h.inputs[2].messages[0])).toContain("edit_tasks_draft");
    h.script = [call("edit_tasks_draft", { remove: [2] }), reply("")];
    await h.say("вторую не надо", DIMA);
    const text = h.preview().text;
    expect(text).toContain("📋 Задачи (5)");
    expect(text).not.toContain("Рилсы");
    expect(text).toContain("2. Обложка · Маша (Главный дизайнер) · до пт 16.10");
    await h.press(h.button("✅ Создать все")!, DIMA);
    expect(await h.tasks.listAssignedOverview(new Date(0))).toHaveLength(5);
  });

  it("неоднозначная «Маша» в одной строке блокирует только «Создать все», пока не выбрана", async () => {
    const rows = SIX.map((t, i) => (i === 2 ? { ...t, assignees: [{ name: "Маше" }] } : t));
    h.script = [call("create_task", { tasks: rows }), reply("")];
    await h.say("шесть задач", DIMA);
    const p = h.preview();
    expect(p.text).toContain("3. ⚠️ Обложка · — · до чт 15.10");
    expect(p.text).toContain("«Маше» — кто именно?");
    expect(p.text).toContain("1. Анонс кофе-рана · Настя (Глава SMM)");
    const labels = p.buttons.map((b) => b.text);
    expect(labels).not.toContain("✅ Создать все");
    expect(labels.filter((l) => l.startsWith("3 · Маша"))).toHaveLength(2);
    await h.press(p.buttons.find((b) => b.text.startsWith("3 · Маша") && b.text.includes("gusarovame"))!.data!, DIMA);
    expect(h.preview().text).toContain("3. Обложка · Маша (Ивент-отдел)");
    await h.press(h.button("✅ Создать все")!, DIMA);
    const tasks = await h.tasks.listAssignedOverview(new Date(0));
    expect(tasks.find((t) => t.what === "Обложка")!.assignee_id).toBe(MASHA_EVENTS);
  });

  it("повторный create_task в том же сообщении добавляет задачи, а не перезаписывает", async () => {
    h.script = [
      call("create_task", { assignees: [{ name: "Сальме" }], what: "Найти пейсеров", due: "2026-10-16" }),
      call("create_task", { assignees: [{ name: "Али" }], what: "Договор с кофейней", due: "2026-10-16" }),
      call("create_task", { tasks: [{ assignees: [{ name: "мне" }], what: "Отчёт", due: "2026-10-19" }] }),
      reply(""),
    ];
    await h.say("Сальме пейсеров, Али договор и мне отчёт", DIMA);
    expect(h.preview().text).toContain("📋 Задачи (3)");
    expect(h.preview().text).toContain("1. Найти пейсеров · Сальма (Ивент-отдел)");
    expect(h.preview().text).toContain("3. Отчёт · ты");
  });

  it("21 задача → «за раз до 20, раздели»", async () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ assignees: [{ name: "Сальме" }], what: `Задача ${i + 1}`, due: "2026-10-16" }));
    h.script = [call("create_task", { tasks: many }), reply("За раз — до 20 задач, давай разделим.")];
    await h.say("21 задача", DIMA);
    expect(toolResult(h)).toContain("За раз — до 20 задач, а здесь 21. Раздели на части");
    expect(h.sent.some((s) => s.text.startsWith("Проверь"))).toBe(false);
  });
});
