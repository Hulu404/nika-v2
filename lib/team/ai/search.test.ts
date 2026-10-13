import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncTeamTaskMembers } from "../tasks";
import { searchTasks, searchTokens } from "./tools";
import { NOW, TEAM, call, harness, reply } from "./test-harness";
import type { AssignedTask } from "../../databot/task-list";

const DIMA = 9;
const task = (id: number, what: string) => ({ id, what }) as AssignedTask;

describe("поиск задач по тексту", () => {
  it("синонимы сводятся с обеих сторон", () => {
    expect([...searchTokens("анонс в ТГК и инсте")]).toEqual(["анонс", "тгк", "instagram"]);
    expect([...searchTokens("Анонс кофе-рана: пост в ТГК и Instagram")]).toEqual(["анонс", "коферан", "пост", "тгк", "instagram"]);
    expect([...searchTokens("рилсы в телегу, сторис и шортс про кофран")]).toEqual(["reels", "тгк", "stories", "шорт", "коферан"]);
    expect([...searchTokens("инструкция по посту")]).toEqual(["инстр", "пост"]);
  });

  it("не все слова обязательны: хватит половины, лучшие совпадения первыми", () => {
    const tasks = [task(1, "Рилсы про кофе-ран"), task(2, "Анонс кофе-рана: пост в ТГК и Instagram"), task(3, "Пост в ТГК про хакатон")];
    expect(searchTasks(tasks, "анонс в ТГК и инсте").map((t) => t.id)).toEqual([2]);
    // Два значимых слова — хватит одного; где совпало оба — первой.
    expect(searchTasks(tasks, "пост в телегу про хакатон").map((t) => t.id)).toEqual([3, 2]);
    expect(searchTasks(tasks, "рилс").map((t) => t.id)).toEqual([1]);
    expect(searchTasks(tasks, "бухгалтерия")).toEqual([]);
  });
});

describe("list_tasks с запросом", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(async () => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "8,9");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    h = harness();
    await syncTeamTaskMembers({ store: h.tasks }, NOW, TEAM);
    for (const [i, u] of ["zuzya_zyzya", "ananas_2711", "tora_co"].entries()) {
      await h.tasks.importAssignedTasks(DIMA, 10 + i, [{ line: 1, username: u, what: "Анонс кофе-рана: пост в ТГК и Instagram", due_at: null }]);
    }
    await h.tasks.importAssignedTasks(DIMA, 20, [{ line: 1, username: "tora_co", what: "Рилсы про кофе-ран", due_at: null }]);
    await h.tasks.importAssignedTasks(DIMA, 21, [{ line: 1, username: "gusarovame", what: "Анонс в ТГК про хакатон", due_at: null }]);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("«анонс в ТГК и инсте» в отделе СММ находит все три анонса", async () => {
    h.script.push(call("list_tasks", { scope: "department", department: "smm", query: "анонс в ТГК и инсте" }), reply(""));
    await h.say("найди задачи смм про анонс в тгк и инсте", DIMA);
    const list = h.sent.find((s) => s.text.startsWith("<b>Задачи · SMM"))!;
    expect(list.text.split("\n").slice(1)).toEqual([
      "1. @zuzya_zyzya · Анонс кофе-рана: пост в ТГК и Instagram",
      "2. @ananas_2711 · Анонс кофе-рана: пост в ТГК и Instagram",
      "3. @tora_co · Анонс кофе-рана: пост в ТГК и Instagram",
    ]);
  });

  it("по запросу пусто — подсказка и все открытые задачи области, список человеку не показан", async () => {
    let result = "";
    h.script.push(call("list_tasks", { scope: "department", department: "smm", query: "бухгалтерия" }), (input) => {
      result = (input.messages.at(-1) as { toolResultList: { toolResults: Array<{ functionResult: { content: string } }> } }).toolResultList.toolResults[0].functionResult.content;
      return reply("По «бухгалтерии» ничего, вот что есть у СММ.");
    });
    await h.say("задачи смм про бухгалтерию", DIMA);
    const parsed = JSON.parse(result);
    expect(parsed).toMatchObject({ found: 0, hint: "по запросу ничего, вот все открытые задачи в этой области" });
    expect(parsed.tasks.map((t: { assignee: string }) => t.assignee)).toEqual(["@zuzya_zyzya", "@ananas_2711", "@tora_co", "@tora_co"]);
    expect(h.sent.some((s) => s.text.startsWith("<b>Задачи"))).toBe(false);
  });

  it("сценарий с прода: удалить анонсы у всех в СММ, кроме Насти главы СММ", async () => {
    const before = [...h.tasks.assignedTasks.values()];
    const id = (u: string) => before.find((t) => t.username === u && t.what.startsWith("Анонс кофе-рана"))!.id;
    const nastya = [{ name: "Насти", qualifier: "главы СММ" }];
    h.script.push(
      call("list_tasks", { scope: "department", department: "smm", query: "пост анонс в тгк и в инсте", exclude_people: nastya }),
      // Модель по ошибке передаёт и задачу Насти — исключение её всё равно уберёт.
      call("set_task_status", { task_ids: [id("zuzya_zyzya"), id("ananas_2711"), id("tora_co")], status: "cancelled", exclude_people: nastya }),
    );
    await h.say("посмотри задачи смм отдела, на сегодня у них стоят задачи выпустить пост анонс в тгк и в инсте, эти задачи надо удалить у всех, кроме Насти главы СММ", DIMA);
    const list = h.sent.find((s) => s.text.startsWith("<b>Задачи · SMM"))!;
    expect(list.text).toContain("кроме Настя (Глава SMM)");
    expect(list.text).not.toContain("@zuzya_zyzya");
    expect(h.preview().text).toBe([
      "Проверь, пожалуйста:", "",
      "❌ Отменю 2 задачи:",
      "1. @ananas_2711 · Анонс кофе-рана: пост в ТГК и Instagram",
      "2. @tora_co · Анонс кофе-рана: пост в ТГК и Instagram",
      "Кроме: Настя (Глава SMM)",
    ].join("\n"));
    await h.press(h.button("✅ Подтвердить")!, DIMA);
    expect(["zuzya_zyzya", "ananas_2711", "tora_co"].map((u) => h.tasks.assignedTasks.get(id(u))!.status)).toEqual(["open", "cancelled", "cancelled"]);
  });

  it("«кроме Насти» без уточнения — вопрос, кого именно, без черновика", async () => {
    let result = "";
    h.script.push(call("list_tasks", { scope: "department", department: "smm", exclude_people: [{ name: "Насти" }] }), (input) => {
      result = JSON.stringify(input.messages.at(-1));
      return reply("Какую Настю исключить?");
    });
    await h.say("задачи смм у всех кроме насти", DIMA);
    expect(result).toContain("Кого именно исключить");
    expect(h.drafts.drafts.size).toBe(0);
  });
});
