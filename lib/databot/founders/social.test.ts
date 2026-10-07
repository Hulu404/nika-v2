import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Update, UserFromGetMe } from "grammy/types";
import { Bot } from "grammy";
import { INSTAGRAM_OWNER_SETTING } from "./constants";
import { MemorySocialStore } from "./social-store";
import {
  MemorySocialForms,
  dispatchSocialDaily,
  handleSocialUpdate,
  isSuspiciousJump,
  parseFollowers,
  snapshotTelegram,
  type SocialDeps,
} from "./social";

const msk = (local: string) => new Date(`${local}+03:00`);

describe("разбор числа подписчиков", () => {
  it("«3 870», «3870», «3.870», «3,870» — одно и то же", () => {
    for (const s of ["3 870", "3870", "3.870", "3,870", " 3 870 "]) expect(parseFollowers(s)).toBe(3870);
    expect(parseFollowers("1.240.500")).toBe(1240500);
  });
  it("дробное и мусор не принимает", () => {
    for (const s of ["3.87", "3,8", "38 70", "-5", "много", "", "3870 подписчиков"]) expect(parseFollowers(s)).toBeNull();
  });
});

describe("проверка на 20%", () => {
  it("переспрашивает, если число отличается больше чем на 20%", () => {
    expect(isSuspiciousJump(3870, 38700)).toBe(true);
    expect(isSuspiciousJump(3870, 3000)).toBe(true);
    expect(isSuspiciousJump(3870, 4644)).toBe(false); // ровно +20%
    expect(isSuspiciousJump(3870, 3900)).toBe(false);
    expect(isSuspiciousJump(null, 38700)).toBe(false); // первый снимок
  });
});

describe("21:00: снимок канала и вопрос про Instagram", () => {
  let store: MemorySocialStore;
  let forms: MemorySocialForms;
  let sent: Array<{ chat: number; text: string }>;
  const deps = (): SocialDeps => ({
    store, forms, founders: () => [9, 10],
    send: async (chat, text) => sent.push({ chat, text }),
    memberCount: async () => 1240,
  });
  beforeEach(() => {
    vi.stubEnv("NIKA_TG_CHANNEL", "@nika_channel");
    store = new MemorySocialStore();
    forms = new MemorySocialForms();
    sent = [];
  });
  afterEach(() => vi.unstubAllEnvs());

  it("до 21:00 ничего, в 21:00 снимок канала и вопрос фаундерам, пока ответственного нет", async () => {
    expect(await dispatchSocialDaily(deps(), msk("2026-10-07T20:45"))).toEqual([]);
    expect(await dispatchSocialDaily(deps(), msk("2026-10-07T21:00"))).toEqual(["tg_snapshot", "ig_ask"]);
    expect(store.snapshots).toMatchObject([{ platform: "telegram", followers: 1240, source: "auto" }]);
    expect(sent.map((s) => s.chat)).toEqual([9, 10]);
    expect(sent[0].text).toContain("Сколько сейчас подписчиков в Instagram?");
    expect(await forms.get(9)).not.toBeNull();
  });

  it("не спрашивает дважды за день", async () => {
    await dispatchSocialDaily(deps(), msk("2026-10-07T21:00"));
    await dispatchSocialDaily(deps(), msk("2026-10-07T21:15"));
    await dispatchSocialDaily(deps(), msk("2026-10-07T23:45"));
    expect(sent).toHaveLength(2);
    expect(store.snapshots).toHaveLength(1);
    await dispatchSocialDaily(deps(), msk("2026-10-08T21:00"));
    expect(sent).toHaveLength(4);
  });

  it("не спрашивает, если число за сегодня уже внесено; ответственному — только ему", async () => {
    await store.addSnapshot({ platform: "instagram", followers: 3870, source: "manual", entered_by: 9 }, msk("2026-10-07T12:00"));
    await dispatchSocialDaily(deps(), msk("2026-10-07T21:00"));
    expect(sent).toEqual([]);
    store.settings.set(INSTAGRAM_OWNER_SETTING, "5");
    await dispatchSocialDaily(deps(), msk("2026-10-08T21:00"));
    expect(sent.map((s) => s.chat)).toEqual([5]);
  });

  it("ошибка Telegram не роняет снимок: null вместо числа", async () => {
    const res = await snapshotTelegram({ store, memberCount: async () => { throw new Error("Bad Request: chat not found"); } }, msk("2026-10-07T21:00"));
    expect(res).toBeNull();
    expect(store.snapshots).toEqual([]);
  });
});

describe("ответ про Instagram", () => {
  let store: MemorySocialStore;
  let replies: string[];
  let send: (text: string, from?: number) => Promise<void>;
  let press: (data: string, from?: number) => Promise<void>;
  const NOW = msk("2026-10-07T21:05");

  beforeEach(async () => {
    store = new MemorySocialStore();
    replies = [];
    const forms = new MemorySocialForms();
    const deps: SocialDeps = { store, forms, founders: () => [9], send: async () => {}, memberCount: async () => 0 };
    store.settings.set(INSTAGRAM_OWNER_SETTING, "5");
    await store.addSnapshot({ platform: "instagram", followers: 3870, source: "manual", entered_by: 5 }, msk("2026-10-06T21:10"));
    const bot = new Bot("1:x", { botInfo: { id: 1, is_bot: true, first_name: "Ц", username: "d_bot" } as UserFromGetMe });
    bot.api.config.use(async (_prev, method, payload) => {
      if (method === "sendMessage") replies.push(String((payload as { text: string }).text));
      return { ok: true, result: true } as never;
    });
    bot.use(async (ctx, next) => { if (!(await handleSocialUpdate(ctx, deps, NOW))) await next(); });
    let id = 0;
    const user = (from: number) => ({ id: from, is_bot: false, first_name: "x" });
    const chat = (from: number) => ({ id: from, type: "private" as const, first_name: "x" });
    send = async (text, from = 5) => {
      await bot.handleUpdate({ update_id: ++id, message: { message_id: id, date: 1, text, chat: chat(from), from: user(from) } } as Update);
    };
    press = async (data, from = 5) => {
      await bot.handleUpdate({ update_id: ++id, callback_query: { id: `c${id}`, chat_instance: "x", data, from: user(from),
        message: { message_id: 9, date: 1, text: "x", chat: chat(from) } } } as Update);
    };
  });

  it("«Внести» → число → запись; опечатка в 10 раз — переспрос «Да» / «Исправить»", async () => {
    await press("so:ig");
    await send("38 700");
    expect(replies.at(-1)).toBe("Было 3 870, ты вводишь 38 700. Верно?");
    expect(store.snapshots).toHaveLength(1);
    await press("so:fix");
    await send("3 895");
    expect(replies.at(-1)).toBe("Записала: Instagram 3 895.");
    expect(store.snapshots.at(-1)).toMatchObject({ platform: "instagram", followers: 3895, source: "manual", entered_by: 5 });
  });

  it("«Да» сохраняет большое число; посторонний внести не может", async () => {
    await press("so:yes:38700");
    expect(store.snapshots.at(-1)?.followers).toBe(38700);
    await press("so:ig", 7);
    expect(replies.at(-1)).toContain("фаундеры и назначенный ответственный");
  });

  it("не число — просит целое и ждёт дальше", async () => {
    await press("so:ig");
    await send("около четырёх тысяч");
    expect(replies.at(-1)).toContain("Нужно целое число");
    await send("3.900");
    expect(store.snapshots.at(-1)?.followers).toBe(3900);
  });
});
