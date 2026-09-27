import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageEntity, Update, UserFromGetMe } from "grammy/types";
import type { KbArticle } from "./data/kb";

/**
 * Справочник через настоящий конвейер. databot_kb — в памяти (подменён только
 * слой данных), поэтому видно, что правку сразу видят все: кеша нет.
 */

const kb = new Map<string, KbArticle>();
vi.mock("./data/kb", () => ({
  listKbArticles: async () => [...kb.values()].map((a) => ({ ...a })),
  getKbArticle: async (slug: string) => (kb.has(slug) ? { ...kb.get(slug)! } : null),
  insertKbArticle: async (a: Pick<KbArticle, "slug" | "title" | "body" | "zones">, by: number, now: Date) => {
    kb.set(a.slug, { ...a, aliases: [], sort: 100, updatedAt: now.toISOString(), updatedBy: by, prevBody: null });
  },
  writeKbBody: async (slug: string, expected: string, next: { body: string; prevBody: string | null }, by: number, now: Date) => {
    const a = kb.get(slug);
    if (!a || a.body !== expected) return false;
    kb.set(slug, { ...a, body: next.body, prevBody: next.prevBody, updatedBy: by, updatedAt: now.toISOString() });
    return true;
  },
  deleteKbArticle: async (slug: string) => kb.delete(slug),
}));
vi.mock("./data/links", () => ({
  fetchActiveLinkCodes: async () => [{ code: "IGST", label: "Instagram — сторис", channel: "instagram" }],
}));
vi.mock("../team/history", async (orig) => ({
  ...(await orig<typeof import("../team/history")>()),
  fetchArchive: async () => [],
}));

const { createDatabot } = await import("./bot");
const { KB_EDIT_ASK, KB_PREVIEW_INTRO, UNKNOWN_TEXT } = await import("./copy");
const { MemoryStore } = await import("./data/memory-store");

const BOT_INFO = { id: 999, is_bot: true, first_name: "Цифры (тест)", username: "test_databot" } as UserFromGetMe;
type Call = { method: string; payload: Record<string, unknown> };

const OWNER = 500;
const EVENTS = 2001;
const SMM = 2002;

function article(slug: string, title: string, zones: KbArticle["zones"], over: Partial<KbArticle> = {}): KbArticle {
  return {
    slug, title, body: `Текст «${title}»`, zones, aliases: [], sort: 100,
    updatedAt: "2026-09-27T09:00:00.000Z", updatedBy: OWNER, prevBody: null, ...over,
  };
}

function setup() {
  kb.clear();
  kb.set("stroka-tsifr", article("stroka-tsifr", "Строка цифр кофе-рана", ["council", "events", "smm"], { aliases: ["строка цифр"] }));
  kb.set("predlozheniya-sovet", article("predlozheniya-sovet", "Предложения: суммы", ["council"], { aliases: ["предложения"] }));
  kb.set("predlozheniya", article("predlozheniya", "Предложения", ["events", "smm"], { aliases: ["предложения"] }));
  kb.set("kto-za-chto", article("kto-za-chto", "Кто за что отвечает", ["council", "events", "smm"]));

  const store = new MemoryStore();
  let nowMs = Date.parse("2026-09-30T11:32:00Z");
  const clock = () => new Date(nowMs);
  store.clock = clock;
  const add = (chatId: number, zone: "council" | "events" | "smm", name: string, isOwner = false) =>
    store.members.set(chatId, {
      chat_id: chatId, username: `u${chatId}`, display_name: name, zone, is_owner: isOwner, invited_by: null,
      joined_at: "2026-09-01T00:00:00.000Z", last_seen_at: null, is_active: true, removed_at: null,
    });
  add(OWNER, "council", "Али", true);
  add(EVENTS, "events", "Маша-тест");
  add(SMM, "smm", "Вика-тест");

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
    text: (from: number, text: string, entities?: MessageEntity[]) =>
      run({ message: { message_id: 1, date: 0, chat: chat(from), from: { id: from, is_bot: false, first_name: "Имя" }, text, entities } }),
    press: (from: number, data: string) =>
      run({
        callback_query: {
          id: `cb${id}`, from: { id: from, is_bot: false, first_name: "Имя" }, chat_instance: "x", data,
          message: { message_id: 5, date: 0, chat: chat(from) },
        },
      }),
  };
}

const texts = (calls: Call[]) =>
  calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").map((c) => String(c.payload.text));
const all = (calls: Call[]) => texts(calls).join("\n---\n");
const buttons = (calls: Call[]) => JSON.stringify(calls.map((c) => c.payload.reply_markup ?? null));

