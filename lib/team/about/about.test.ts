import { beforeEach, describe, expect, it } from "vitest";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { MemoryTeamForms } from "../form";
import { TEAM } from "../ai/test-harness";
import { DEFAULT_PROJECTS, RESCAN } from "../projects/projects";
import { RESCAN_ABOUT, RESCAN_QUESTIONS } from "../projects/rescan-about-seed";
import { handleAboutUpdate, type AboutDeps } from "./screen";
import { MemoryAboutStore } from "./store";

const NOW = new Date("2026-10-14T12:00:00+03:00");
const VIKA = 4;
const MASHA = 5;
const DIMA = 9;
const rescanTeam = TEAM.filter((m) => [VIKA, MASHA, 8, 9].includes(m.chat_id));

describe("сид «О проекте» RESCAN", () => {
  it("разделы и 7 вопросов; повторный запуск ничего не дублирует и не затирает правки", async () => {
    const store = new MemoryAboutStore();
    expect(await store.seed(RESCAN, RESCAN_ABOUT, RESCAN_QUESTIONS, NOW)).toBe(4 + 7);
    expect(await store.getSection(RESCAN, "rules")).toContain("Никакой интерпретации");
    expect(await store.getSection(RESCAN, "facts")).toContain("ориентиры, не проверены продажами");
    await store.setSection(RESCAN, "summary", "своё");
    expect(await store.seed(RESCAN, RESCAN_ABOUT, RESCAN_QUESTIONS, NOW)).toBe(0);
    expect(await store.getSection(RESCAN, "summary")).toBe("своё");
    expect(await store.questions(RESCAN)).toHaveLength(7);
  });
});

