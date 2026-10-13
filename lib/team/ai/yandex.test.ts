import { describe, expect, it } from "vitest";
import { INTENT_JSON_SCHEMA, validateIntent, checkWhen, normalizeLocal } from "./intent";
import {
  AI_FAIL_TEXT,
  AI_LIMIT_TEXT,
  LLM_LIMIT_PER_HOUR,
  LLM_URL,
  MemoryAiUsage,
  STT_URL,
  TeamAiError,
  aiErrorText,
  createTeamAi,
  systemPrompt,
  teamAiConfig,
  type FetchLike,
} from "./yandex";

const msk = (local: string) => new Date(`${local}+03:00`);
const NOW = msk("2026-10-13T14:05"); // вт 13.10
const CONFIG = { apiKey: "k", folderId: "f1", modelUri: "gpt://f1/yandexgpt-lite/latest" };

type Call = { url: string; headers: Record<string, string>; body: string | Uint8Array };

function fakeFetch(responses: Array<{ status: number; body?: unknown } | Error>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return { ok: next.status < 300, status: next.status, json: async () => next.body, text: async () => JSON.stringify(next.body ?? "") };
  };
  return { fetch, calls };
}

const llmAnswer = (obj: unknown, usage = { inputTextTokens: "120", completionTokens: "30" }) => ({
  status: 200, body: { result: { alternatives: [{ message: { role: "assistant", text: typeof obj === "string" ? obj : JSON.stringify(obj) } }], usage } },
});

describe("проверка ответа модели", () => {
  it("задача: имена, срок, лишние поля отбрасываются", () => {
    expect(validateIntent({ intent: "create_task", what: "Найти пейсеров", due: "2026-10-15T20:00",
      assignees: [{ name: "Маше", qualifier: "из ивента" }], author: "Настя" })).toEqual({
      intent: "create_task", what: "Найти пейсеров", due: "2026-10-15T20:00", assignees: [{ name: "Маше", qualifier: "из ивента" }],
    });
  });

  it("срок без времени — 23:59; пустой срок — без срока", () => {
    expect(normalizeLocal("2026-10-13")).toBe("2026-10-13T23:59");
    expect(validateIntent({ intent: "create_task", what: "x", due: "", assignees: [{ name: "мне" }] })).toMatchObject({ due: null });
  });

  it("невалидное — unknown, без исключений", () => {
    expect(validateIntent(null).intent).toBe("unknown");
    expect(validateIntent({ intent: "drop_table" }).intent).toBe("unknown");
    expect(validateIntent({ intent: "create_task", what: "x", assignees: "Маше" }).intent).toBe("unknown");
    expect(validateIntent({ intent: "create_task", what: "x", assignees: [{ name: "мне" }], due: "в четверг" }).intent).toBe("unknown");
    expect(validateIntent({ intent: "create_event", title: "x", starts_at: "2026-10-14T10:00", participants: [{ qualifier: "x" }] }).intent).toBe("unknown");
    expect(validateIntent([1, 2]).intent).toBe("unknown");
  });

  it("понятое намерение без нужного поля — не unknown, а missing", () => {
    expect(validateIntent({ intent: "create_task", what: "x", assignees: [] })).toEqual({ intent: "create_task", what: "x", assignees: [], due: null, missing: ["assignees"] });
    expect(validateIntent({ intent: "create_task", what: "", assignees: [{ name: "мне", qualifier: "" }] })).toMatchObject({ missing: ["what"] });
    expect(validateIntent({ intent: "create_reminder", text: "про отчёт", remind_at: "" })).toMatchObject({ intent: "create_reminder", missing: ["remind_at"] });
    expect(validateIntent({ intent: "create_reminder", text: "x", remind_at: "2026-02-30T10:00" })).toMatchObject({ missing: ["remind_at"] });
    expect(validateIntent({ intent: "create_event", title: "x", starts_at: "2026-10-13T25:00", participants: [] })).toMatchObject({ missing: ["starts_at"] });
    // Только день: дата сохраняется, спрашивается время, 23:59 встрече не подставляется.
    expect(validateIntent({ intent: "create_event", title: "Онлайн-встреча", starts_at: "2026-10-13", participants: [], place: "" }))
      .toEqual({ intent: "create_event", title: "Онлайн-встреча", starts_at: "", place: null, participants: [], kind: "meeting", date: "2026-10-13", missing: ["starts_at"] });
    expect(validateIntent({ intent: "create_event", title: "", starts_at: "", participants: [] })).toMatchObject({ missing: ["title", "starts_at"] });
    // У задачи день без времени — по-прежнему конец дня.
    expect(validateIntent({ intent: "create_task", what: "x", assignees: [{ name: "мне" }], due: "2026-10-14" })).toMatchObject({ due: "2026-10-14T23:59" });
  });

  it("чтение: show_schedule по умолчанию неделя", () => {
    expect(validateIntent({ intent: "show_schedule", range: "tomorrow" })).toEqual({ intent: "show_schedule", range: "tomorrow" });
    expect(validateIntent({ intent: "show_schedule" })).toEqual({ intent: "show_schedule", range: "week" });
  });

  it("дата в прошлом и дальше года", () => {
    expect(checkWhen("2026-10-13T14:00", NOW)).toEqual({ ok: false, error: "past" });
    expect(checkWhen("2027-10-20T10:00", NOW)).toEqual({ ok: false, error: "far" });
    expect(checkWhen("2026-10-13T16:00", NOW)).toEqual({ ok: true, at: msk("2026-10-13T16:00") });
  });
});

