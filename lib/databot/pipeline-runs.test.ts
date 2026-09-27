import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Update, UserFromGetMe } from "grammy/types";

/**
 * «Забеги» через настоящий конвейер: доступ, окно дат, журнал каждого
 * открытия списка, защищённые сообщения, форма плана явки, CSV документом.
 * Подменено только чтение из базы; всё остальное — боевой код.
 */

const ARCHIVE = [
  { spot: "luzhniki", run_date: "2026-10-03", created_at: "2026-09-25T10:00:00.000Z", confirmed_at: null, reminder_sent_at: null },
  { spot: "luzhniki", run_date: "2026-08-01", created_at: "2026-07-25T10:00:00.000Z", confirmed_at: null, reminder_sent_at: null },
];

vi.mock("../team/history", async (orig) => ({
  ...(await orig<typeof import("../team/history")>()),
  fetchArchive: async () => ARCHIVE,
}));
vi.mock("../team/stats", async (orig) => ({
  ...(await orig<typeof import("../team/stats")>()),
  fetchRunSignups: async () => [],
}));
const plans = new Map<string, number>();
vi.mock("./data/plans", () => ({
  fetchRunPlan: async (spot: string, date: string) => plans.get(`${spot}:${date}`) ?? null,
  setRunPlan: async (spot: string, date: string, target: number) => void plans.set(`${spot}:${date}`, target),
}));
vi.mock("./data/runs", async (orig) => ({
  ...(await orig<typeof import("./data/runs")>()),
  fetchRunPeople: async () => ({ total: 0, newPeople: 0, returningPeople: 0, byLink: {} }),
  fetchRunRoster: async () =>
    Array.from({ length: 35 }, (_, i) => ({
      name: `Участник ${i}`, nick: `n${i}`, pace: null, createdAt: "2026-09-25T10:00:00.000Z",
      confirmedAt: null, reminderSentAt: null, tgLinked: false, isNew: false,
    })),
  fetchRunsTable: async () => [
    { spot: "luzhniki", runDate: "2026-10-03", total: 23, confirmed: 17, reminded: 0, newPeople: 15 },
  ],
}));

const { createDatabot } = await import("./bot");
const { FORM_EXPIRED_TEXT, PEOPLE_HEADER, PEOPLE_WINDOW_TEXT, PLAN_RETRY, STALE_TEXT } = await import("./copy");
const { MemoryStore } = await import("./data/memory-store");

const BOT_INFO = { id: 999, is_bot: true, first_name: "Цифры (тест)", username: "test_databot" } as UserFromGetMe;
type Call = { method: string; payload: Record<string, unknown> };

const EVENTS = 2001;
const SMM = 2002;
const RUN = "d:run:people:luzhniki:2026-10-03:1";

function setup() {
  const store = new MemoryStore();
  let nowMs = Date.parse("2026-09-30T11:32:00Z");
  const clock = () => new Date(nowMs);
  store.clock = clock;
  for (const [chatId, zone] of [[EVENTS, "events"], [SMM, "smm"]] as const) {
    store.members.set(chatId, {
      chat_id: chatId, username: null, display_name: "Имя", zone, is_owner: false, invited_by: null,
      joined_at: "2026-09-01T00:00:00.000Z", last_seen_at: null, is_active: true, removed_at: null,
    });
  }
  const calls: Call[] = [];
  const bot = createDatabot("999:test-token", { botInfo: BOT_INFO, store, now: clock });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ok: true, result: true } as any;
  });
  let id = 1;
  const run = async (u: Record<string, unknown>) => {
    calls.length = 0;
    await bot.handleUpdate({ update_id: id++, ...u } as unknown as Update);
    return calls.slice();
  };
  const chat = (from: number) => ({ id: from, type: "private", first_name: "Имя" });
  return {
    store,
    advance: (ms: number) => void (nowMs += ms),
    text: (from: number, text: string) =>
      run({ message: { message_id: 1, date: 0, chat: chat(from), from: { id: from, is_bot: false, first_name: "Имя" }, text } }),
    press: (from: number, data: string) =>
      run({
        callback_query: {
          id: `cb${id}`, from: { id: from, is_bot: false, first_name: "Имя" }, chat_instance: "x", data,
          message: { message_id: 5, date: 0, chat: chat(from) },
        },
      }),
  };
}

const sent = (calls: Call[]) => calls.filter((c) => c.method === "sendMessage");
const texts = (calls: Call[]) =>
  calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").map((c) => String(c.payload.text));

