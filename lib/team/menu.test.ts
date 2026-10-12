import { beforeEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import type { TeamMember } from "./access";

// База — в памяти: проверяем меню, а не Supabase.
const roster = new Map<number, TeamMember>();
vi.mock("./access", () => ({
  findMember: async (id: number) => roster.get(id) ?? null,
  touchMember: async () => {},
  joinTeam: async (id: number) => ({ status: "already", member: roster.get(id) }),
  listTeam: async () => [...roster.values()],
  setDigestOptIn: async () => true,
  removeMember: async () => ({ status: "not_found" }),
  toggleDepartment: async () => [],
  applyRoster: async () => {},
  updateProfile: async () => {},
}));
vi.mock("../databot/data/supabase-store", async () => {
  const { MemoryStore } = await import("../databot/data/memory-store");
  const store = new MemoryStore();
  return { createSupabaseStore: () => store };
});
const shared = vi.hoisted(() => ({ forms: null as unknown, facts: null as unknown, events: null as unknown }));
vi.mock("./form", async (importOriginal) => {
  const real = await importOriginal<typeof import("./form")>();
  shared.forms = new real.MemoryTeamForms();
  return { ...real, supabaseTeamForms: () => shared.forms };
});
vi.mock("./attendance", async (importOriginal) => {
  const real = await importOriginal<typeof import("./attendance")>();
  shared.facts = new real.MemoryFactStore();
  return { ...real, supabaseFactStore: () => shared.facts };
});
vi.mock("./events", async (importOriginal) => {
  const real = await importOriginal<typeof import("./events")>();
  shared.events = new real.MemoryEventStore();
  return { ...real, supabaseEventStore: () => shared.events };
});
vi.mock("./history", async (importOriginal) => ({ ...(await importOriginal<typeof import("./history")>()), fetchArchive: async () => [] }));
vi.mock("./stats", async (importOriginal) => ({ ...(await importOriginal<typeof import("./stats")>()), fetchRunSignups: async () => [] }));

import { registerHandlers, resetMenuShown, TEAM_COMMANDS } from "./bot";
import { MENU } from "./copy";
import { openTeamForm, type MemoryTeamForms } from "./form";
import type { MemoryFactStore } from "./attendance";

const member = (chat_id: number, username: string): TeamMember => ({
  chat_id, username, display_name: username, role: "member", joined_at: "2026-10-01T00:00:00Z",
  added_by: null, last_seen_at: null, digest_opt_in: true,
});

describe("постоянное меню «Пятницы»", () => {
  let sent: Array<{ method: string; chat: number; text: string; markup: unknown }>;
  let send: (text: string, from?: number) => Promise<void>;

  beforeEach(() => {
    roster.clear();
    roster.set(1, member(1, "alice"));
    resetMenuShown();
    (shared.forms as MemoryTeamForms).forms.clear();
    (shared.facts as MemoryFactStore).facts.clear();
    sent = [];
    const bot = new Bot("1:x", { botInfo: { id: 1, is_bot: true, first_name: "Пятница", username: "t_bot" } as UserFromGetMe });
    bot.api.config.use(async (_prev, method, payload) => {
      const p = payload as { chat_id: number; text?: string; reply_markup?: unknown };
      if (method === "sendMessage" || method === "editMessageText") sent.push({ method, chat: p.chat_id, text: String(p.text), markup: p.reply_markup });
      return { ok: true, result: method === "sendMessage" ? { message_id: sent.length, date: 1, chat: { id: p.chat_id, type: "private" } } : true } as never;
    });
    registerHandlers(bot);
    let id = 0;
    send = async (text, from = 1) => {
      const entities = text.startsWith("/") ? [{ type: "bot_command" as const, offset: 0, length: text.split(" ")[0].length }] : undefined;
      await bot.handleUpdate({ update_id: ++id, message: { message_id: id, date: 1, text, entities,
        chat: { id: from, type: "private", first_name: "x" }, from: { id: from, is_bot: false, first_name: "x" } } } as Update);
    };
  });

  it("после /start видна клавиатура: пять кнопок, resize и is_persistent", async () => {
    await send("/start");
    const withKb = sent.find((s) => (s.markup as { keyboard?: unknown })?.keyboard)!;
    const kb = withKb.markup as { keyboard: Array<Array<{ text: string }>>; resize_keyboard: boolean; is_persistent: boolean };
    expect(kb.keyboard.map((row) => row.map((b) => b.text))).toEqual([
      [MENU.tasks, MENU.assign], [MENU.schedule, MENU.events], [MENU.team],
    ]);
    expect(kb.resize_keyboard).toBe(true);
    expect(kb.is_persistent).toBe(true);
  });

  it("каждая кнопка открывает свой раздел", async () => {
    const cases: Array<[string, RegExp]> = [
      [MENU.tasks, /Задачи · Мне/],
      [MENU.assign, /Пришли список задач/],
      [MENU.schedule, /Расписание/],
      [MENU.events, /Ивенты/],
      [MENU.team, /В команде 1 чел/],
    ];
    for (const [button, expected] of cases) {
      sent = [];
      await send(button);
      expect(sent.map((s) => s.text).join("\n"), button).toMatch(expected);
    }
  });

  it("клавиатура приходит с первым ответом тому, у кого её ещё не было, и только один раз", async () => {
    // «Поставить задачу» отвечает без inline-кнопок — к такому ответу клавиатура и цепляется.
    await send(MENU.assign);
    await send(MENU.assign);
    expect(sent.filter((s) => (s.markup as { keyboard?: unknown })?.keyboard)).toHaveLength(1);
  });

  it("кнопка посреди формы явки открывает раздел и не сохраняет текст кнопки как ответ", async () => {
    const forms = shared.forms as MemoryTeamForms;
    await forms.set(1, openTeamForm("attend", { key: "event:1", title: "Интервалы" }, new Date()));
    await send(MENU.schedule);
    expect(sent.map((s) => s.text).join("\n")).toMatch(/Расписание/);
    expect((shared.facts as MemoryFactStore).facts.size).toBe(0);
    expect(await forms.get(1)).toBeNull();
    // и следующее число уже не уходит в закрытую форму
    await send("17");
    expect((shared.facts as MemoryFactStore).facts.size).toBe(0);
  });

  it("меню слэш-команд — только /start и /help", () => {
    expect(TEAM_COMMANDS.map((c) => c.command)).toEqual(["start", "help"]);
  });
});
