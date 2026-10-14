import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import type { TeamMember } from "./access";
import { MemoryTeamForms } from "./form";
import type { ProfilePatch } from "./roster";
import { handleTeamScreenUpdate, showTeam, type TeamScreenDeps } from "./team-screen";

const member = (chat_id: number, username: string, departments: string[] = []): TeamMember => ({
  chat_id, username, display_name: username, role: "member", joined_at: "2026-10-01T00:00:00Z",
  added_by: null, last_seen_at: null, digest_opt_in: true, departments,
});

describe("«👥 Команда»: отделы", () => {
  let team: TeamMember[];
  let screens: Array<{ text: string; buttons: string[] }>;
  let deps: TeamScreenDeps;
  let press: (data: string, from: number) => Promise<void>;
  let open: (from: number) => Promise<void>;
  let send: (text: string, from: number) => Promise<void>;

  beforeEach(() => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "9");
    team = [member(9, "founder"), member(5, "vika", ["smm"]), member(6, "danya")];
    screens = [];
    deps = {
      findMember: async (id) => team.find((m) => m.chat_id === id) ?? null,
      listTeam: async () => team,
      toggleDepartment: async (id, d) => {
        const m = team.find((x) => x.chat_id === id)!;
        m.departments = m.departments!.includes(d) ? m.departments!.filter((x) => x !== d) : [...m.departments!, d];
        return m.departments;
      },
      updateProfile: async (id, patch: ProfilePatch) => {
        Object.assign(team.find((x) => x.chat_id === id)!, patch, { profile_edited_at: "now" });
      },
      forms: new MemoryTeamForms(),
    };
    const bot = new Bot("1:x", { botInfo: { id: 1, is_bot: true, first_name: "П", username: "t_bot" } as UserFromGetMe });
    bot.api.config.use(async (_prev, method, payload) => {
      const p = payload as { text: string; reply_markup?: { inline_keyboard?: Array<Array<{ text: string }>> } };
      if (method === "sendMessage" || method === "editMessageText")
        screens.push({ text: p.text, buttons: (p.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.text) });
      return { ok: true, result: true } as never;
    });
    bot.use(async (ctx, next) => {
      if (ctx.message?.text === "/team") return showTeam(ctx, deps, ctx.from!.id, false);
      if (!(await handleTeamScreenUpdate(ctx, deps))) await next();
    });
    let id = 0;
    const user = (from: number) => ({ id: from, is_bot: false, first_name: "x" });
    const chat = (from: number) => ({ id: from, type: "private" as const, first_name: "x" });
    send = async (text, from) => {
      await bot.handleUpdate({ update_id: ++id, message: { message_id: id, date: 1, text, chat: chat(from), from: user(from) } } as Update);
    };
    open = async (from) => {
      await bot.handleUpdate({ update_id: ++id, message: { message_id: id, date: 1, text: "/team", chat: chat(from), from: user(from) } } as Update);
    };
    press = async (data, from) => {
      await bot.handleUpdate({ update_id: ++id, callback_query: { id: `c${id}`, chat_instance: "x", data, from: user(from),
        message: { message_id: 5, date: 1, text: "x", chat: chat(from) } } } as Update);
    };
  });
  afterEach(() => vi.unstubAllEnvs());

  it("все видят отделы в списке; кнопки людей — только у фаундера, у участника — свои варианты имени", async () => {
    await open(6);
    expect(screens.at(-1)!.text).toContain("@vika · СММ");
    expect(screens.at(-1)!.buttons).toEqual(["Мои варианты имени"]);
    await open(9);
    expect(screens.at(-1)!.buttons).toEqual(["founder @founder", "vika @vika", "danya @danya"]);
  });

  it("строка участника: имя (должность) @ник", async () => {
    Object.assign(team[1], { first_name: "Вика", title: "SMM" });
    await open(6);
    expect(screens.at(-1)!.text).toContain("• Вика (SMM) @vika · СММ");
  });

  it("фаундер меняет имя, должность и варианты имени любого участника", async () => {
    await press("dp:m:6", 9);
    expect(screens.at(-1)!.buttons).toEqual(["СММ", "Ивенты", "Дизайн", "Разработка", "Имя", "Должность", "Варианты имени", "← К команде"]);
    await press("dp:e:6:name", 9);
    await send("Даня", 9);
    await press("dp:e:6:title", 9);
    await send("Ивент-отдел", 9);
    await press("dp:e:6:aliases", 9);
    await send("Данила, Даниил", 9);
    expect(team[2]).toMatchObject({ first_name: "Даня", title: "Ивент-отдел", name_aliases: ["Данила", "Даниил"], profile_edited_at: "now" });
    expect(screens.at(-1)!.text).toContain("Варианты имени: Данила, Даниил");
  });

  it("участник меняет только свои варианты имени", async () => {
    await press("dp:m:6", 6);
    expect(screens.at(-1)!.buttons).toEqual(["Варианты имени", "← К команде"]);
    await press("dp:e:6:aliases", 6);
    await send("Данила", 6);
    expect(team[2].name_aliases).toEqual(["Данила"]);
    await press("dp:e:6:name", 6);
    expect(screens.at(-1)!.text).toContain("Имя и должность меняют админы проекта");
    await press("dp:e:5:aliases", 6);
    await press("dp:m:5", 6);
    expect(screens.at(-1)!.text).toContain("Чужой профиль меняют только админы проекта");
    expect(team[1].name_aliases).toBeUndefined();
  });

  it("фаундер включает и выключает отделы, человек может быть в нескольких", async () => {
    await press("dp:m:6", 9);
    expect(screens.at(-1)!.buttons.slice(0, 2)).toEqual(["СММ", "Ивенты"]);
    await press("dp:t:6:events", 9);
    await press("dp:t:6:smm", 9);
    expect(team[2].departments).toEqual(["events", "smm"]);
    expect(screens.at(-1)!.buttons.slice(0, 2)).toEqual(["✓ СММ", "✓ Ивенты"]);
    await press("dp:t:6:smm", 9);
    expect(team[2].departments).toEqual(["events"]);
  });

  it("участник менять отделы не может", async () => {
    await press("dp:t:6:smm", 5);
    expect(team[2].departments).toEqual([]);
    expect(screens.at(-1)!.text).toContain("только админы проекта");
  });

  describe("состав проекта", () => {
    let roles: Map<number, "admin" | "member">;
    let outsiders: TeamMember[];
    let notified: Array<[number, string]>;
    beforeEach(() => {
      roles = new Map([[5, "member"], [6, "member"]]);
      outsiders = [member(20, "newbie")];
      notified = [];
      Object.assign(deps, {
        projectName: "🔬 RESCAN",
        roleOf: async (id: number) => roles.get(id) ?? null,
        outsiders: async () => outsiders,
        addMember: async (id: number) => {
          const p = outsiders.find((m) => m.chat_id === id)!;
          outsiders = outsiders.filter((m) => m.chat_id !== id);
          team.push(p);
          roles.set(id, "member");
          return true;
        },
        setRole: async (id: number, role: "admin" | "member") => void roles.set(id, role),
        removeMember: async (id: number) => {
          team = team.filter((m) => m.chat_id !== id);
          return roles.delete(id);
        },
        createInvite: async () => "tok123",
      });
    });

    it("админ: «➕ Добавить в проект» → человек из писавших боту → он в проекте", async () => {
      await open(9);
      expect(screens.at(-1)!.buttons).toContain("➕ Добавить в проект");
      await press("dp:add", 9);
      expect(screens.at(-1)!.buttons).toEqual(["newbie @newbie", "🔗 Ссылка-приглашение", "← К команде"]);
      await press("dp:ap:20", 9);
      expect(team.some((m) => m.chat_id === 20)).toBe(true);
      expect(screens.some((s) => s.text.startsWith("Тебя добавили в проект 🔬 RESCAN"))).toBe(true);
    });

    it("ссылка-приглашение — t.me/<бот>?start=join_<токен>", async () => {
      await press("dp:inv", 9);
      expect(screens.at(-1)!.text).toContain("https://t.me/t_bot?start=join_tok123");
    });

    it("роль: «Сделать админом» и обратно; убрать из проекта — с подтверждением; фаундера — нельзя", async () => {
      await press("dp:m:6", 9);
      expect(screens.at(-1)!.text).toContain("Роль в проекте: участник");
      await press("dp:r:6", 9);
      expect(roles.get(6)).toBe("admin");
      expect(screens.at(-1)!.buttons).toContain("Сделать участником");
      await press("dp:rm:6", 9);
      expect(screens.at(-1)!.text).toContain("Задачи останутся");
      await press("dp:RM:6", 9);
      expect(team.some((m) => m.chat_id === 6)).toBe(false);
      await press("dp:RM:9", 9);
      expect(screens.at(-1)!.text).toContain("Фаундер — админ во всех проектах");
    });

    it("участник состав не меняет", async () => {
      await press("dp:add", 5);
      expect(screens.at(-1)!.text).toBe("Состав проекта меняют только админы.");
      await press("dp:ap:20", 5);
      expect(team.some((m) => m.chat_id === 20)).toBe(false);
    });
  });
});
