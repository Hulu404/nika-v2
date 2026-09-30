import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Справочник пуст: текст без совпадений идёт в «Не поняла вопрос».
vi.mock("./data/kb", async (orig) => ({
  ...(await orig<typeof import("./data/kb")>()),
  listKbArticles: async () => [],
  getKbArticle: async () => null,
}));
import type { Update, UserFromGetMe } from "grammy/types";
import { createDatabot } from "./bot";
import {
  DB_DOWN_TEXT,
  NOT_READY_TEXT,
  OWNER_PROTECTED_TEXT,
  RATE_LIMIT_TEXT,
  STALE_TEXT,
  STRANGER_TEXT,
  UNKNOWN_TEXT,
} from "./copy";
import { MemoryStore } from "./data/memory-store";
import { INVITE_TTL_MS } from "./invite";
import { fetchPro } from "./data/pro";
import { fetchProduct } from "./data/product";

vi.mock("./data/pro", () => ({ fetchPro: vi.fn(async () => ({
  proNow: 3, proPaid: 1, proPromo: 1, proManual: 1, paymentsCount: 1, paymentsSum: 299,
  paymentsByPlan: {}, redeemedByCode: [], redeemedToPaid: 0, expiring7d: 0,
})) }));
vi.mock("./data/product", () => ({ fetchProduct: vi.fn(async () => ({
  signups: 4, onboarded: 2, tgLinked: 1, byChannel: {}, active7d: 3,
  sprintsStarted: 0, sprintsActive: 0, sprintsClosed: 0, nudgeSent: 0, nudgeClicked: 0, nsm: null,
})) }));

/**
 * Конвейер целиком на настоящем grammY: вызовы Bot API перехватываются
 * трансформером, база — MemoryStore. Все chat_id выдуманные.
 */

const OWNER = 500;
const ALICE = 1001;
const BOB = 1002;

// Только нужные боту поля: остальные флаги getMe от версии к версии grammY
// прибавляются, а конвейер их не читает.
const BOT_INFO = { id: 999, is_bot: true, first_name: "Цифры (тест)", username: "test_databot" } as UserFromGetMe;

type Call = { method: string; payload: Record<string, unknown> };

function setup() {
  const store = new MemoryStore();
  let nowMs = Date.parse("2026-10-01T09:00:00Z");
  const clock = () => new Date(nowMs);
  store.clock = clock;
  const calls: Call[] = [];
  const bot = createDatabot("999:test-token", { botInfo: BOT_INFO, store, now: clock });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: true } as Awaited<ReturnType<typeof _prev>>;
  });
  let updateId = 1;
  const send = async (update: Record<string, unknown>) => {
    calls.length = 0;
    await bot.handleUpdate({ update_id: updateId++, ...update } as unknown as Update);
    return calls.slice();
  };
  return {
    store,
    advance: (ms: number) => {
      nowMs += ms;
    },
    /** Сообщение в личку. */
    text: (from: number, text: string, username = `user${from}`) =>
      send({
        message: {
          message_id: 1,
          date: 0,
          chat: { id: from, type: "private", first_name: "Имя" },
          from: { id: from, is_bot: false, first_name: "Имя", username },
          text,
        },
      }),
    /** Нажатие инлайн-кнопки в личке. */
    press: (from: number, data: string) =>
      send({
        callback_query: {
          id: `cb${updateId}`,
          from: { id: from, is_bot: false, first_name: "Имя" },
          chat_instance: "x",
          data,
          message: { message_id: 5, date: 0, chat: { id: from, type: "private", first_name: "Имя" } },
        },
      }),
    raw: send,
  };
}

const texts = (calls: Call[]) =>
  calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").map((c) => String(c.payload.text));

