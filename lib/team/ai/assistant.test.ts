import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncTeamTaskMembers } from "../tasks";
import { VOICE_TOO_LONG_TEXT, dispatchTeamMinute } from "./assistant";
import { ALI, MASHA_EVENTS, NASTYA, NOW, SALMA, TEAM, call, harness, msk, reply } from "./test-harness";
import { AI_FAIL_TEXT, AI_LIMIT_TEXT, TeamAiError } from "./yandex";

describe("ассистент: черновики через инструменты", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "8,9");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    h = harness();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const pacers = { assignees: [{ name: "Маше", qualifier: "из ивента" }], what: "Найти пейсеров на кофе-ран", due: "2026-10-15T20:00" };

  it("create_task: предпросмотр, до «✅ Подтвердить» ничего нет; расход — одна строка на сообщение", async () => {
    h.script.push(call("create_task", pacers), reply("Проверь, пожалуйста."));
    await h.say("Поставь Маше из ивента найти пейсеров, дедлайн в четверг 20:00");
    expect(h.preview().text).toBe([
      "Проверь, пожалуйста:", "",
      "📋 Задача", "Найти пейсеров на кофе-ран",
      "👤 Исполнитель: Маша (Ивент-отдел) @gusarovame",
      "⏰ Срок: чт 15.10, 20:00", "✍️ Автор: ты",
    ].join("\n"));
    expect(h.preview().buttons.map((b) => b.text)).toEqual(["✅ Подтвердить", "✖️ Отмена"]);
    expect(h.tasks.assignedTasks.size).toBe(0);
    expect(h.usage).toEqual([[ALI, 150, 15]]);
    // Предпросмотр говорит сам за себя: текст модели после него не дублируется.
    expect(h.sent.filter((s) => s.text === "Проверь, пожалуйста.")).toHaveLength(0);

    await h.press(h.button("✅ Подтвердить")!);
    const all = [...h.tasks.assignedTasks.values()];
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ username: "gusarovame", assignee_id: MASHA_EVENTS, assigned_by: ALI, due_at: msk("2026-10-15T20:00").toISOString() });
    expect(h.last()).toMatchObject({ method: "editMessageText", text: "✅ Задача поставлена: Маша, срок чт 15.10, 20:00" });
    expect((await h.state.get(ALI)).draft_id).toBeNull();
  });

  it("в модель уходят система с контекстом, память и новое сообщение", async () => {
    h.script.push(reply("Привет! Чем помочь?"));
    await h.say("Привет");
    h.script.push(reply("Всегда рада."));
    await h.say("спасибо");
    const msgs = h.inputs[1].messages;
    expect(msgs[0]).toMatchObject({ role: "system" });
    expect((msgs[0] as { text: string }).text).toContain("Сейчас вторник 2026-10-13, 14:05 по Москве");
    expect(msgs.slice(1)).toEqual([
      { role: "user", text: "Привет" }, { role: "assistant", text: "Привет! Чем помочь?" }, { role: "user", text: "спасибо" },
    ]);
    expect(h.last().text).toBe("Всегда рада.");
  });

  it("create_reminder: привязка к задаче и «✅ Выполнено» ровно в срок", async () => {
    h.clock = msk("2026-10-13T13:00");
    await syncTeamTaskMembers({ store: h.tasks }, h.clock, TEAM);
    const [mine] = await h.tasks.importAssignedTasks(9, 1, [{ line: 1, username: "hulu404", what: "Заполнить форму по хакатону", due_at: null }]);
    h.script.push(call("create_reminder", { text: "заполнить форму по хакатону", remind_at: "2026-10-13T14:00", task_hint: "форма по хакатону" }));
    await h.say("Напомни мне в 14:00 заполнить форму по хакатону");
    expect(h.preview().text).toContain("⏰ Напоминание\nзаполнить форму по хакатону\n🕘 Когда: вт 13.10, 14:00\n🔗 К задаче: Заполнить форму по хакатону");
    await h.press(h.button("✅ Подтвердить")!);
    const api = { sendMessage: vi.fn(async () => ({}) as never) };
    expect(await dispatchTeamMinute({ reminders: h.reminders, drafts: h.drafts, tasks: h.tasks }, api as never, msk("2026-10-13T14:00"))).toEqual(["reminder 1"]);
    expect(api.sendMessage).toHaveBeenCalledWith(ALI, "⏰ Напоминание: заполнить форму по хакатону",
      expect.objectContaining({ reply_markup: { inline_keyboard: [[{ text: "✅ Выполнено", callback_data: `tk:s:done:${mine.id}` }]] } }));
  });

  it("create_event: встреча с участниками, каждому карточка", async () => {
    h.script.push(call("create_event", { title: "Сбивка по кофе-рану", starts_at: "2026-10-13T16:00", place: "малая переговорная",
      participants: [{ name: "Сальме" }, { name: "со мной" }] }));
    await h.say("Поставь встречу Сальме на 16:00 в малой переговорной со мной, сбивка по кофе-рану");
    expect(h.preview().text).toContain("🗓 Сбивка по кофе-рану\n🕘 Когда: вт 13.10, 16:00\n📍 Где: малая переговорная\n👥 Участники: ты, Сальма (Ивент-отдел) @salmasxsx");
    await h.press(h.button("✅ Подтвердить")!);
    const ev = [...h.events.events.values()][0];
    expect(ev).toMatchObject({ kind: "meeting", created_by: ALI, starts_at: msk("2026-10-13T16:00").toISOString() });
    expect([...h.participants.rows.get(ev.id)!].sort()).toEqual([SALMA, ALI].sort());
    expect(h.sent.filter((s) => s.method === "sendMessage" && s.text.startsWith("🗓 Встреча:")).map((s) => s.chat)).toEqual([SALMA]);
  });

  it("чтение — сразу: get_my_day показывает день без подтверждения", async () => {
    h.script.push(call("get_my_day"), reply(""));
    await h.say("Что у меня на сегодня?");
    expect(h.last().text).toBe("☀️ План для Али");
    expect(h.drafts.drafts.size).toBe(0);
  });

  it("дата в прошлом — «✅ Подтвердить» нет и не срабатывает", async () => {
    h.script.push(call("create_task", { ...pacers, due: "2026-10-13T09:00" }));
    await h.say("поставь Маше из ивента найти пейсеров сегодня в 9");
    expect(h.preview().text).toContain("⚠️ ⏰ Срок: вт 13.10, 09:00 — уже прошло.");
    expect(h.button("✅ Подтвердить")).toBeUndefined();
    await h.press("ai:ok:1");
    expect(h.tasks.assignedTasks.size).toBe(0);
  });

  it("автор — отправитель: аргумент «author» модель передать не может", async () => {
    h.script.push(call("create_task", { ...pacers, author: "zuzya_zyzya", assigned_by: 1 }));
    await h.say("Настя поставила: Маше из ивента найти пейсеров", NASTYA);
    await h.press(h.button("✅ Подтвердить")!, NASTYA);
    expect([...h.tasks.assignedTasks.values()][0].assigned_by).toBe(NASTYA);
  });

  it("повторное «✅ Подтвердить» ничего не делает; чужой черновик не нажать; истёкший — не срабатывает", async () => {
    h.script.push(call("create_task", pacers));
    await h.say("поставь Маше из ивента найти пейсеров");
    const ok = h.button("✅ Подтвердить")!;
    await h.press(ok, NASTYA);
    expect(h.tasks.assignedTasks.size).toBe(0);
    await h.press(ok);
    await h.press(ok);
    expect(h.tasks.assignedTasks.size).toBe(1);

    h.script.push(call("create_task", pacers));
    await h.say("и ещё раз то же");
    h.clock = new Date(NOW.getTime() + 61 * 60_000);
    await h.press(h.button("✅ Подтвердить")!);
    expect(h.tasks.assignedTasks.size).toBe(1);
    expect(h.last().text).toContain("Черновик устарел");
  });

  it("«✖️ Отмена» удаляет черновик", async () => {
    h.script.push(call("create_task", pacers));
    await h.say("поставь Маше из ивента найти пейсеров");
    await h.press(h.button("✖️ Отмена")!);
    expect(h.drafts.drafts.size).toBe(0);
    expect(h.last().text).toBe("Отменила.");
  });

  it("тёзки — кнопки выбора с должностью, после выбора «✅ Подтвердить»", async () => {
    h.script.push(call("create_task", { ...pacers, assignees: [{ name: "Маше" }] }));
    await h.say("поставь Маше найти пейсеров");
    expect(h.preview().buttons.map((b) => b.text)).toEqual(["Маша (Главный дизайнер) @mouserdyuk", "Маша (Ивент-отдел) @gusarovame", "✖️ Отмена"]);
    await h.press(h.preview().buttons[1].data!);
    expect(h.preview().text).toContain("👤 Исполнитель: Маша (Ивент-отдел) @gusarovame");
    expect(h.button("✅ Подтвердить")).toBeDefined();
  });

  it("задача отделу и правило «и мне»", async () => {
    h.script.push(call("create_task", { what: "Пост", assignees: [{ name: "смм-щикам" }, { name: "мне" }] }));
    await h.say("поставь смм-щикам и мне сделать пост", NASTYA);
    expect(h.preview().text).toContain("👤 Исполнитель: ты\n👥 SMM: Настя @zuzya_zyzya, Вика @tora_co");
  });

  describe("один вопрос, если не хватает обязательного", () => {
    const meeting = { title: "", starts_at: "2026-10-13", participants: [{ name: "ивент-отделом" }] };

    it("встреча без времени → «Во сколько?»; «в 18» разбирает код без модели", async () => {
      h.script.push(call("create_event", meeting));
      await h.say("Поставь сегодня онлайн-встречу с ивент-отделом");
      expect(h.last().text).toBe("Поняла: встреча с ивент-отделом сегодня, вт 13.10, онлайн.\nВо сколько?\nНапиши или надиктуй время, например «в 18:30».");
      const steps = h.inputs.length;
      await h.say("в 18");
      expect(h.inputs).toHaveLength(steps);
      expect(h.preview().text).toContain("🗓 Встреча с ивент-отделом\n🕘 Когда: вт 13.10, 18:00\n📍 Где: Онлайн\n👥 Участники: ты, Ивент-отдел: Маша @gusarovame, Сальма @salmasxsx");
      await h.press(h.button("✅ Подтвердить")!);
      expect([...h.events.events.values()][0]).toMatchObject({ title: "Встреча с ивент-отделом", place: "Онлайн" });
    });

    it("ответ кнопкой [18:00] — предпросмотр в том же сообщении", async () => {
      h.script.push(call("create_event", meeting));
      await h.say("онлайн-встреча с ивент-отделом сегодня");
      await h.press(h.last().buttons.find((b) => b.text === "18:00")!.data!);
      expect(h.last()).toMatchObject({ method: "editMessageText" });
      expect(h.last().text).toContain("🕘 Когда: вт 13.10, 18:00");
    });

    it("пустое голосовое во время вопроса — «Не расслышала», вопрос остаётся", async () => {
      h.script.push(call("create_event", meeting));
      await h.say("онлайн-встреча с ивент-отделом сегодня");
      h.transcribe.mockResolvedValueOnce("");
      await h.voice(3);
      expect(h.last().text).toBe("Не расслышала, запиши ещё раз.");
      await h.voice(0);
      expect(h.transcribe).toHaveBeenCalledTimes(1);
      expect(h.drafts.drafts.get(1)!.intent).toMatchObject({ awaiting: "starts_at", asked: 1 });
    });

    it("задача без исполнителя → «Кому поставить задачу?» с отделами и людьми", async () => {
      h.script.push(call("create_task", { what: "Выложить сторис", due: "2026-10-14", assignees: [] }));
      await h.say("Поставь задачу выложить сторис до завтра");
      expect(h.last().text).toContain("Кому поставить задачу?");
      expect(h.last().buttons.slice(0, 4).map((b) => b.text)).toEqual(["👥 SMM", "👥 Ивент-отдел", "👥 Дизайн", "👥 Разработка"]);
      await h.say("Сальме");
      expect(h.preview().text).toContain("👤 Исполнитель: Сальма (Ивент-отдел) @salmasxsx");
    });
  });

  describe("голос и ошибки", () => {
    it("голосовое длиннее 30 секунд — отказ до скачивания; 🗣 нигде нет", async () => {
      await h.voice(31);
      expect(h.last().text).toBe(VOICE_TOO_LONG_TEXT);
      expect(h.download).not.toHaveBeenCalled();
      h.script.push(call("create_task", pacers));
      await h.voice(6);
      expect(h.inputs.at(-2)!.messages.at(-1)).toEqual({ role: "user", text: "поставь маше из ивента найти пейсеров до четверга 20:00" });
      expect(h.sent.some((s) => s.text.includes("🗣"))).toBe(false);
    });

    it("падение API — «Что-то пошло не так…»; лимит — своё сообщение", async () => {
      h.script.push(new TeamAiError("api", "HTTP 500"));
      await h.say("поставь Маше задачу");
      expect(h.last().text).toBe(AI_FAIL_TEXT);
      h.limited = true;
      await h.say("ещё");
      expect(h.last().text).toBe(AI_LIMIT_TEXT);
    });
  });
});