beforeEach(() => {
  vi.stubEnv("DATABOT_OWNER_IDS", String(OWNER));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("список и статья", () => {
  it("список зоны: только её статьи и живые, по sort и заголовку", async () => {
    const t = setup();
    const events = buttons(await t.press(EVENTS, "d:kb:list"));
    expect(events).toContain("d:kb:art:predlozheniya\"");
    expect(events).not.toContain("predlozheniya-sovet");
    expect(events).toContain("d:kb:art:raspisanie-kofe-ranov");
    expect(events).toContain("d:kb:art:metki-i-ssylki");
    expect(events).toContain("d:kb:art:kto-v-bote");
    expect(events).not.toContain("d:kb:new");

    const council = buttons(await t.press(OWNER, "d:kb:list"));
    expect(council).toContain("predlozheniya-sovet");
    expect(council).toContain("d:kb:new");
  });

  it("статья с подписью «обновлено 27.09, Али»; автора нет — только дата", async () => {
    const t = setup();
    expect(all(await t.press(EVENTS, "d:kb:art:stroka-tsifr"))).toContain("<i>обновлено 27.09, Али</i>");
    kb.set("stroka-tsifr", { ...kb.get("stroka-tsifr")!, updatedBy: 123456 });
    expect(all(await t.press(EVENTS, "d:kb:art:stroka-tsifr"))).toContain("<i>обновлено 27.09</i>");
  });

  it("живые статьи собираются кодом: метки с короткими ссылками, кто в боте", async () => {
    const t = setup();
    expect(all(await t.press(SMM, "d:kb:art:metki-i-ssylki"))).toMatch(/<code>IGST<\/code> — Instagram — сторис\nhttps:\/\/\S+\/s\/IGST/);
    const who = all(await t.press(SMM, "d:kb:art:kto-v-bote"));
    expect(who).toContain("<b>Совет</b>\nАли @u500");
    expect(who).toContain("<b>Ивенты</b>\nМаша-тест @u2001");
  });
});

describe("статью только для совета не открыть ивентам и СММ", () => {
  it("прямым callback со slug — отказ, текста нет, в журнале ok = false", async () => {
    const t = setup();
    for (const who of [EVENTS, SMM]) {
      const calls = await t.press(who, "d:kb:art:predlozheniya-sovet");
      expect(all(calls)).not.toContain("Предложения: суммы");
      expect(all(calls)).toMatch(/^Это закрыто для твоей зоны/);
      expect(t.store.audit.at(-1)).toMatchObject({ report: "kb.article", ok: false, error: "forbidden" });
    }
  });

  it("поиском — только статья своей зоны", async () => {
    const t = setup();
    // У совета оба варианта «Предложений» — уточнение; у ивентов — одна своя.
    expect(texts(await t.text(OWNER, "предложения"))[0]).toBe("Уточни:");
    const events = await t.text(EVENTS, "предложения");
    expect(all(events)).toContain("<b>Предложения</b>");
    expect(all(events)).not.toContain("суммы");
    expect(t.store.audit.at(-1)).toMatchObject({ report: "kb.article", source: "text", params: { slug: "predlozheniya" } });
  });

  it("править статьи ивенты не могут даже прямым callback", async () => {
    const t = setup();
    await t.press(EVENTS, "d:kb:edit:stroka-tsifr");
    expect(await t.store.getForm(EVENTS)).toBeNull();
    expect(t.store.audit.at(-1)).toMatchObject({ report: "kb.edit", ok: false, error: "forbidden" });
  });
});

describe("поиск временным маршрутизатором", () => {
  it("одна статья — показать; ни одной — «Не поняла вопрос»", async () => {
    const t = setup();
    expect(all(await t.text(SMM, "где строка цифр?"))).toContain("<b>Строка цифр кофе-рана</b>");
    expect(texts(await t.text(SMM, "сколько на субботу"))).toEqual([UNKNOWN_TEXT]);
    expect(t.store.audit.at(-1)).toMatchObject({ report: "unknown", raw_text: "сколько на субботу" });
  });

  it("нормализация: регистр, «ё», пунктуация", async () => {
    const t = setup();
    expect(all(await t.text(SMM, "СТРОКА ЦИФР!!!"))).toContain("Строка цифр кофе-рана");
  });
});

describe("правка советом", () => {
  it("заменить текст → предпросмотр как увидят все, с экранированной разметкой → сохранить; сразу видят все", async () => {
    const t = setup();
    expect(texts(await t.press(OWNER, "d:kb:edit:stroka-tsifr"))).toEqual([KB_EDIT_ASK]);

    const preview = await t.text(OWNER, '<b>Новый</b> текст <u>подчёркнут</u> <a href="javascript:x">ссылка</a>');
    const [intro, body] = texts(preview);
    expect(intro).toBe(KB_PREVIEW_INTRO);
    expect(body).toBe("<b>Строка цифр кофе-рана</b>\n\n<b>Новый</b> текст &lt;u&gt;подчёркнут&lt;/u&gt; ссылка");
    // До «Сохранить» статья прежняя.
    expect(kb.get("stroka-tsifr")!.body).toBe("Текст «Строка цифр кофе-рана»");

    await t.press(OWNER, "d:kb:save");
    expect(kb.get("stroka-tsifr")).toMatchObject({
      body: "<b>Новый</b> текст &lt;u&gt;подчёркнут&lt;/u&gt; ссылка",
      prevBody: "Текст «Строка цифр кофе-рана»",
      updatedBy: OWNER,
    });
    expect(all(await t.press(SMM, "d:kb:art:stroka-tsifr"))).toContain("<b>Новый</b> текст");
  });

  it("форматирование Telegram (жирный) превращается в <b>", async () => {
    const t = setup();
    await t.press(OWNER, "d:kb:edit:stroka-tsifr");
    const preview = await t.text(OWNER, "важно всем", [{ type: "bold", offset: 0, length: 5 }]);
    expect(texts(preview)[1]).toContain("<b>важно</b> всем");
  });

  it("длиннее 3500 знаков — просим короче, форма открыта", async () => {
    const t = setup();
    await t.press(OWNER, "d:kb:edit:stroka-tsifr");
    expect(texts(await t.text(OWNER, "я".repeat(3501)))[0]).toMatch(/^Слишком длинно: 3501 знаков, можно до 3500/);
    expect(await t.store.getForm(OWNER)).not.toBeNull();
  });

  it("вернуть прошлую версию меняет местами, и возврат тоже откатывается", async () => {
    const t = setup();
    kb.set("stroka-tsifr", { ...kb.get("stroka-tsifr")!, body: "новый", prevBody: "старый" });
    const r1 = await t.press(OWNER, "d:kb:restore:stroka-tsifr");
    expect(kb.get("stroka-tsifr")).toMatchObject({ body: "старый", prevBody: "новый" });
    expect(all(r1)).toContain("Вернула прошлую версию");
    await t.press(OWNER, "d:kb:restore:stroka-tsifr");
    expect(kb.get("stroka-tsifr")).toMatchObject({ body: "новый", prevBody: "старый" });
  });

  it("новая статья: заголовок → текст → зоны → сохранить, slug транслитом, зоны соблюдаются", async () => {
    const t = setup();
    await t.press(OWNER, "d:kb:new");
    await t.text(OWNER, "Имена файлов");
    const zonesStep = await t.text(OWNER, "дата_что_версия");
    expect(all(zonesStep)).toContain("Кому видна статья?");
    // По умолчанию все три; убираем СММ.
    await t.press(OWNER, "d:kb:z:smm");
    await t.press(OWNER, "d:kb:zsave");
    expect(kb.get("imena-faylov")).toMatchObject({ title: "Имена файлов", body: "дата_что_версия", zones: ["council", "events"] });
    expect(all(await t.press(EVENTS, "d:kb:art:imena-faylov"))).toContain("дата_что_версия");
    expect(all(await t.press(SMM, "d:kb:art:imena-faylov"))).toMatch(/^Это закрыто для твоей зоны/);
  });

  it("занятый slug — с суффиксом -2", async () => {
    const t = setup();
    // «stroka-tsifr» уже занят статьёй из setup — новые получают -2 и -3.
    await t.press(OWNER, "d:kb:new");
    await t.text(OWNER, "Строка цифр");
    await t.text(OWNER, "текст");
    await t.press(OWNER, "d:kb:zsave");
    await t.press(OWNER, "d:kb:new");
    await t.text(OWNER, "Строка цифр");
    await t.text(OWNER, "ещё текст");
    await t.press(OWNER, "d:kb:zsave");
    expect([...kb.keys()].filter((k) => k.startsWith("stroka-tsifr")).sort()).toEqual(["stroka-tsifr", "stroka-tsifr-2", "stroka-tsifr-3"]);
  });

  it("удалить — с подтверждением", async () => {
    const t = setup();
    expect(all(await t.press(OWNER, "d:kb:del:stroka-tsifr"))).toContain("Удалить «Строка цифр кофе-рана»?");
    expect(kb.has("stroka-tsifr")).toBe(true);
    await t.press(OWNER, "d:kb:del:stroka-tsifr:ok");
    expect(kb.has("stroka-tsifr")).toBe(false);
  });

  it("живую статью не править и не удалить", async () => {
    const t = setup();
    await t.press(OWNER, "d:kb:edit:kto-v-bote");
    expect(await t.store.getForm(OWNER)).toBeNull();
  });

  it("форма правки живёт 10 минут: «Сохранить» после — «Форма устарела», текст прежний", async () => {
    const t = setup();
    await t.press(OWNER, "d:kb:edit:stroka-tsifr");
    await t.text(OWNER, "новый текст");
    t.advance(11 * 60 * 1000);
    expect(texts(await t.press(OWNER, "d:kb:save"))[0]).toBe("Форма устарела. Открой её заново кнопкой");
    expect(kb.get("stroka-tsifr")!.body).toBe("Текст «Строка цифр кофе-рана»");
  });
});

describe("после входа по приглашению", () => {
  it("бот показывает статью «Кто за что отвечает»", async () => {
    const t = setup();
    await t.text(OWNER, "/start");
    await t.press(OWNER, "d:tm:inv:smm");
    const token = [...t.store.invites.keys()][0];
    const calls = await t.text(3003, `/start inv_${token}`);
    expect(all(calls)).toContain("<b>Кто за что отвечает</b>");
  });
});
