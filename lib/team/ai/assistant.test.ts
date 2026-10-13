import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { MemoryStore } from "../../databot/data/memory-store";
import type { TeamMember } from "../access";
import { MemoryEventStore } from "../events";
import { MemoryTeamForms } from "../form";
import { ROSTER } from "../roster";
import { showMyTasks, syncTeamTaskMembers } from "../tasks";
import {
  AI_EDIT_PROMPT,
  AI_UNKNOWN_TEXT,
  VOICE_TOO_LONG_TEXT,
  dispatchTeamMinute,
  handleAiMessage,
  handleAiUpdate,
  type AssistantDeps,
} from "./assistant";
import { validateIntent, type Intent } from "./intent";
import { MemoryDraftStore, MemoryParticipantStore, MemoryReminderStore } from "./stores";
import { AI_FAIL_TEXT, TeamAiError, type ParseInput, type TeamAi } from "./yandex";

const msk = (local: string) => new Date(`${local}+03:00`);
const NOW = msk("2026-10-13T14:05"); // вт 13.10

// Команда — как после roster.ts; chat_id по порядку: Настя-глава 1 … Али 8, Дмитрий 9.
const team: TeamMember[] = ROSTER.map((r, i) => ({
  chat_id: i + 1, username: r.username, display_name: r.firstName, role: "member", joined_at: "2026-10-01T00:00:00Z",
  added_by: null, last_seen_at: null, digest_opt_in: true, first_name: r.firstName, title: r.title,
  departments: r.departments, name_aliases: r.aliases,
}));
const ALI = 8;
const NASTYA = 2; // Настя из SMM, не фаундер
const MASHA_EVENTS = 6;
const SALMA = 7;

type Sent = { method: string; chat: number; text: string; message_id?: number; buttons: Array<{ text: string; data?: string }>; keyboard?: unknown };