const commandsSetFor = (calls: Call[], chatId: number) =>
  calls.find(
    (c) =>
      (c.method === "setMyCommands" || c.method === "deleteMyCommands") &&
      (c.payload.scope as { chat_id?: number } | undefined)?.chat_id === chatId,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATABOT_OWNER_IDS", String(OWNER));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Владелец создаёт приглашение в зону и возвращает токен. */
async function invite(t: ReturnType<typeof setup>, zone: "council" | "events" | "smm"): Promise<string> {
  await t.text(OWNER, "/start");
  await t.press(OWNER, `d:tm:inv:${zone}`);
  const tokens = [...t.store.invites.values()].filter((i) => i.zone === zone && !i.used_at);
  expect(tokens.length).toBeGreaterThan(0);
  return tokens[tokens.length - 1].token;
}

describe("чужой — одна фраза на любой апдейт", () => {
  it.each([
    ["сообщение", (t: ReturnType<typeof setup>) => t.text(ALICE, "сколько на субботу")],
    ["/start без приглашения", (t: ReturnType<typeof setup>) => t.text(ALICE, "/start")],
    ["/start с мусором", (t: ReturnType<typeof setup>) => t.text(ALICE, "/start inv_zzz")],
    ["кнопка", (t: ReturnType<typeof setup>) => t.press(ALICE, "d:tm:list")],
    ["команда раздела", (t: ReturnType<typeof setup>) => t.text(ALICE, "/team")],
  ])("%s → только фраза для чужих и снятая клавиатура", async (_name, act) => {
    const t = setup();
    const calls = await act(t);
    expect(texts(calls)).toEqual([STRANGER_TEXT]);
    const msg = calls.find((c) => c.method === "sendMessage")!;
    expect(msg.payload.reply_markup).toEqual({ remove_keyboard: true });
    expect(t.store.members.size).toBe(0);
    expect(t.store.audit.at(-1)).toMatchObject({ chat_id: ALICE, report: "no_member", zone: null });
  });
});

describe("лимит и авария", () => {
  it("сверх лимита — «Слишком часто», даже на /start, и до проверки членства", async () => {
    const t = setup();
    t.store.rateLimited.add(`databot:${ALICE}`);
    t.store.failNext("findActiveMember"); // не должно понадобиться
    expect(texts(await t.text(ALICE, "/start"))).toEqual([RATE_LIMIT_TEXT]);
    expect(t.store.audit.at(-1)).toMatchObject({ report: "rate_limited", ok: false });
  });

  it("база не ответила на проверку членства — авария, а не фраза для чужих", async () => {
    const t = setup();
    t.store.failNext("findActiveMember");
    expect(texts(await t.text(ALICE, "привет"))).toEqual([DB_DOWN_TEXT]);
    expect(t.store.audit.at(-1)).toMatchObject({ ok: false, error: "db_error" });
  });
});

describe("владелец из env", () => {
  it("первый /start без приглашения — совет, владелец, меню и команды", async () => {
    const t = setup();
    const calls = await t.text(OWNER, "/start");
    const row = t.store.members.get(OWNER)!;
    expect(row).toMatchObject({ zone: "council", is_owner: true, is_active: true });
    const cmds = commandsSetFor(calls, OWNER)!;
    expect(cmds.method).toBe("setMyCommands");
    expect((cmds.payload.commands as { command: string }[]).map((c) => c.command)).toEqual(["runs", "pro", "product", "kb", "team", "tasks", "help"]);
    const welcome = calls.find((c) => c.method === "sendMessage")!;
    expect(welcome.payload.reply_markup).toMatchObject({ is_persistent: true, resize_keyboard: true });
    expect(JSON.stringify(welcome.payload.reply_markup)).toContain("Команда");
  });

  it("владельца из env нельзя убрать даже прямым callback", async () => {
    const t = setup();
    await t.text(OWNER, "/start");
    expect(texts(await t.press(OWNER, `d:tm:rm:${OWNER}:ok`))).toEqual([OWNER_PROTECTED_TEXT]);
    expect(t.store.members.get(OWNER)!.is_active).toBe(true);
    expect(t.store.audit.at(-1)).toMatchObject({ report: "tm.remove", ok: false, error: "forbidden" });
  });
});

describe("приглашения", () => {
  it("срабатывает один раз: второй по той же ссылке получает «устарела» с именем пригласившего", async () => {
    const t = setup();
    const token = await invite(t, "events");

    const joinCalls = await t.text(ALICE, `/start inv_${token}`);
    expect(t.store.members.get(ALICE)).toMatchObject({ zone: "events", invited_by: OWNER, is_active: true });
    expect(commandsSetFor(joinCalls, ALICE)).toBeDefined();

    const second = await t.text(BOB, `/start inv_${token}`);
    expect(texts(second)).toHaveLength(1);
    expect(texts(second)[0]).toMatch(/^Ссылка устарела, попроси новую у /);
    expect(texts(second)[0]).toContain("Имя");
    expect(t.store.members.has(BOB)).toBe(false);
  });

  it("живёт 48 часов: за секунду до срока работает, через секунду после — нет", async () => {
    const early = setup();
    const t1 = await invite(early, "smm");
    early.advance(INVITE_TTL_MS - 1000);
    await early.text(ALICE, `/start inv_${t1}`);
    expect(early.store.members.get(ALICE)?.zone).toBe("smm");

    const late = setup();
    const t2 = await invite(late, "smm");
    late.advance(INVITE_TTL_MS + 1000);
    const calls = await late.text(ALICE, `/start inv_${t2}`);
    expect(texts(calls)[0]).toMatch(/^Ссылка устарела/);
    expect(late.store.members.has(ALICE)).toBe(false);
  });

  it("активный участник открыл чужую ссылку — токен не гасим, показываем меню", async () => {
    const t = setup();
    const first = await invite(t, "events");
    await t.text(ALICE, `/start inv_${first}`);
    const other = await invite(t, "smm");
    await t.text(ALICE, `/start inv_${other}`);
    expect(t.store.invites.get(other)!.used_at).toBeNull();
    expect(t.store.members.get(ALICE)!.zone).toBe("events");
  });

  it("убранный человек по новому приглашению возвращается с новой зоной", async () => {
    const t = setup();
    await t.text(ALICE, `/start inv_${await invite(t, "events")}`);
    await t.press(OWNER, `d:tm:rm:${ALICE}:ok`);
    expect(t.store.members.get(ALICE)!.is_active).toBe(false);
    await t.text(ALICE, `/start inv_${await invite(t, "council")}`);
    expect(t.store.members.get(ALICE)).toMatchObject({ zone: "council", is_active: true, removed_at: null });
  });
});

describe("смена зоны и удаление", () => {
  it("смена зоны сразу меняет доступ и меню команд, клавиатура — со следующим ответом", async () => {
    const t = setup();
    await t.text(ALICE, `/start inv_${await invite(t, "events")}`);

    // Ивентам «Команда» закрыта.
    expect(texts(await t.text(ALICE, "/team"))[0]).toMatch(/^Это видит совет/);

    const change = await t.press(OWNER, `d:tm:zone:${ALICE}:council`);
    const cmds = commandsSetFor(change, ALICE)!;
    expect((cmds.payload.commands as { command: string }[]).map((c) => c.command)).toContain("team");

    // Следующий же апдейт — уже с правами совета и свежей клавиатурой.
    const next = await t.text(ALICE, "/help");
    expect(JSON.stringify(next[0].payload.reply_markup)).toContain("Команда");
    const list = await t.text(ALICE, "/team");
    expect(texts(list)[0]).not.toMatch(/^Это видит/);
  });

  it("кнопка из старого экрана после смены зоны — «экран устарел»", async () => {
    const t = setup();
    await t.text(ALICE, `/start inv_${await invite(t, "council")}`);
    await t.press(OWNER, `d:tm:zone:${ALICE}:smm`);
    const calls = await t.press(ALICE, "d:tm:usage");
    expect(texts(calls)[0]).toBe(STALE_TEXT);
    expect(t.store.audit.at(-1)).toMatchObject({ report: "tm.usage", ok: false, error: "forbidden" });
  });

  it("убранный теряет доступ со следующего апдейта, форма стёрта, меню команд удалено", async () => {
    const t = setup();
    await t.text(ALICE, `/start inv_${await invite(t, "council")}`);
    t.store.sessions.set(`data:${ALICE}`, { step: "plan" });

    const removal = await t.press(OWNER, `d:tm:rm:${ALICE}:ok`);
    expect(t.store.members.get(ALICE)).toMatchObject({ is_active: false });
    expect(t.store.members.get(ALICE)!.removed_at).not.toBeNull();
    expect(t.store.sessions.has(`data:${ALICE}`)).toBe(false);
    expect(commandsSetFor(removal, ALICE)?.method).toBe("deleteMyCommands");

    expect(texts(await t.text(ALICE, "/team"))).toEqual([STRANGER_TEXT]);
  });

  it("не-владелец из совета не может звать людей: кнопка — устарела, состав виден", async () => {
    const t = setup();
    await t.text(ALICE, `/start inv_${await invite(t, "council")}`);
    expect(texts(await t.press(ALICE, "d:tm:inv:smm"))[0]).toBe(STALE_TEXT);
    expect([...t.store.invites.values()].filter((i) => i.created_by === ALICE)).toHaveLength(0);
    expect(texts(await t.text(ALICE, "/team"))[0]).not.toMatch(/^Это /);
  });
});

describe("разделы и разбор", () => {
  it("неготовый раздел из доступных — «ещё собираю»", async () => {
    const t = setup();
    await t.text(OWNER, "/start");
    expect(texts(await t.text(OWNER, "/social"))).toEqual([NOT_READY_TEXT]);
  });

  it("чужой раздел командой — отказ с доступными разделами", async () => {
    const t = setup();
    await t.text(ALICE, `/start inv_${await invite(t, "smm")}`);
    const [reply] = texts(await t.text(ALICE, "/pro"));
    expect(reply).toMatch(/^Это видит совет\./);
    expect(fetchPro).not.toHaveBeenCalled();
  });

  it("совет получает отчёты, смена периода сохраняется в аудите", async () => {
    const t = setup();
    await t.text(ALICE, `/start inv_${await invite(t, "council")}`);
    expect(texts(await t.text(ALICE, "/pro"))[0]).toContain("PRO сейчас: 3");
    expect(texts(await t.text(ALICE, "/product"))[0]).toContain("Регистрации за период: 4");
    const calls = await t.press(ALICE, "d:prd:summary:pw");
    expect(calls.some((c) => c.method === "editMessageText")).toBe(true);
    expect(fetchProduct).toHaveBeenLastCalledWith(new Date("2026-09-20T21:00:00Z"), new Date("2026-09-27T21:00:00Z"));
    expect(t.store.audit.at(-1)).toMatchObject({ report: "prd.summary", params: { period: "pw" }, ok: true });
  });

  it.each(["smm", "events"] as const)("%s не получает продуктовые данные через кнопку", async (zone) => {
    const t = setup();
    await t.text(ALICE, `/start inv_${await invite(t, zone)}`);
    await t.press(ALICE, "d:prd:summary:7d");
    expect(fetchProduct).not.toHaveBeenCalled();
    expect(t.store.audit.at(-1)?.ok).toBe(false);
  });

  it("ошибка данных — сообщение о сбое и неуспешный аудит", async () => {
    const t = setup();
    await t.text(OWNER, "/start");
    vi.mocked(fetchPro).mockRejectedValueOnce(new Error("database unavailable"));
    expect(texts(await t.text(OWNER, "/pro"))).toEqual([DB_DOWN_TEXT]);
    expect(t.store.audit.at(-1)).toMatchObject({ report: "pro.summary", ok: false });
  });

  it("вопрос текстом до Промта 14 — «не поняла» и меню; текст в журнале только тут", async () => {
    const t = setup();
    await t.text(OWNER, "/start");
    expect(texts(await t.text(OWNER, "сколько на субботу"))).toEqual([UNKNOWN_TEXT]);
    expect(t.store.audit.at(-1)).toMatchObject({ report: "unknown", source: "text", raw_text: "сколько на субботу" });
    await t.text(OWNER, "/help");
    expect(t.store.audit.at(-1)).toMatchObject({ report: "help", raw_text: null });
  });

  it("битые параметры кнопки — «экран устарел», а не ошибка", async () => {
    const t = setup();
    await t.text(OWNER, "/start");
    expect(texts(await t.press(OWNER, "d:tm:zone:abc:council"))[0]).toBe(STALE_TEXT);
    expect(texts(await t.press(OWNER, "d:tm:zone:1001:boss"))[0]).toBe(STALE_TEXT);
    expect(texts(await t.press(OWNER, "x:tm:list"))[0]).toBe(STALE_TEXT);
  });

  it("журнал — на каждый ответ, с latency_ms", async () => {
    const t = setup();
    await t.text(OWNER, "/start");
    await t.text(OWNER, "/team");
    await t.press(OWNER, "d:tm:usage");
    expect(t.store.audit.map((a) => a.report)).toEqual(["start", "tm.list", "tm.usage"]);
    for (const row of t.store.audit) expect(typeof row.latency_ms).toBe("number");
  });

  it("ник и имя обновляются при каждом сообщении", async () => {
    const t = setup();
    await t.text(OWNER, "/start", "old_nick");
    await t.text(OWNER, "/help", "new_nick");
    expect(t.store.members.get(OWNER)!.username).toBe("new_nick");
  });
});

describe("группы и каналы — выходим и молчим", () => {
  const group = { id: -2002, type: "group", title: "Команда" };
  const channel = { id: -1004004, type: "channel", title: "Канал" };
  const botMember = (chat: object, status: string) => ({
    my_chat_member: {
      chat,
      from: { id: OWNER, is_bot: false, first_name: "Имя" },
      date: 0,
      old_chat_member: { status: "left", user: BOT_INFO },
      new_chat_member: { status, user: BOT_INFO },
    },
  });

  it.each([
    ["группу", group, "member"],
    ["супергруппу админом", { id: -1003003, type: "supergroup", title: "Ч" }, "administrator"],
    ["канал", channel, "administrator"],
  ])("бота добавили в %s → leaveChat, больше ничего", async (_name, chat, status) => {
    const t = setup();
    const calls = await t.raw(botMember(chat, status));
    expect(calls).toEqual([{ method: "leaveChat", payload: { chat_id: (chat as { id: number }).id } }]);
  });

  it("апдейт о собственном выходе и блокировка в личке — ничего", async () => {
    const t = setup();
    expect(await t.raw(botMember(group, "left"))).toEqual([]);
    expect(await t.raw(botMember({ id: ALICE, type: "private", first_name: "И" }, "kicked"))).toEqual([]);
  });

  it("сообщение из группы — не отвечаем, выходим, в журнал не пишем", async () => {
    const t = setup();
    const calls = await t.raw({
      message: { message_id: 1, date: 0, chat: group, from: { id: OWNER, is_bot: false, first_name: "И" }, text: "/team" },
    });
    expect(calls.map((c) => c.method)).toEqual(["leaveChat"]);
    expect(t.store.audit).toHaveLength(0);
  });

  it("кнопка гасится answerCallbackQuery раньше всего остального", async () => {
    const t = setup();
    const calls = await t.press(ALICE, "d:tm:list");
    expect(calls[0].method).toBe("answerCallbackQuery");
  });
});