beforeEach(() => {
  vi.stubEnv("DATABOT_OWNER_IDS", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  plans.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("список участников — доступ и журнал", () => {
  it("у СММ нет кнопки, а прямой callback — отказ и строка журнала ok = false", async () => {
    const t = setup();
    const card = await t.press(SMM, "d:run:card:luzhniki:2026-10-03");
    expect(JSON.stringify(card)).not.toContain("d:run:people");

    const calls = await t.press(SMM, RUN);
    expect(texts(calls).join("\n")).not.toContain(PEOPLE_HEADER);
    expect(texts(calls)[0]).toBe(STALE_TEXT);
    expect(t.store.audit.at(-1)).toMatchObject({ chat_id: SMM, report: "run.people", ok: false, error: "forbidden" });
  });

  it("подделанный callback списка — отказ и run.people ok = false в журнале", async () => {
    const t = setup();
    await t.press(EVENTS, "d:run:people:luzhniki:03-10-2026:1");
    expect(t.store.audit.at(-1)).toMatchObject({ report: "run.people", ok: false, error: "bad_params" });
  });

  it("забег вне окна −3…+14 — фраза про окно и ok = false", async () => {
    const t = setup();
    const calls = await t.press(EVENTS, "d:run:people:luzhniki:2026-08-01:1");
    expect(texts(calls)).toEqual([PEOPLE_WINDOW_TEXT]);
    expect(t.store.audit.at(-1)).toMatchObject({ report: "run.people", ok: false, error: "window" });
  });

  it("ивенты: список — НОВЫМ сообщением с protect_content, не правкой экрана; открытие в журнале", async () => {
    const t = setup();
    const calls = await t.press(EVENTS, RUN);
    expect(calls.some((c) => c.method === "editMessageText")).toBe(false);
    const [msg] = sent(calls);
    expect(msg.payload.protect_content).toBe(true);
    expect(String(msg.payload.text)).toContain(PEOPLE_HEADER);
    expect(t.store.audit.at(-1)).toMatchObject({ report: "run.people", ok: true, params: { spot: "luzhniki", date: "2026-10-03", page: "1" } });
  });

  it("«Ещё» — следующая часть новым защищённым сообщением, кнопка у прошлой снимается", async () => {
    const t = setup();
    const calls = await t.press(EVENTS, "d:run:people:luzhniki:2026-10-03:2");
    const methods = calls.map((c) => c.method);
    expect(methods.indexOf("editMessageReplyMarkup")).toBeGreaterThan(-1);
    expect(methods.indexOf("editMessageReplyMarkup")).toBeLessThan(methods.indexOf("sendMessage"));
    expect(sent(calls)[0].payload.protect_content).toBe(true);
    expect(String(sent(calls)[0].payload.text)).toContain("часть 2 из 2");
  });
});

describe("план явки — первая форма бота", () => {
  it("кнопка → вопрос → не число → повтор → число → карточка с планом", async () => {
    const t = setup();
    await t.press(EVENTS, "d:run:plan:luzhniki:2026-10-03");
    expect(await t.store.getForm(EVENTS)).not.toBeNull();

    expect(texts(await t.text(EVENTS, "двадцать"))).toEqual([PLAN_RETRY]);
    // Текст ушёл в форму, а не в разбор вопроса.
    expect(t.store.audit.at(-1)).toMatchObject({ report: "run.plan.set", source: "text", params: { form: true } });

    const ok = await t.text(EVENTS, "25");
    expect(texts(ok)[0]).toBe("Записала план явки: 25.");
    expect(texts(ok)[1]).toContain("План явки 25, заявок 0 % от плана");
    expect(plans.get("luzhniki:2026-10-03")).toBe(25);
    expect(await t.store.getForm(EVENTS)).toBeNull();
  });

  it("срок формы 10 минут: потом — «Форма устарела», текст никуда не уходит", async () => {
    const t = setup();
    await t.press(EVENTS, "d:run:plan:luzhniki:2026-10-03");
    t.advance(10 * 60 * 1000 + 1000);
    expect(texts(await t.text(EVENTS, "25"))).toEqual([FORM_EXPIRED_TEXT]);
    expect(plans.size).toBe(0);
    expect(await t.store.getForm(EVENTS)).toBeNull();
  });

  it("/cancel и любая другая команда форму закрывают", async () => {
    const t = setup();
    await t.press(EVENTS, "d:run:plan:luzhniki:2026-10-03");
    expect(texts(await t.text(EVENTS, "/cancel"))).toEqual(["Отменила."]);
    expect(await t.store.getForm(EVENTS)).toBeNull();

    await t.press(EVENTS, "d:run:plan:luzhniki:2026-10-03");
    await t.text(EVENTS, "/help");
    expect(await t.store.getForm(EVENTS)).toBeNull();
    // После закрытия число — снова обычный текст, а не план.
    await t.text(EVENTS, "25");
    expect(plans.size).toBe(0);
  });

  it("СММ план явки задать не может даже прямым callback", async () => {
    const t = setup();
    await t.press(SMM, "d:run:plan:luzhniki:2026-10-03");
    expect(await t.store.getForm(SMM)).toBeNull();
    expect(t.store.audit.at(-1)).toMatchObject({ report: "run.plan.set", ok: false, error: "forbidden" });
  });
});

describe("таблица и CSV", () => {
  it("CSV приходит документом в личку", async () => {
    const t = setup();
    const calls = await t.press(SMM, "d:run:csv");
    const doc = calls.find((c) => c.method === "sendDocument");
    expect(doc).toBeDefined();
    expect(t.store.audit.at(-1)).toMatchObject({ report: "run.table.csv", ok: true });
  });
});