describe("схема для Яндекса", () => {
  type Node = { type?: string; properties?: Record<string, Node>; required?: readonly string[]; additionalProperties?: boolean; items?: Node };
  const objects = (node: Node, path = "$"): Array<[string, Node]> => [
    ...(node.type === "object" ? [[path, node] as [string, Node]] : []),
    ...Object.entries(node.properties ?? {}).flatMap(([k, v]) => objects(v, `${path}.${k}`)),
    ...(node.items ? objects(node.items, `${path}[]`) : []),
  ];

  it("в каждом объекте (и в items массивов) required — все ключи properties, additionalProperties: false", () => {
    const all = objects(INTENT_JSON_SCHEMA as unknown as Node);
    expect(all.map(([p]) => p)).toEqual(["$", "$.assignees[]", "$.participants[]"]);
    for (const [path, node] of all) {
      expect([...(node.required ?? [])].sort(), path).toEqual(Object.keys(node.properties ?? {}).sort());
      expect(node.additionalProperties, path).toBe(false);
    }
  });

  it("без nullable-типов", () => {
    expect(JSON.stringify(INTENT_JSON_SCHEMA)).not.toContain("null");
  });
});

describe("полностью заполненный ответ с пустыми значениями", () => {
  const empty = { intent: "unknown", what: "", due: "", assignees: [], text: "", remind_at: "", task_hint: "", title: "",
    starts_at: "", place: "", participants: [], kind: "meeting", range: "week", reason: "" };

  it("create_task без срока; пустое уточнение — null", () => {
    expect(validateIntent({ ...empty, intent: "create_task", what: "Найти пейсеров", assignees: [{ name: "Маше", qualifier: "" }] }))
      .toEqual({ intent: "create_task", what: "Найти пейсеров", due: null, assignees: [{ name: "Маше", qualifier: null }] });
  });

  it("create_reminder без task_hint", () => {
    expect(validateIntent({ ...empty, intent: "create_reminder", text: "заполнить форму", remind_at: "2026-10-13T14:00" }))
      .toEqual({ intent: "create_reminder", text: "заполнить форму", remind_at: "2026-10-13T14:00", task_hint: null });
  });

  it("create_event без места и участников", () => {
    expect(validateIntent({ ...empty, intent: "create_event", title: "Планёрка", starts_at: "2026-10-14T19:00", kind: "meeting" }))
      .toEqual({ intent: "create_event", title: "Планёрка", starts_at: "2026-10-14T19:00", place: null, participants: [], kind: "meeting" });
  });

  it("show_my_day и unknown игнорируют лишние поля", () => {
    expect(validateIntent({ ...empty, intent: "show_my_day" })).toEqual({ intent: "show_my_day" });
    expect(validateIntent({ ...empty, intent: "show_schedule", range: "tomorrow" })).toEqual({ intent: "show_schedule", range: "tomorrow" });
    expect(validateIntent({ ...empty, intent: "unknown", reason: "" })).toEqual({ intent: "unknown", reason: "не поняла" });
    expect(validateIntent({ ...empty, intent: "unknown", reason: "болтовня" })).toEqual({ intent: "unknown", reason: "болтовня" });
  });
});