describe("голос и свободный текст", () => {
  let sent: Sent[];
  let deps: AssistantDeps;
  let drafts: MemoryDraftStore;
  let tasks: MemoryStore;
  let events: MemoryEventStore;
  let reminders: MemoryReminderStore;
  let participants: MemoryParticipantStore;
  let answers: Array<Intent | ((input: ParseInput) => Intent) | Error>;
  let inputs: ParseInput[];
  let transcribe: ReturnType<typeof vi.fn>;
  let download: ReturnType<typeof vi.fn>;
  let clock: Date;
  let say: (text: string, from?: number) => Promise<void>;
  let voice: (duration: number, from?: number, size?: number) => Promise<void>;
  let press: (data: string, from?: number) => Promise<void>;
  const preview = () => [...sent].reverse().find((s) => s.text.includes("Проверь, пожалуйста"))!;
  const button = (label: string) => preview().buttons.find((b) => b.text === label)?.data;

  beforeEach(() => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "8,9");
    sent = [];
    clock = NOW;
    drafts = new MemoryDraftStore();
    tasks = new MemoryStore();
    events = new MemoryEventStore();
    reminders = new MemoryReminderStore();
    participants = new MemoryParticipantStore();
    answers = [];
    inputs = [];
    transcribe = vi.fn(async () => "поставь маше из ивента найти пейсеров до четверга 20:00");
    download = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const ai: TeamAi = {
      transcribe: transcribe as unknown as TeamAi["transcribe"],
      parseIntent: async (input) => {
        inputs.push(input);
        const next = answers.shift();
        if (!next) return { intent: "unknown", reason: "нет ответа" };
        if (next instanceof Error) throw next;
        return typeof next === "function" ? next(input) : next;
      },
    };
    const taskDeps = { store: tasks, findMember: async (id: number) => team.find((m) => m.chat_id === id) ?? null, listTeam: async () => team, forms: new MemoryTeamForms() };
    deps = {
      ai, drafts, tasks, events, reminders, participants, forms: new MemoryTeamForms(),
      listTeam: async () => team,
      findMember: async (id) => team.find((m) => m.chat_id === id) ?? null,
      downloadVoice: download as unknown as AssistantDeps["downloadVoice"],
      showMyTasks: (ctx, uid) => showMyTasks(ctx, uid, taskDeps, clock),
      showSchedule: async (ctx) => { await ctx.reply("🗓 Расписание"); },
      myDay: async (m) => `☀️ План для ${m.first_name}`,
    };

    const bot = new Bot("1:x", { botInfo: { id: 1, is_bot: true, first_name: "П", username: "t_bot" } as UserFromGetMe });
    let mid = 1000;
    bot.api.config.use(async (_prev, method, payload) => {
      const p = payload as { chat_id: number; message_id?: number; text?: string; reply_markup?: { inline_keyboard?: Array<Array<{ text: string; callback_data?: string }>>; keyboard?: unknown } };
      const record: Sent = { method, chat: p.chat_id, text: String(p.text ?? ""), message_id: p.message_id,
        buttons: (p.reply_markup?.inline_keyboard ?? []).flat().map((b) => ({ text: b.text, data: b.callback_data })), keyboard: p.reply_markup?.keyboard };
      if (method === "sendMessage" || method === "editMessageText") sent.push(record);
      const result = method === "sendMessage" ? { message_id: ++mid, date: 1, chat: { id: p.chat_id, type: "private" } } : true;
      return { ok: true, result } as never;
    });
    bot.use(async (ctx) => {
      if (await handleAiUpdate(ctx, deps, clock)) return;
      const member = team.find((m) => m.chat_id === ctx.from?.id)!;
      await handleAiMessage(ctx, member, deps, clock);
    });
    let id = 0;
    const chat = (from: number) => ({ id: from, type: "private" as const, first_name: "x" });
    const user = (from: number) => ({ id: from, is_bot: false, first_name: "x" });
    say = async (text, from = ALI) => {
      await bot.handleUpdate({ update_id: ++id, message: { message_id: ++mid, date: 1, text, chat: chat(from), from: user(from) } } as Update);
    };
    voice = async (duration, from = ALI, size = 20_000) => {
      await bot.handleUpdate({ update_id: ++id, message: { message_id: ++mid, date: 1, chat: chat(from), from: user(from),
        voice: { file_id: "v1", file_unique_id: "u1", duration, mime_type: "audio/ogg", file_size: size } } } as Update);
    };
    press = async (data, from = ALI) => {
      await bot.handleUpdate({ update_id: ++id, callback_query: { id: `c${id}`, chat_instance: "x", data, from: user(from),
        message: { message_id: preview()?.message_id ?? 1, date: 1, text: "x", chat: chat(from) } } } as Update);
    };
  });
  afterEach(() => vi.unstubAllEnvs());

  const pacers: Intent = { intent: "create_task", what: "Найти пейсеров на кофе-ран", due: "2026-10-15T20:00", assignees: [{ name: "Маше", qualifier: "из ивента" }] };

  describe("примеры из брифа", () => {
    it("«Поставь Маше из ивента найти пейсеров, дедлайн в четверг 20:00»: предпросмотр, до «Создать» ничего нет", async () => {
      answers.push(pacers);
      await say("Поставь Маше из ивента найти пейсеров, дедлайн в четверг 20:00");
      expect(preview().text).toBe([
        "Проверь, пожалуйста:", "",
        "📋 Задача", "Найти пейсеров на кофе-ран",
        "👤 Исполнитель: Маша (Ивент-отдел) @gusarovame",
        "⏰ Срок: чт 15.10, 20:00", "✍️ Автор: ты",
      ].join("\n"));
      expect(preview().buttons.map((b) => b.text)).toEqual(["✅ Создать", "✏️ Изменить", "✖️ Отмена"]);
      expect(tasks.assignedTasks.size).toBe(0);
      expect(inputs[0]).toMatchObject({ chatId: ALI, now: NOW });
      expect(inputs[0].team.find((p) => p.username === "gusarovame")).toEqual({ name: "Маша", title: "Ивент-отдел", departments: ["Ивенты"], username: "gusarovame" });

      await press(button("✅ Создать")!);
      const all = [...tasks.assignedTasks.values()];
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ username: "gusarovame", assignee_id: MASHA_EVENTS, assigned_by: ALI, what: "Найти пейсеров на кофе-ран",
        due_at: msk("2026-10-15T20:00").toISOString(), delivery_state: "sent" });
      expect(sent.some((s) => s.method === "editMessageText" && s.text === "✅ Задача поставлена: Маша, срок чт 15.10, 20:00")).toBe(true);
      expect(sent.some((s) => s.chat === MASHA_EVENTS && s.text.includes("Найти пейсеров"))).toBe(true);
    });

    it("«Напомни мне в 14:00 заполнить форму по хакатону»: привязка к задаче и «✅ Выполнено» ровно в 14:00", async () => {
      clock = msk("2026-10-13T13:00");
      await syncTeamTaskMembers({ store: tasks }, clock, team);
      const [mine] = await tasks.importAssignedTasks(9, 1, [{ line: 1, username: "hulu404", what: "Заполнить форму по хакатону", due_at: null }]);
      answers.push({ intent: "create_reminder", text: "заполнить форму по хакатону", remind_at: "2026-10-13T14:00", task_hint: "форма по хакатону" });
      await say("Напомни мне в 14:00 заполнить форму по хакатону");
      expect(preview().text).toContain("⏰ Напоминание\nзаполнить форму по хакатону\n🕘 Когда: вт 13.10, 14:00\n🔗 К задаче: Заполнить форму по хакатону\nВидишь только ты.");
      await press(button("✅ Создать")!);
      expect([...reminders.reminders.values()]).toMatchObject([{ chat_id: ALI, task_id: mine.id, remind_at: msk("2026-10-13T14:00").toISOString() }]);

      const api = { sendMessage: vi.fn(async () => ({}) as never) };
      expect(await dispatchTeamMinute({ reminders, drafts, tasks }, api as never, msk("2026-10-13T13:59"))).toEqual([]);
      expect(await dispatchTeamMinute({ reminders, drafts, tasks }, api as never, msk("2026-10-13T14:00"))).toEqual(["reminder 1"]);
      await dispatchTeamMinute({ reminders, drafts, tasks }, api as never, msk("2026-10-13T14:01"));
      expect(api.sendMessage).toHaveBeenCalledTimes(1);
      expect(api.sendMessage).toHaveBeenCalledWith(ALI, "⏰ Напоминание: заполнить форму по хакатону",
        expect.objectContaining({ reply_markup: { inline_keyboard: [[{ text: "✅ Выполнено", callback_data: `tk:s:done:${mine.id}` }]] } }));
    });

    it("«Поставь встречу Сальме на 16:00 в малой переговорной со мной, сбивка по кофе-рану»", async () => {
      answers.push({ intent: "create_event", title: "Сбивка по кофе-рану", starts_at: "2026-10-13T16:00", place: "малая переговорная",
        participants: [{ name: "Сальме", qualifier: null }, { name: "со мной", qualifier: null }], kind: "meeting" });
      await say("Поставь встречу Сальме на 16:00 в малой переговорной со мной, сбивка по кофе-рану");
      expect(preview().text).toContain("🗓 Сбивка по кофе-рану\n🕘 Когда: вт 13.10, 16:00\n📍 Где: малая переговорная\n👥 Участники: ты, Сальма (Ивент-отдел) @salmasxsx\n✍️ Автор: ты");
      expect(events.events.size).toBe(0);
      await press(button("✅ Создать")!);
      const ev = [...events.events.values()][0];
      expect(ev).toMatchObject({ kind: "meeting", title: "Сбивка по кофе-рану", created_by: ALI, place: "малая переговорная", starts_at: msk("2026-10-13T16:00").toISOString() });
      expect([...participants.rows.get(ev.id)!].sort()).toEqual([SALMA, ALI].sort());
      expect(sent.filter((s) => s.method === "sendMessage" && s.text.startsWith("🗓 Встреча:")).map((s) => s.chat)).toEqual([SALMA]);
      expect(sent.some((s) => s.text === "✅ Встреча создана: Сбивка по кофе-рану, вт 13.10, 16:00")).toBe(true);
    });

    it("«Что у меня на сегодня?» — сразу, без черновика", async () => {
      answers.push({ intent: "show_my_day" });
      await say("Что у меня на сегодня?");
      expect(sent.at(-1)!.text).toBe("☀️ План для Али");
      expect(drafts.drafts.size).toBe(0);
    });
  });

  describe("даты", () => {
    const cases: Array<[string, string, string]> = [
      ["завтра", "2026-10-14T23:59", "ср 14.10, 23:59"],
      ["в пятницу", "2026-10-16T23:59", "пт 16.10, 23:59"],
      ["через 2 часа", "2026-10-13T16:05", "вт 13.10, 16:05"],
      ["сегодня 14 30", "2026-10-13T14:30", "вт 13.10, 14:30"],
    ];
    for (const [phrase, due, shown] of cases) {
      it(`«${phrase}» — дата явно с днём недели: ${shown}`, async () => {
        answers.push({ ...pacers, due } as Intent);
        await say(`поставь Маше из ивента найти пейсеров ${phrase}`);
        expect(preview().text).toContain(`⏰ Срок: ${shown}`);
        expect(button("✅ Создать")).toBeDefined();
      });
    }

    it("дата в прошлом: предупреждение, «Создать» нет и не срабатывает", async () => {
      answers.push({ ...pacers, due: "2026-10-13T09:00" } as Intent);
      await say("поставь Маше из ивента найти пейсеров сегодня в 9");
      expect(preview().text).toContain("⚠️ ⏰ Срок: вт 13.10, 09:00 — уже прошло. Нажми «✏️ Изменить».");
      expect(button("✅ Создать")).toBeUndefined();
      await press("ai:ok:1");
      expect(tasks.assignedTasks.size).toBe(0);
    });
  });

  describe("правила", () => {
    it("автор — отправитель, даже если в тексте назван другой", async () => {
      answers.push(validateIntent({ ...pacers, author: "zuzya_zyzya", assigned_by: 1 }));
      await say("Настя поставила: Маше из ивента найти пейсеров к четвергу 20:00", NASTYA);
      expect(preview().text).toContain("✍️ Автор: ты");
      await press(button("✅ Создать")!, NASTYA);
      expect([...tasks.assignedTasks.values()][0].assigned_by).toBe(NASTYA);
    });

    it("повторное «Создать» ничего не создаёт; чужой черновик не нажать", async () => {
      answers.push(pacers);
      await say("поставь Маше из ивента найти пейсеров");
      const ok = button("✅ Создать")!;
      await press(ok, NASTYA);
      expect(tasks.assignedTasks.size).toBe(0);
      await press(ok);
      await press(ok);
      expect(tasks.assignedTasks.size).toBe(1);
    });

    it("истёкший черновик: «Создать» через час не срабатывает", async () => {
      answers.push(pacers);
      await say("поставь Маше из ивента найти пейсеров");
      const ok = button("✅ Создать")!;
      clock = new Date(NOW.getTime() + 61 * 60_000);
      await press(ok);
      expect(tasks.assignedTasks.size).toBe(0);
      expect(sent.at(-1)!.text).toContain("Черновик устарел");
      expect(drafts.drafts.size).toBe(0);
    });

    it("«Отмена» удаляет черновик", async () => {
      answers.push(pacers);
      await say("поставь Маше из ивента найти пейсеров");
      await press(button("✖️ Отмена")!);
      expect(drafts.drafts.size).toBe(0);
      expect(sent.at(-1)!.text).toBe("Отменила.");
    });

    it("«Изменить» меняет только срок; выбор человека кнопкой сохраняется; предпросмотр — в том же сообщении", async () => {
      answers.push({ ...pacers, assignees: [{ name: "Маше", qualifier: null }] } as Intent);
      await say("поставь Маше найти пейсеров в четверг 20:00");
      expect(preview().text).toContain("«Маше» — кто именно? Выбери ниже");
      expect(preview().buttons.map((b) => b.text)).toEqual(["Маша (Главный дизайнер) @mouserdyuk", "Маша (Ивент-отдел) @gusarovame", "✏️ Изменить", "✖️ Отмена"]);
      await press(preview().buttons[1].data!);
      expect(preview().text).toContain("👤 Исполнитель: Маша (Ивент-отдел) @gusarovame");
      const messageId = drafts.drafts.get(1)!.message_id;

      await press(button("✏️ Изменить")!);
      expect(sent.at(-1)!.text).toBe(AI_EDIT_PROMPT);
      answers.push((input) => {
        expect(input.previous).toMatchObject({ intent: "create_task", due: "2026-10-15T20:00" });
        expect(input.text).toBe("не в четверг, а в среду");
        return { ...(input.previous as Extract<Intent, { intent: "create_task" }>), due: "2026-10-14T20:00" };
      });
      await say("не в четверг, а в среду");
      const updated = sent.at(-1)!;
      expect(updated).toMatchObject({ method: "editMessageText", message_id: messageId });
      expect(updated.text).toContain("Найти пейсеров на кофе-ран\n👤 Исполнитель: Маша (Ивент-отдел) @gusarovame\n⏰ Срок: ср 14.10, 20:00");
      await press(button("✅ Создать")!);
      expect([...tasks.assignedTasks.values()][0]).toMatchObject({ username: "gusarovame", due_at: msk("2026-10-14T20:00").toISOString() });
    });

    it("неизвестный человек — список команды кнопками", async () => {
      answers.push({ ...pacers, assignees: [{ name: "Пете", qualifier: null }] } as Intent);
      await say("поставь Пете найти пейсеров");
      expect(preview().text).toContain("Не нашла в команде «Пете». Выбери ниже");
      expect(preview().buttons).toHaveLength(team.length + 2);
    });

    it("участник через «покажи задачи Маши» видит только свои задачи", async () => {
      await syncTeamTaskMembers({ store: tasks }, NOW, team);
      await tasks.importAssignedTasks(ALI, 1, [{ line: 1, username: "gusarovame", what: "Секретная задача Маши", due_at: null }]);
      await tasks.importAssignedTasks(ALI, 2, [{ line: 1, username: "ananas_2711", what: "Пост про кофе-ран", due_at: null }]);
      answers.push({ intent: "show_my_tasks" });
      await say("покажи задачи Маши", NASTYA);
      const screen = sent.at(-1)!.text;
      expect(screen).toContain("Пост про кофе-ран");
      expect(screen).not.toContain("Секретная");
    });

    it("непонятое — подсказка и кнопки меню", async () => {
      answers.push({ intent: "unknown", reason: "болтовня" });
      await say("как дела у тебя сегодня");
      expect(sent.at(-1)!.text).toBe(AI_UNKNOWN_TEXT);
      expect(sent.at(-1)!.keyboard).toBeDefined();
    });

    it("ошибка Яндекса — понятный ответ", async () => {
      answers.push(new TeamAiError("api", "HTTP 500"));
      await say("поставь Маше задачу");
      expect(sent.at(-1)!.text).toBe(AI_FAIL_TEXT);
    });
  });

  describe("уточняющие вопросы и отделы", () => {
    const blank = { what: "", due: "", assignees: [], text: "", remind_at: "", task_hint: "", title: "", starts_at: "", place: "",
      participants: [], kind: "meeting", range: "week", reason: "" };
    /** Как ответила бы модель: полный объект схемы → validateIntent. */
    const model = (raw: Record<string, unknown>) => validateIntent({ ...blank, ...raw });
    const onlineMeeting = (mention: string) => model({ intent: "create_event", title: "Онлайн-встреча", starts_at: "2026-10-13",
      participants: [{ name: mention, qualifier: "" }] });
    const question = "Поняла: встреча с ивент-отделом сегодня, вт 13.10, онлайн.\nВо сколько?\nНапиши или надиктуй время, например «в 18:30».";
    const meetingPreview = [
      "🗓 Встреча с ивент-отделом", "🕘 Когда: вт 13.10, 18:00", "📍 Где: Онлайн",
      "👥 Участники: ты, Ивент-отдел: Маша @gusarovame, Сальма @salmasxsx", "✍️ Автор: ты",
    ].join("\n");

    it("«Поставь сегодня онлайн-встречу с ивент-отделом» → один вопрос «Во сколько?» с «Поняла» → «в 18» без модели → предпросмотр", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      answers.push(onlineMeeting("ивент-отделом"));
      await say("Поставь сегодня онлайн-встречу с ивент-отделом");
      const q = sent.at(-1)!;
      expect(q.text).toBe(question);
      expect(q.buttons.map((b) => b.text)).toEqual(["15:00", "18:00", "19:00", "✖️ Отмена"]);
      expect(warn).toHaveBeenCalledWith("[team-ai] clarify: create_event awaiting=starts_at attempt=1");
      expect(warn.mock.calls.flat().join(" ")).not.toContain("Поставь");
      warn.mockRestore();
      expect(events.events.size).toBe(0);

      await say("в 18");
      expect(inputs).toHaveLength(1); // время разобрал код, модель второй раз не звали
      expect(sent.filter((x) => x.text.includes("Во сколько") || x.text.includes("Как назвать"))).toHaveLength(1);
      expect(preview().method).toBe("sendMessage");
      expect(preview().text).toContain(meetingPreview);
      await press(button("✅ Создать")!);
      const ev = [...events.events.values()][0];
      expect(ev).toMatchObject({ title: "Встреча с ивент-отделом", place: "Онлайн", starts_at: msk("2026-10-13T18:00").toISOString() });
      expect([...participants.rows.get(ev.id)!].sort((a, b) => a - b)).toEqual([MASHA_EVENTS, SALMA, ALI]);
    });

    it("кривой STT «ивента дел» → то же; ответ кнопкой [18:00] → предпросмотр в том же сообщении", async () => {
      answers.push(onlineMeeting("ивента дел"));
      await say("составь сегодня онлайн встречу с ивента дел");
      const q = sent.at(-1)!;
      expect(q.text).toBe(question);
      await press(q.buttons.find((b) => b.text === "18:00")!.data!);
      expect(sent.at(-1)!.method).toBe("editMessageText");
      expect(sent.at(-1)!.text).toContain("🕘 Когда: вт 13.10, 18:00\n📍 Где: Онлайн");
      expect(sent.at(-1)!.text).toContain("👥 Участники: ты, Ивент-отдел: Маша @gusarovame, Сальма @salmasxsx");
      expect(sent.at(-1)!.buttons.map((b) => b.text)).toContain("✅ Создать");
    });

    it("«созвон» в ответ на время — «Не поняла время…», не тот же вопрос; на третью неудачу черновик закрыт", async () => {
      answers.push(onlineMeeting("ивент-отделом"));
      await say("Поставь сегодня онлайн-встречу с ивент-отделом");
      answers.push((input) => {
        expect(input.focus).toBe("starts_at");
        return input.previous!; // модель тоже не нашла время
      });
      await say("созвон");
      expect(sent.at(-1)!.text).toBe("Не поняла время. Выбери кнопкой или напиши, например, «в 18:30».");
      expect(sent.at(-1)!.buttons.map((b) => b.text)).toEqual(["15:00", "18:00", "19:00", "✖️ Отмена"]);
      answers.push((input) => input.previous!);
      await say("ну это");
      expect(sent.at(-1)!.text).toContain("Не поняла время");
      answers.push((input) => input.previous!);
      await say("не знаю");
      expect(sent.at(-1)!.text).toBe("Не получилось. Попробуй записать заново целиком.");
      expect(drafts.drafts.size).toBe(0);
      // Вопросов бота по черновику — не больше трёх.
      expect(sent.filter((x) => /Во сколько|Не поняла время/.test(x.text))).toHaveLength(3);
    });

    it("пустое голосовое во время вопроса — «Не расслышала», вопрос активен, счётчик не растёт", async () => {
      answers.push(onlineMeeting("ивент-отделом"));
      await say("Поставь сегодня онлайн-встречу с ивент-отделом");
      transcribe.mockResolvedValueOnce("");
      await voice(3);
      expect(sent.at(-1)!.text).toBe("Не расслышала, запиши ещё раз.");
      await voice(0);
      expect(sent.at(-1)!.text).toBe("Не расслышала, запиши ещё раз.");
      expect(transcribe).toHaveBeenCalledTimes(1); // короче секунды в SpeechKit не уходит
      expect(drafts.drafts.get(1)!.intent).toMatchObject({ awaiting: "starts_at", asked: 1, failures: 0 });
      await say("в 18");
      expect(preview().text).toContain("🕘 Когда: вт 13.10, 18:00");
    });

    it("«Встреча завтра в 16 с Сальмой» — сразу предпросмотр, название «Встреча с Сальмой»", async () => {
      answers.push(model({ intent: "create_event", title: "Встреча", starts_at: "2026-10-14T16:00", participants: [{ name: "Сальмой", qualifier: "" }] }));
      await say("Встреча завтра в 16 с Сальмой");
      expect(preview().text).toContain("🗓 Встреча с Сальмой\n🕘 Когда: ср 14.10, 16:00\n👥 Участники: ты, Сальма (Ивент-отдел) @salmasxsx");
      expect(sent.some((x) => /Во сколько|Как назвать/.test(x.text))).toBe(false);
    });

    it("«Встреча завтра в 16 с Машей из ивента» — один человек, не отдел", async () => {
      answers.push(model({ intent: "create_event", title: "Встреча", starts_at: "2026-10-14T16:00", participants: [{ name: "Машей", qualifier: "из ивента" }] }));
      await say("Встреча завтра в 16 с Машей из ивента");
      expect(preview().text).toContain("👥 Участники: ты, Маша (Ивент-отдел) @gusarovame");
      expect(preview().text).not.toContain("👥 Ивент-отдел:");
    });

    it("«Поставь задачу выложить сторис до завтра» — «Кому?» с кнопками людей и отделов", async () => {
      answers.push(model({ intent: "create_task", what: "Выложить сторис", due: "2026-10-14T23:59" }));
      await say("Поставь задачу выложить сторис до завтра");
      const q = sent.at(-1)!;
      expect(q.text).toBe("Поняла: задача «Выложить сторис», срок ср 14.10, 23:59.\nКому поставить задачу?\nНапиши или надиктуй имя или отдел, или выбери кнопкой.");
      expect(q.buttons.slice(0, 4).map((b) => b.text)).toEqual(["👥 SMM", "👥 Ивент-отдел", "👥 Дизайн", "👥 Разработка"]);
      expect(q.buttons.map((b) => b.text)).toContain("Сальма (Ивент-отдел) @salmasxsx");
      await press(q.buttons.find((b) => b.text === "👥 SMM")!.data!);
      expect(sent.at(-1)!.text).toContain("👥 SMM: Настя @zuzya_zyzya, Настя @ananas_2711, Вика @tora_co");
    });

    it("ответ «Сальме» на «Кому?» разбирает код, без модели", async () => {
      answers.push(model({ intent: "create_task", what: "Выложить сторис" }));
      await say("Поставь задачу выложить сторис");
      await say("Сальме");
      expect(inputs).toHaveLength(1);
      expect(preview().text).toContain("👤 Исполнитель: Сальма (Ивент-отдел) @salmasxsx");
    });

    it("«Напомни мне позвонить в Surf» → «Когда напомнить?» → «через час» → предпросмотр", async () => {
      answers.push(model({ intent: "create_reminder", text: "позвонить в Surf" }));
      await say("Напомни мне позвонить в Surf");
      const q = sent.at(-1)!;
      expect(q.text).toBe("Поняла: напоминание «позвонить в Surf».\nКогда напомнить?\nНапиши или надиктуй, например «в 18:30» или «через час».");
      expect(q.buttons.map((b) => b.text)).toEqual(["через 30 мин", "через час", "сегодня 18:00", "завтра 10:00", "✖️ Отмена"]);
      await say("через час");
      expect(inputs).toHaveLength(1);
      expect(preview().text).toContain("⏰ Напоминание\nпозвонить в Surf\n🕘 Когда: вт 13.10, 15:05");
    });

    it("«Поставь задачу СММ выложить сторис до завтра 12:00» — три исполнителя из СММ", async () => {
      answers.push(model({ intent: "create_task", what: "Выложить сторис", due: "2026-10-14T12:00", assignees: [{ name: "СММ", qualifier: "" }] }));
      await say("Поставь задачу СММ выложить сторис до завтра 12:00");
      expect(preview().text).toContain("📋 Задача\nВыложить сторис\n👥 SMM: Настя @zuzya_zyzya, Настя @ananas_2711, Вика @tora_co\n⏰ Срок: ср 14.10, 12:00");
      await press(button("✅ Создать")!);
      expect([...tasks.assignedTasks.values()].map((t) => t.username).sort()).toEqual(["ananas_2711", "tora_co", "zuzya_zyzya"]);
      expect(sent.some((x) => x.text === "✅ Задача поставлена: SMM, срок ср 14.10, 12:00")).toBe(true);
    });

    it("отправитель из отдела в задачу отделу не попадает, пока не скажет «и мне»", async () => {
      answers.push(model({ intent: "create_task", what: "Пост", assignees: [{ name: "смм-щикам", qualifier: "" }] }));
      await say("поставь смм-щикам сделать пост", NASTYA);
      expect(preview().text).toContain("👥 SMM: Настя @zuzya_zyzya, Вика @tora_co");
      answers.push(model({ intent: "create_task", what: "Пост", assignees: [{ name: "смм-щикам", qualifier: "" }, { name: "мне", qualifier: "" }] }));
      await say("поставь смм-щикам и мне сделать пост", NASTYA);
      expect(preview().text).toContain("👤 Исполнитель: ты\n👥 SMM: Настя @zuzya_zyzya, Вика @tora_co");
    });

    it("пустой отдел — сообщение и выбор людей кнопками", async () => {
      answers.push(model({ intent: "create_task", what: "Починить бота", assignees: [{ name: "разработке", qualifier: "" }] }));
      await say("поставь разработке починить бота", 4); // единственная в «Разработке» — сама Вика
      expect(preview().text).toContain("В отделе «Разработка» никого нет. Выбери людей ниже");
      expect(button("✅ Создать")).toBeUndefined();
      expect(preview().buttons).toHaveLength(team.length + 2);
    });

    it("встреча без названия и участников — «Встреча», про название не спрашиваем", async () => {
      answers.push(model({ intent: "create_event", starts_at: "2026-10-14T11:00" }));
      await say("поставь встречу завтра в 11");
      expect(preview().text).toContain("🗓 Встреча\n🕘 Когда: ср 14.10, 11:00");
    });

    it("задача без текста и бессмысленный текст — «Не поняла»", async () => {
      answers.push(model({ intent: "create_task", assignees: [{ name: "Сальме", qualifier: "" }] }));
      await say("поставь Сальме задачу ну эту");
      expect(sent.at(-1)!.text).toBe(AI_UNKNOWN_TEXT);
      answers.push(model({ intent: "unknown", reason: "непонятно" }));
      await say("фыва олдж пролд ывап");
      expect(sent.at(-1)!.text).toBe(AI_UNKNOWN_TEXT);
      expect(drafts.drafts.size).toBe(0);
    });
  });

  describe("голосовые", () => {
    it("длиннее 30 секунд — отказ до скачивания", async () => {
      await voice(31);
      expect(sent.at(-1)!.text).toBe(VOICE_TOO_LONG_TEXT);
      expect(download).not.toHaveBeenCalled();
      expect(transcribe).not.toHaveBeenCalled();
      await voice(10, ALI, 2 * 1024 * 1024);
      expect(download).not.toHaveBeenCalled();
    });

    it("расшифровки «🗣» нет ни в одном сообщении: вопрос, предпросмотр, итог; текст лежит в черновике", async () => {
      transcribe.mockResolvedValueOnce("поставь на сегодня созвон с ивент отделом с машей и сальва");
      answers.push(validateIntent({ intent: "create_event", title: "Созвон с Маше и Сальме", starts_at: "2026-10-13",
        participants: [{ name: "ивент отделом", qualifier: "" }, { name: "машей", qualifier: "" }, { name: "сальва", qualifier: "" }] }));
      await voice(6);
      expect(drafts.drafts.get(1)!.source_text).toBe("поставь на сегодня созвон с ивент отделом с машей и сальва");
      expect(sent.at(-1)!.text).toBe("Поняла: созвон с ивент-отделом сегодня, вт 13.10, онлайн.\nВо сколько?\nНапиши или надиктуй время, например «в 18:30».");
      transcribe.mockResolvedValueOnce("в 21 30");
      await voice(2);
      expect(preview().text).toBe([
        "Проверь, пожалуйста:", "",
        "🗓 Созвон с ивент-отделом",
        "🕘 Когда: вт 13.10, 21:30",
        "📍 Где: Онлайн",
        "👥 Участники: ты, Ивент-отдел: Маша @gusarovame, Сальма @salmasxsx",
        "✍️ Автор: ты",
      ].join("\n"));
      await press(button("✅ Создать")!);
      expect(sent.length).toBeGreaterThan(2);
      expect(sent.some((x) => x.text.includes("🗣"))).toBe(false);
    });

    it("в «Поняла» и списках нет «с <имя в именительном>»", async () => {
      answers.push(validateIntent({ intent: "create_event", title: "Сбивка по кофе-рану", starts_at: "2026-10-14",
        participants: [{ name: "Сальмой", qualifier: "" }, { name: "Викой", qualifier: "из смм" }] }));
      await say("сбивка по кофе-рану завтра с Сальмой и Викой из смм");
      const q = sent.at(-1)!.text;
      expect(q).toContain("Поняла: сбивка по кофе-рану завтра, ср 14.10, участники: Сальма, Вика.");
      expect(q).not.toMatch(/\sс (Маша|Сальма|Вика|Настя|Али|Дмитрий)\b/);
    });
  });
});
