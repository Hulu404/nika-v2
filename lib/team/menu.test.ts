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
  listProjectTeam: async () => [...roster.values()],
  markProfileEdited: async () => {},
  setCurrentProject: async (id: number, p: string) => void shared.current.push([id, p]),
  updateProfile: async () => {},
}));
vi.mock("./projects/members", async (importOriginal) => {
  const real = await importOriginal<typeof import("./projects/members")>();
  shared.memberships = new real.MemoryMembershipStore();
  return { ...real, supabaseMembershipStore: () => shared.memberships };
});
vi.mock("./projects/projects", async (importOriginal) => {
  const real = await importOriginal<typeof import("./projects/projects")>();
  return { ...real, supabaseProjectStore: () => new real.MemoryProjectStore() };
});
vi.mock("../databot/data/supabase-store", async () => {
  const { MemoryStore } = await import("../databot/data/memory-store");
  const store = new MemoryStore();
  return { createSupabaseStore: () => store };
});
const shared = vi.hoisted(() => ({ forms: null as unknown, facts: null as unknown, events: null as unknown, drafts: null as unknown, memberships: null as unknown, current: [] as Array<[number, string]> }));
vi.mock("./ai/stores", async (importOriginal) => {
  const real = await importOriginal<typeof import("./ai/stores")>();
  shared.drafts = new real.MemoryDraftStore();
  return { ...real, supabaseDraftStore: () => shared.drafts };
});
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
vi.mock("./ai/check", () => ({ defaultCheckDeps: () => ({}), aiCheckText: async () => "🔌 Проверка ИИ" }));
vi.mock("./history", async (importOriginal) => ({ ...(await importOriginal<typeof import("./history")>()), fetchArchive: async () => [] }));
vi.mock("./stats", async (importOriginal) => ({ ...(await importOriginal<typeof import("./stats")>()), fetchRunSignups: async () => [] }));

import { registerHandlers, resetMenuShown, TEAM_COMMANDS } from "./bot";
import { MENU } from "./copy";
import { openTeamForm, type MemoryTeamForms } from "./form";
import type { MemoryFactStore } from "./attendance";
import type { MemoryDraftStore } from "./ai/stores";
import type { MemoryMembershipStore } from "./projects/members";

const member = (chat_id: number, username: string): TeamMember => ({
  chat_id, username, display_name: username, role: "member", joined_at: "2026-10-01T00:00:00Z",
  added_by: null, last_seen_at: null, digest_opt_in: true,
});

describe("постоянное меню «Пятницы»", () => {
  let sent: Array<{ method: string; chat: number; text: string; markup: unknown }>;
  let send: (text: string, from?: number) => Promise<void>;
  let pressCb: (data: string, from?: number) => Promise<void>;

  beforeEach(() => {
    roster.clear();
    (shared.memberships as MemoryMembershipStore).rows = [];
    shared.current.length = 0;
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
    pressCb = async (data, from = 1) => {
      await bot.handleUpdate({ update_id: ++id, callback_query: { id: `c${id}`, chat_instance: "x", data, from: { id: from, is_bot: false, first_name: "x" },
        message: { message_id: 1, date: 1, text: "x", chat: { id: from, type: "private", first_name: "x" } } } } as Update);
    };
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

  it("кнопка меню посреди «✏️ Изменить» закрывает черновик", async () => {
    const forms = shared.forms as MemoryTeamForms;
    const drafts = shared.drafts as MemoryDraftStore;
    const draft = await drafts.create({ chat_id: 1, source_text: "x", intent: { parsed: { intent: "show_my_day" }, picks: {} } }, new Date());
    await drafts.setMessage(draft.id, 77);
    await forms.set(1, openTeamForm("ai.edit", { draft: String(draft.id) }, new Date()));
    await send(MENU.schedule);
    expect(await forms.get(1)).toBeNull();
    expect(drafts.drafts.size).toBe(0);
    expect(sent.find((s) => s.method === "editMessageText")?.text).toBe("Черновик закрыт.");
    expect(sent.map((s) => s.text).join("\n")).toMatch(/Расписание/);
  });

  it("/ai_check — только фаундерам и не в меню команд", async () => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "9");
    roster.set(9, member(9, "dima"));
    await send("/ai_check", 1);
    expect(sent.at(-1)!.text).toBe("Это команда фаундеров.");
    await send("/ai_check", 9);
    expect(sent.at(-1)!.text).toBe("🔌 Проверка ИИ");
    expect(TEAM_COMMANDS.map((c) => c.command)).not.toContain("ai_check");
    vi.unstubAllEnvs();
  });

  it("/project у человека в одном проекте — без списка и без упоминания других проектов", async () => {
    await send("/project");
    expect(sent.at(-1)!.text).toBe("Ты в проекте 🏃 NIKA.");
  });

  it("человек в двух проектах: «🔀 Проект» → выбор → «Переключила на 🔬 RESCAN» и клавиатура RESCAN", async () => {
    const ms = shared.memberships as MemoryMembershipStore;
    await ms.add({ project_id: "nika", chat_id: 1 }, new Date());
    await ms.add({ project_id: "rescan", chat_id: 1 }, new Date());
    await send("/start");
    const kb = sent.find((s) => (s.markup as { keyboard?: unknown })?.keyboard)!.markup as { keyboard: Array<Array<{ text: string }>> };
    expect(kb.keyboard[0].map((b) => b.text)).toEqual(["🔀 Проект: NIKA"]);
    sent = [];
    await send("🔀 Проект: NIKA");
    const list = sent.at(-1)!;
    expect(list.text).toBe("Выбери проект:");
    expect((list.markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }).inline_keyboard.flat().map((b) => b.text)).toEqual(["🏃 NIKA ✓", "🔬 RESCAN"]);
    await pressCb("pj:rescan");
    expect(shared.current).toEqual([[1, "rescan"]]);
    const done = sent.at(-1)!;
    expect(done.text).toBe("Переключила на 🔬 RESCAN");
    expect((done.markup as { keyboard: Array<Array<{ text: string }>> }).keyboard.map((r) => r.map((b) => b.text))).toEqual([
      ["🔀 Проект: RESCAN"], [MENU.tasks, MENU.assign], [MENU.roadmap, MENU.schedule], [MENU.about, MENU.team],
    ]);
  });

  it("меню слэш-команд — только /start и /help", () => {
    expect(TEAM_COMMANDS.map((c) => c.command)).toEqual(["start", "help"]);
  });
});