describe("конфигурация", () => {
  it("выключено без флага или ключей; модель по умолчанию — YandexGPT Lite", () => {
    expect(teamAiConfig({ YANDEX_API_KEY: "k", YANDEX_FOLDER_ID: "f" })).toBeNull();
    expect(teamAiConfig({ TEAM_AI_ENABLED: "true", YANDEX_FOLDER_ID: "f" })).toBeNull();
    expect(teamAiConfig({ TEAM_AI_ENABLED: "true", YANDEX_API_KEY: "k", YANDEX_FOLDER_ID: "f" }))
      .toEqual({ apiKey: "k", folderId: "f", modelUri: "gpt://f/yandexgpt-lite/latest" });
    expect(teamAiConfig({ TEAM_AI_ENABLED: "true", YANDEX_API_KEY: "k", YANDEX_FOLDER_ID: "f", YANDEX_LLM_MODEL: "yandexgpt/rc" })!.modelUri)
      .toBe("gpt://f/yandexgpt/rc");
  });

  it("выключенный флаг: клиент не ходит в сеть", async () => {
    const { fetch, calls } = fakeFetch([]);
    const ai = createTeamAi({ config: null, usage: new MemoryAiUsage(), fetch, now: () => NOW });
    await expect(ai.parseIntent({ chatId: 1, text: "привет", now: NOW, team: [] })).rejects.toMatchObject({ code: "disabled" });
    expect(calls).toHaveLength(0);
  });
});

