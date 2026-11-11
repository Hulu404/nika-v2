import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import type { TrafficRow } from "../../databot/data/traffic";
import type { TeamMember } from "../access";
import { MemoryTeamForms } from "../form";
import { handleSocialSectionUpdate, trafficLines, type SocialSectionDeps } from "./section";
import { MemorySocialStore } from "./social-store";

const NOW = new Date("2026-10-07T12:00:00Z");
const member = (chat_id: number, username: string): TeamMember => ({
  chat_id, username, display_name: username, role: "member", joined_at: NOW.toISOString(), added_by: null,
  last_seen_at: null, digest_opt_in: true,
});
const team = [member(9, "founder"), member(5, "masha"), member(6, "lena"), member(7, "srbrkvss")];
const usernameOf = (id: number) => team.find((m) => m.chat_id === id)?.username;

describe("/social в «Пятнице»", () => {
  let store: MemorySocialStore;
  let forms: MemoryTeamForms;
  let traffic: TrafficRow[];
  let screens: Array<{ chat: number; text: string; buttons: string[] }>;
  let send: (text: string, from: number) => Promise<void>;
  let press: (data: string, from: number) => Promise<void>;

  beforeEach(() => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "9");
    vi.stubEnv("NIKA_TG_CHANNEL", "");
    store = new MemorySocialStore();
    forms = new MemoryTeamForms();
    traffic = [];
    screens = [];
    const deps: SocialSectionDeps = {
      store, forms, fetchTraffic: async () => traffic,
      findMember: async (id) => team.find((m) => m.chat_id === id) ?? null,
      listTeam: async () => team,
      tasks: async () => [],
    };
    const bot = new Bot("1:x", { botInfo: { id: 1, is_bot: true, first_name: "П", username: "t_bot" } as UserFromGetMe });
    bot.api.config.use(async (_prev, method, payload) => {
      const p = payload as { chat_id: number; text: string; reply_markup?: { inline_keyboard?: Array<Array<{ text: string }>> } };
      if (method === "sendMessage" || method === "editMessageText")
        screens.push({ chat: p.chat_id, text: p.text, buttons: (p.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.text) });
      return { ok: true, result: true } as never;
    });
    bot.use((ctx) => handleSocialSectionUpdate(ctx, deps, NOW).then(() => {}));
    let id = 0;
    const user = (from: number) => ({ id: from, is_bot: false, first_name: "x", username: usernameOf(from) });
    const chat = (from: number) => ({ id: from, type: "private" as const, first_name: "x" });
    send = async (text, from) => {
      await bot.handleUpdate({ update_id: ++id, message: { message_id: id, date: 1, text, chat: chat(from), from: user(from) } } as Update);
    };
    press = async (data, from) => {
      await bot.handleUpdate({ update_id: ++id, callback_query: { id: `c${id}`, chat_instance: "x", data, from: user(from),
        message: { message_id: 9, date: 1, text: "x", chat: chat(from) } } } as Update);
    };
  });
  afterEach(() => vi.unstubAllEnvs());

  it("@srbrkvss видит экран с динамикой и вносит Instagram сам", async () => {
    await send("/social", 7);
    const s = screens.at(-1)!;
    expect(s.text).toContain("TG-канал: снимков пока нет (не задан NIKA_TG_CHANNEL)");
    expect(s.text).toContain("Instagram: ещё ни разу не вносили");
    expect(s.text).not.toContain("Кто вносит Instagram");
    expect(s.text).toContain("Переходов по меткам за период нет");
    expect(s.buttons).toContain("Внести Instagram");
    expect(s.buttons).not.toContain("Сводка сейчас");
    await press("so:ig", 7);
    await send("3 870", 7);
    expect(store.snapshots).toMatchObject([{ platform: "instagram", followers: 3870, entered_by: 7 }]);
  });

  it("остальным — ни участникам, ни фаундеру — раздела нет и данные не видны", async () => {
    for (const id of [5, 9, 42]) {
      await send("/social", id);
      expect(screens.at(-1)!.text).toBe("В этом проекте такого раздела нет.");
    }
    const before = screens.length;
    await press("so:p:7d", 5);
    await press("so:ig", 9);
    expect(screens.length).toBe(before);
  });

  it("TEAM_SOCIAL_USERNAMES меняет, кому виден раздел", async () => {
    vi.stubEnv("TEAM_SOCIAL_USERNAMES", "masha");
    await send("/social", 5);
    expect(screens.at(-1)!.text).toContain("<b>Соцсети</b>");
    await send("/social", 7);
    expect(screens.at(-1)!.text).toBe("В этом проекте такого раздела нет.");
  });

  it("переходы по меткам: всего, по каналам и топ меток", () => {
    const lines = trafficLines([
      { code: "IGST-0310", label: "сторис", channel: "instagram", clicks: 50, visitors: 40, signupsCoffeerun: 6, signupsApp: 2 },
      { code: "TG-01", label: "", channel: "telegram", clicks: 10, visitors: 9, signupsCoffeerun: 1, signupsApp: 0 },
    ]);
    expect(lines[0]).toBe("Переходы по меткам: 60, уникальных 49");
    expect(lines).toContain("Instagram: 50 переходов, 6 заявок, 2 регистраций");
    expect(lines).toContain("Метка IGST-0310 (сторис): 50 переходов");
  });
});

describe("/social, когда база не готова", () => {
  it("экран открывается, а сломанные блоки говорят, в чём дело", async () => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "9");
    const missing = new Error("social_snapshots: Could not find the table 'public.social_snapshots' in the schema cache");
    const broken = {
      latest: async () => { throw missing; }, latestAtOrBefore: async () => { throw missing; },
      getSetting: async () => { throw new Error("team_settings: relation \"public.team_settings\" does not exist"); },
      setSetting: async () => {}, addSnapshot: async () => {}, claim: async () => true,
    };
    const deps: SocialSectionDeps = {
      store: broken, forms: new MemoryTeamForms(), fetchTraffic: async () => [],
      findMember: async (id) => team.find((m) => m.chat_id === id) ?? null, listTeam: async () => team, tasks: async () => [],
    };
    const texts: string[] = [];
    const bot = new Bot("1:x", { botInfo: { id: 1, is_bot: true, first_name: "П", username: "t_bot" } as UserFromGetMe });
    bot.api.config.use(async (_prev, method, payload) => {
      if (method === "sendMessage") texts.push(String((payload as { text: string }).text));
      return { ok: true, result: true } as never;
    });
    bot.use((ctx) => handleSocialSectionUpdate(ctx, deps, NOW).then(() => {}));
    await bot.handleUpdate({ update_id: 1, message: { message_id: 1, date: 1, text: "/social",
      chat: { id: 7, type: "private", first_name: "x" }, from: { id: 7, is_bot: false, first_name: "x", username: "srbrkvss" } } } as Update);
    expect(texts[0]).toContain("TG-канал: нет таблицы social_snapshots: примени миграцию 049_social_snapshots.sql в Supabase");
    expect(texts[0]).toContain("Переходов по меткам за период нет");
    vi.unstubAllEnvs();
  });
});