describe("экран «О проекте»", () => {
  let store: MemoryAboutStore;
  let calls: Array<{ method: string; text: string; buttons: string[] }>;
  let press: (data: string, from: number) => Promise<void>;
  let send: (text: string, from: number) => Promise<void>;
  let modules: readonly string[];

  beforeEach(async () => {
    store = new MemoryAboutStore();
    await store.seed(RESCAN, RESCAN_ABOUT, RESCAN_QUESTIONS, NOW);
    calls = [];
    modules = DEFAULT_PROJECTS[1].modules;
    const forms = new MemoryTeamForms();
    const deps = (): AboutDeps => ({
      about: store, forms, projectId: RESCAN, projectLabel: "🔬 RESCAN", modules,
      isAdmin: (id) => id === 8 || id === DIMA, listTeam: async () => rescanTeam,
    });
    const bot = new Bot("1:x", { botInfo: { id: 1, is_bot: true, first_name: "П", username: "t_bot" } as UserFromGetMe });
    bot.api.config.use(async (_prev, method, payload) => {
      const p = payload as { chat_id: number; text?: string; reply_markup?: { inline_keyboard?: Array<Array<{ text: string }>> } };
      calls.push({ method, text: String(p.text ?? ""), buttons: (p.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.text) });
      return { ok: true, result: { message_id: 1, date: 1, chat: { id: p.chat_id, type: "private" } } } as never;
    });
    bot.use((ctx) => handleAboutUpdate(ctx, deps(), NOW).then(() => {}));
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
  const texts = () => calls.filter((c) => c.method !== "answerCallbackQuery");

  it("/about — суть и четыре раздела; правка описания только у админа", async () => {
    await send("/about", MASHA);
    const home = texts().at(-1)!;
    expect(home.text).toContain("RESCAN");
    expect(home.text).toContain("Это логистика, а не медицина.");
    expect(home.buttons).toEqual(["🧭 Правила продукта", "❓ Открытые вопросы", "📎 Материалы", "📊 Ключевые цифры"]);
    await send("/about", DIMA);
    expect(texts().at(-1)!.buttons).toContain("✏️ Изменить описание");
  });

  it("правила продукта и цифры читаются кнопками", async () => {
    await press("pi:s:rules", MASHA);
    expect(texts().at(-1)!.text).toContain("Тест для новой фичи");
    expect(texts().at(-1)!.buttons).toEqual(["← О проекте"]);
    await press("pi:s:facts", MASHA);
    expect(texts().at(-1)!.text).toContain("300–500 ₽");
  });

  it("вопросы: список с тем, кто решает, и сроком; «Отвечено» у админа, ответ следующим сообщением", async () => {
    await press("pi:q", MASHA);
    const list = texts().at(-1)!.text;
    expect(list).toContain("1. Подтверждает ли юрист");
    expect(list).toContain("— Юрист · до первой реальной SMS");
    await press("pi:qi:1", MASHA);
    expect(texts().at(-1)!.buttons).toEqual(["← К вопросам"]);
    await press("pi:qa:1", MASHA);
    expect(texts().at(-1)!.text).toBe("Отвечает админ проекта или ответственный за вопрос.");

    await press("pi:qi:4", DIMA);
    expect(texts().at(-1)!.buttons).toContain("✅ Отвечено");
    await press("pi:qa:4", DIMA);
    await send("МИС Инфоклиника, вебхук есть", DIMA);
    const q = await store.question(4);
    expect(q).toMatchObject({ status: "answered", answer: "МИС Инфоклиника, вебхук есть", answered_by: DIMA });
    expect(texts().at(-1)!.text).toContain("✅ Какая МИС у пилотной клиники");
    expect(texts().at(-1)!.text).not.toMatch(/\d\. Какая МИС/);
  });

  it("ответственный из команды тоже может закрыть свой вопрос", async () => {
    store.qs[6].owner_chat_id = MASHA;
    await press("pi:qa:7", MASHA);
    await send("Берём Inter", MASHA);
    expect((await store.question(7))!.answer).toBe("Берём Inter");
  });

  it("правка раздела: новый текст → предпросмотр → «✅ Сохранить»; до сохранения раздел прежний", async () => {
    await press("pi:e:rules", MASHA);
    expect(texts().at(-1)!.text).toBe("Разделы меняют только админы проекта.");
    await press("pi:e:rules", DIMA);
    expect(texts().at(-1)!.text).toContain("Пришли новый текст раздела «🧭 Правила продукта»");
    await send("1. Ничего <не> интерпретируем.", DIMA);
    expect(texts().at(-1)!.text).toContain("Так будет выглядеть");
    expect(texts().at(-1)!.text).toContain("1. Ничего &lt;не&gt; интерпретируем.");
    expect(texts().at(-1)!.buttons).toEqual(["✅ Сохранить", "✖️ Отмена"]);
    expect(await store.getSection(RESCAN, "rules")).toContain("Тест для новой фичи");
    await press("pi:sv:rules", DIMA);
    expect(await store.getSection(RESCAN, "rules")).toBe("1. Ничего &lt;не&gt; интерпретируем.");
  });

  it("отмена правки ничего не меняет", async () => {
    await press("pi:e:facts", DIMA);
    await send("пусто", DIMA);
    await press("pi:x", DIMA);
    await press("pi:sv:facts", DIMA);
    expect(await store.getSection(RESCAN, "facts")).toContain("Пилот");
  });

  it("/link — админ добавляет материал, остальным отказ, без ссылки — формат", async () => {
    await send("/link Договор https://example.com/d", MASHA);
    expect(texts().at(-1)!.text).toBe("Материалы добавляют только админы проекта.");
    await send("/link Договор", DIMA);
    expect(texts().at(-1)!.text).toBe("Формат: /link Название https://ссылка");
    await send("/link Договор с клиникой https://example.com/d", DIMA);
    const links = (await store.getSection(RESCAN, "links"))!;
    expect(links).toContain("Техническая дорожная карта");
    expect(links.split("\n").at(-1)).toBe('• <a href="https://example.com/d">Договор с клиникой</a>');
  });

  it("в проекте без модуля «О проекте» команды не перехватываются", async () => {
    modules = DEFAULT_PROJECTS[0].modules;
    await send("/about", DIMA);
    await send("/link X https://x.ru", DIMA);
    expect(texts()).toHaveLength(0);
  });
});
