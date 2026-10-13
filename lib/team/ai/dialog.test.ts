import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncTeamTaskMembers } from "../tasks";
import { NOT_OWN_TASKS_TEXT } from "./tools";
import { ALI, NASTYA, NOW, TEAM, call, harness, msk, reply } from "./test-harness";
import { AI_FAIL_TEXT, TeamAiError, type StepInput } from "./yandex";

/**
 * Сценарии «Пятницы» как диалогового ассистента (бриф, этап 5). Модель — мок,
 * отвечает вызовами инструментов по сценарию; проверяется поведение кода:
 * права, черновики, предпросмотры, списки, подтверждение.
 */

const DIMA = 9; // фаундер
const systemOf = (input: StepInput) => (input.messages[0] as { text: string }).text;
const lastUserText = (input: StepInput) => {
  const m = [...input.messages].reverse().find((x) => x.role === "user" && "text" in x) as { text: string } | undefined;
  return m?.text ?? "";
};

describe("«Пятница» — диалоговый ассистент", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(async () => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "8,9");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    h = harness();
    await syncTeamTaskMembers({ store: h.tasks }, NOW, TEAM);
  });
  afterEach(() => {
    // 11. Ни в одном ответе нет шаблона.
    expect(h.texts().some((t) => t.includes("Не поняла. Я умею"))).toBe(false);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** Задачи Али от Димы: «Анонс кофе-рана в ТГК», «Рилсы про кофе-ран», «Отчёт по хакатону». */
  async function aliTasks(n = 3) {
    const items = [
      { what: "Анонс кофе-рана в ТГК", due_at: msk("2026-10-12T12:00").toISOString() },
      { what: "Рилсы про кофе-ран", due_at: msk("2026-10-14T23:59").toISOString() },
      { what: "Отчёт по хакатону", due_at: null },
    ].slice(0, n);
    const out = [];
    for (const [i, t] of items.entries()) out.push(...(await h.tasks.importAssignedTasks(DIMA, 100 + i, [{ line: 1, username: "hulu404", ...t }])));
    return out;
  }

  it("1. «Поставь Маше из ивента…», потом «ой, не Маше, а Сальме» — тот же предпросмотр обновлён", async () => {
    h.script.push(call("create_task", { assignees: [{ name: "Маше", qualifier: "из ивента" }], what: "Найти пейсеров", due: "2026-10-15" }));
    await h.say("Поставь Маше из ивента найти пейсеров до четверга");
    const first = h.preview();
    expect(first.text).toContain("👤 Исполнитель: Маша (Ивент-отдел) @gusarovame");

    h.script.push((input) => {
      expect(systemOf(input)).toContain("Открытый черновик");
      expect(systemOf(input)).toContain("Маша (Ивент-отдел) @gusarovame");
      return call("create_task", { assignees: [{ name: "Сальме" }], what: "Найти пейсеров", due: "2026-10-15" });
    }, reply("Поправила, проверь."));
    await h.say("ой, не Маше, а Сальме");
    const updated = h.preview();
    expect(updated.method).toBe("editMessageText");
    expect(updated.message_id).toBe(h.drafts.drafts.get(1)!.message_id);
    expect(updated.text).toContain("👤 Исполнитель: Сальма (Ивент-отдел) @salmasxsx");
    expect(h.drafts.drafts.size).toBe(1);
  });

  it("2. «Ты неправильно услышала имя, там Вика-разработчик» — исправленный предпросмотр", async () => {
    h.script.push(call("create_task", { assignees: [{ name: "Вике" }], what: "Починить форму", due: "" }));
    await h.say("поставь вике починить форму");
    expect(h.preview().text).toContain("«Вике» — кто именно?");
    h.script.push(call("create_task", { assignees: [{ name: "Вика-разработчик" }], what: "Починить форму" }), reply("Извини, исправила."));
    await h.say("Ты неправильно услышала имя, там Вика-разработчик");
    expect(h.preview()).toMatchObject({ method: "editMessageText" });
    expect(h.preview().text).toContain("👤 Исполнитель: Вика (Разработчик) @dissidenceandtea");
    expect(h.button("✅ Подтвердить")).toBeDefined();
  });

  it("3а. «Удали задачу у Али» — одна задача: сразу предпросмотр отмены, «✅ Подтвердить» — отменено", async () => {
    const [task] = await aliTasks(1);
    h.script.push(call("list_tasks", { scope: "person", person: "Али", purpose: "choose" }), call("set_task_status", { numbers: [1], status: "cancelled" }));
    await h.say("Удали задачу у Али", DIMA);
    expect(h.preview().text).toBe("Проверь, пожалуйста:\n\n❌ Отменю задачу:\n1. @hulu404 · Анонс кофе-рана в ТГК · до 12.10 12:00 ⏰");
    expect(h.tasks.assignedTasks.get(task.id)!.status).toBe("open");
    await h.press(h.button("✅ Подтвердить")!, DIMA);
    expect(h.tasks.assignedTasks.get(task.id)!.status).toBe("cancelled");
    expect(h.last().text).toBe("✅ Отменила 1 задачу.");
    expect(h.sent.some((s) => s.chat === ALI && s.text.includes("Задача отменена"))).toBe(true);
  });

  it("3б. несколько задач — нумерованный список с кнопками; выбор → предпросмотр → отменена только выбранная", async () => {
    const tasks = await aliTasks(3);
    h.script.push(call("list_tasks", { scope: "person", person: "Али", purpose: "choose" }), reply("У Али три задачи, какую отменить?"));
    await h.say("Удали задачу у Али", DIMA);
    const list = h.sent.find((s) => s.text.startsWith("<b>Задачи · Али (3)</b>"))!;
    expect(list.text).toContain("1. @hulu404 · Анонс кофе-рана в ТГК");
    expect(list.buttons.map((b) => b.text)).toEqual(["1", "2", "3"]);
    expect(h.last().text).toBe("У Али три задачи, какую отменить?");
    expect(h.drafts.drafts.size).toBe(0);

    h.script.push((input) => {
      expect(lastUserText(input)).toBe("№2");
      expect(systemOf(input)).toContain(`2. #${tasks[1].id} @hulu404 · Рилсы про кофе-ран`);
      return call("set_task_status", { numbers: [2], status: "cancelled" });
    });
    await h.press(list.buttons[1].data!, DIMA);
    expect(h.preview().text).toContain("❌ Отменю задачу:\n1. @hulu404 · Рилсы про кофе-ран");
    await h.press(h.button("✅ Подтвердить")!, DIMA);
    expect(tasks.map((t) => h.tasks.assignedTasks.get(t.id)!.status)).toEqual(["open", "cancelled", "open"]);
  });

  it("4. «Закрой все задачи команды про анонс кофе-рана» (фаундер) — уточнение и массовое выполнение", async () => {
    const a = await h.tasks.importAssignedTasks(DIMA, 200, [{ line: 1, username: "ananas_2711", what: "Анонс кофе-рана в ТГК", due_at: null }]);
    const b = await h.tasks.importAssignedTasks(DIMA, 201, [{ line: 1, username: "tora_co", what: "Анонс кофе-рана в Instagram", due_at: null }]);
    const other = await h.tasks.importAssignedTasks(DIMA, 202, [{ line: 1, username: "tora_co", what: "Рилсы", due_at: null }]);
    h.script.push(call("list_tasks", { scope: "team", query: "анонс кофе-рана" }), reply("Нашла 2. Отменить их или отметить выполненными?"));
    await h.say("Закрой все задачи команды про анонс кофе-рана", DIMA);
    expect(h.last().text).toBe("Нашла 2. Отменить их или отметить выполненными?");
    h.script.push(call("set_task_status", { numbers: [1, 2], status: "done" }));
    await h.say("отметь выполненными", DIMA);
    expect(h.preview().text).toContain("✅ Отмечу выполненными 2 задачи:\n1. @ananas_2711 · Анонс кофе-рана в ТГК\n2. @tora_co · Анонс кофе-рана в Instagram");
    expect(h.preview().text).toContain("За исполнителя: в задаче останется, что отметил ты.");
    await h.press(h.button("✅ Подтвердить")!, DIMA);
    expect([a[0], b[0], other[0]].map((t) => h.tasks.assignedTasks.get(t.id)!.status)).toEqual(["done", "done", "open"]);
    expect(h.tasks.assignedTasks.get(a[0].id)!.status_by).toBe(DIMA);
    expect(h.last().text).toBe("✅ Отметила выполненными: 2 задачи.");
  });

  it("5. то же от не-фаундера — чужие задачи не найдены и не показаны", async () => {
    await h.tasks.importAssignedTasks(DIMA, 300, [{ line: 1, username: "tora_co", what: "Анонс кофе-рана в Instagram", due_at: null }]);
    let result = "";
    h.script.push(call("list_tasks", { scope: "team", query: "анонс кофе-рана" }), (input) => {
      result = JSON.stringify(input.messages.at(-1));
      return reply(NOT_OWN_TASKS_TEXT);
    });
    await h.say("Закрой все задачи команды про анонс кофе-рана", NASTYA);
    expect(result).toContain('\\"count\\":0');
    expect(result).toContain("only_own");
    expect(h.texts().join("\n")).not.toContain("Instagram");
    expect(h.last().text).toBe("Могу закрыть только свои задачи или поставленные тобой.");

    // И по #id чужую задачу не закрыть: инструмент вернёт отказ, черновика не будет.
    h.script.push(call("set_task_status", { task_ids: [1], status: "cancelled" }), (input) => reply(JSON.parse(
      ((input.messages.at(-1) as { toolResultList: { toolResults: Array<{ functionResult: { content: string } }> } }).toolResultList.toolResults[0].functionResult.content)).error));
    await h.say("отмени задачу номер один", NASTYA);
    expect(h.drafts.drafts.size).toBe(0);
    expect(h.last().text).toBe(NOT_OWN_TASKS_TEXT);
  });

  it("6. «Что горит у Али?» (фаундер) — список без подтверждения, просроченные первыми", async () => {
    await aliTasks(3);
    h.script.push(call("list_tasks", { scope: "person", person: "Али", status: "open" }), reply("Горит анонс: срок прошёл вчера."));
    await h.say("Что горит у Али?", DIMA);
    const list = h.sent.find((s) => s.text.startsWith("<b>Задачи · Али"))!;
    expect(list.text.split("\n").slice(1, 3)).toEqual(["1. @hulu404 · Анонс кофе-рана в ТГК · до 12.10 12:00 ⏰", "2. @hulu404 · Рилсы про кофе-ран · до ср"]);
    expect(list.buttons).toEqual([]);
    expect(h.drafts.drafts.size).toBe(0);
    expect(h.last().text).toBe("Горит анонс: срок прошёл вчера.");
  });

  it("7. «Перенеси вторую на пятницу» после списка — предпросмотр нового срока задачи №2", async () => {
    const tasks = await aliTasks(3);
    h.script.push(call("list_tasks", { scope: "person", person: "Али" }), reply(""));
    await h.say("покажи задачи Али", DIMA);
    h.script.push(call("update_task", { numbers: [2], due: "2026-10-16T18:00" }));
    await h.say("Перенеси вторую на пятницу 18:00", DIMA);
    expect(h.preview().text).toBe("Проверь, пожалуйста:\n\n✏️ Изменю задачу:\n1. @hulu404 · Рилсы про кофе-ран · до ср\n\n⏰ Новый срок: пт 16.10, 18:00");
    await h.press(h.button("✅ Подтвердить")!, DIMA);
    expect(h.tasks.assignedTasks.get(tasks[1].id)!.due_at).toBe(msk("2026-10-16T18:00").toISOString());
    expect(h.tasks.assignedTasks.get(tasks[0].id)!.due_at).toBe(msk("2026-10-12T12:00").toISOString());
  });

  it("8. «Привет» — короткий ответ модели, без шаблона и меню", async () => {
    h.script.push(reply("Привет! Чем помочь?"));
    await h.say("Привет");
    expect(h.last()).toMatchObject({ text: "Привет! Чем помочь?", keyboard: undefined, buttons: [] });
  });

  it("9. «Напиши участникам кофе-рана…» — объяснение про /moved в основном боте", async () => {
    h.script.push((input) => {
      expect(systemOf(input)).toContain("/moved");
      return reply("Участникам пишет основной бот: там команда /moved. Сама я им не пишу.");
    });
    await h.say("Напиши участникам кофе-рана, что старт перенесён");
    expect(h.last().text).toContain("/moved");
  });

  it("10. падение API — «Что-то пошло не так…»", async () => {
    h.script.push(new TeamAiError("api", "HTTP 503"));
    await h.say("что у меня горит?");
    expect(h.last().text).toBe(AI_FAIL_TEXT);
    expect(AI_FAIL_TEXT).toBe("Что-то пошло не так, попробуй ещё раз через минуту.");
  });

  it("больше 20 задач за раз — «слишком много, уточни»", async () => {
    let error = "";
    h.script.push(call("set_task_status", { task_ids: Array.from({ length: 21 }, (_, i) => i + 1), status: "cancelled" }), (input) => {
      error = JSON.stringify(input.messages.at(-1));
      return reply("Слишком много, уточни, какие именно.");
    });
    await h.say("отмени все задачи", DIMA);
    expect(error).toContain("Слишком много задач (21)");
    expect(h.drafts.drafts.size).toBe(0);
  });
});