describe("запросы к Яндексу", () => {
  it("разбор: схема, ключ, контекст даты и команды; расход записан без текста", async () => {
    const usage = new MemoryAiUsage();
    const { fetch, calls } = fakeFetch([llmAnswer({ intent: "show_my_day" })]);
    const ai = createTeamAi({ config: CONFIG, usage, fetch, now: () => NOW });
    const team = [{ name: "Маша", title: "Ивент-отдел", departments: ["Ивенты"], username: "gusarovame" }];
    expect(await ai.parseIntent({ chatId: 7, text: "что у меня сегодня?", now: NOW, team })).toEqual({ intent: "show_my_day" });
    expect(calls[0].url).toBe(LLM_URL);
    expect(calls[0].headers.Authorization).toBe("Api-Key k");
    const body = JSON.parse(String(calls[0].body));
    expect(body.modelUri).toBe("gpt://f1/yandexgpt-lite/latest");
    expect(body.jsonSchema.schema).toEqual(JSON.parse(JSON.stringify(INTENT_JSON_SCHEMA)));
    expect(body.messages[0].text).toContain("Сейчас вторник 2026-10-13, 14:05 по Москве");
    expect(body.messages[0].text).toContain("пятница 2026-10-16");
    expect(body.messages[0].text).toContain("- Маша, Ивент-отдел, отделы: Ивенты, @gusarovame");
    expect(usage.rows).toEqual([{ chat_id: 7, kind: "llm", tokens_in: 120, tokens_out: 30, created_at: NOW.toISOString() }]);
  });

  it("ответ не JSON или не по схеме — unknown", async () => {
    const { fetch } = fakeFetch([llmAnswer("Конечно! Вот задача: ..."), llmAnswer({ intent: "create_task", assignees: "Маше" }), { status: 200, body: {} }]);
    const ai = createTeamAi({ config: CONFIG, usage: new MemoryAiUsage(), fetch, now: () => NOW });
    for (let i = 0; i < 3; i++) expect((await ai.parseIntent({ chatId: 1, text: "x", now: NOW, team: [] })).intent).toBe("unknown");
  });

  it("JSON в ```-обёртке принимается", async () => {
    const { fetch } = fakeFetch([llmAnswer("```json\n{\"intent\":\"show_my_tasks\"}\n```")]);
    const ai = createTeamAi({ config: CONFIG, usage: new MemoryAiUsage(), fetch, now: () => NOW });
    expect(await ai.parseIntent({ chatId: 1, text: "x", now: NOW, team: [] })).toEqual({ intent: "show_my_tasks" });
  });

  it("один повтор при 429, 5xx и сетевой ошибке; 400 не повторяется", async () => {
    let f = fakeFetch([{ status: 503 }, llmAnswer({ intent: "show_my_day" })]);
    let ai = createTeamAi({ config: CONFIG, usage: new MemoryAiUsage(), fetch: f.fetch, now: () => NOW });
    expect((await ai.parseIntent({ chatId: 1, text: "x", now: NOW, team: [] })).intent).toBe("show_my_day");
    expect(f.calls).toHaveLength(2);

    f = fakeFetch([new Error("ECONNRESET"), { status: 429 }]);
    ai = createTeamAi({ config: CONFIG, usage: new MemoryAiUsage(), fetch: f.fetch, now: () => NOW });
    const err = await ai.parseIntent({ chatId: 1, text: "x", now: NOW, team: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(TeamAiError);
    expect(aiErrorText(err)).toBe(AI_FAIL_TEXT);
    expect(f.calls).toHaveLength(2);

    f = fakeFetch([{ status: 400, body: { error: "bad" } }]);
    ai = createTeamAi({ config: CONFIG, usage: new MemoryAiUsage(), fetch: f.fetch, now: () => NOW });
    await expect(ai.parseIntent({ chatId: 1, text: "x", now: NOW, team: [] })).rejects.toMatchObject({ code: "api" });
    expect(f.calls).toHaveLength(1);
  });

  it("лимит: 40 запросов к LLM в час на человека, дальше — без запроса", async () => {
    const usage = new MemoryAiUsage();
    for (let i = 0; i < LLM_LIMIT_PER_HOUR; i++) await usage.record({ chat_id: 5, kind: "llm" }, new Date(NOW.getTime() - 30 * 60_000));
    await usage.record({ chat_id: 5, kind: "llm" }, new Date(NOW.getTime() - 2 * 3_600_000));
    const { fetch, calls } = fakeFetch([llmAnswer({ intent: "show_my_day" })]);
    const ai = createTeamAi({ config: CONFIG, usage, fetch, now: () => NOW });
    const err = await ai.parseIntent({ chatId: 5, text: "x", now: NOW, team: [] }).catch((e) => e);
    expect(aiErrorText(err)).toBe(AI_LIMIT_TEXT);
    expect(calls).toHaveLength(0);
    // У другого человека свой лимит.
    expect((await ai.parseIntent({ chatId: 6, text: "x", now: NOW, team: [] })).intent).toBe("show_my_day");
  });

  it("распознавание: oggopus, ru-RU, без folderId; секунды в учёте", async () => {
    const usage = new MemoryAiUsage();
    const { fetch, calls } = fakeFetch([{ status: 200, body: { result: "поставь маше задачу" } }]);
    const ai = createTeamAi({ config: CONFIG, usage, fetch, now: () => NOW });
    expect(await ai.transcribe(3, new Uint8Array([1, 2, 3]), 4.2)).toBe("поставь маше задачу");
    expect(calls[0].url).toBe(`${STT_URL}?lang=ru-RU&format=oggopus`);
    expect(calls[0].url).not.toContain("folderId");
    expect(usage.rows[0]).toMatchObject({ chat_id: 3, kind: "stt", audio_seconds: 5 });
  });

  it("голосовое длиннее 30 секунд или больше 1 МБ не отправляется", async () => {
    const { fetch, calls } = fakeFetch([]);
    const ai = createTeamAi({ config: CONFIG, usage: new MemoryAiUsage(), fetch, now: () => NOW });
    await expect(ai.transcribe(1, new Uint8Array(10), 31)).rejects.toBeInstanceOf(TeamAiError);
    await expect(ai.transcribe(1, new Uint8Array(1024 * 1024 + 1), 10)).rejects.toBeInstanceOf(TeamAiError);
    expect(calls).toHaveLength(0);
  });

  it("в инструкции нет ничего, кроме имени, должности, отделов и ника", () => {
    const text = systemPrompt(NOW, [{ name: "Сальма", title: "Ивент-отдел", departments: ["Ивенты"], username: "salmasxsx" }]);
    expect(text).toContain("- Сальма, Ивент-отдел, отделы: Ивенты, @salmasxsx");
    expect(text).not.toMatch(/\+7|телефон/i);
  });
});
