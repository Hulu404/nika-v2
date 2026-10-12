import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import type { TeamMember } from "./access";
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
    open = async (from) => {
      await bot.handleUpdate({ update_id: ++id, message: { message_id: id, date: 1, text: "/team", chat: chat(from), from: user(from) } } as Update);
    };
    press = async (data, from) => {
      await bot.handleUpdate({ update_id: ++id, callback_query: { id: `c${id}`, chat_instance: "x", data, from: user(from),
        message: { message_id: 5, date: 1, text: "x", chat: chat(from) } } } as Update);
    };
  });
  afterEach(() => vi.unstubAllEnvs());

  it("все видят отделы в списке; кнопки людей — только у фаундера", async () => {
    await open(6);
    expect(screens.at(-1)!.text).toContain("@vika · СММ");
    expect(screens.at(-1)!.buttons).toEqual([]);
    await open(9);
    expect(screens.at(-1)!.buttons).toEqual(["@founder", "@vika", "@danya"]);
  });

  it("фаундер включает и выключает отделы, человек может быть в нескольких", async () => {
    await press("dp:m:6", 9);
    expect(screens.at(-1)!.buttons).toEqual(["СММ", "Ивенты", "← К команде"]);
    await press("dp:t:6:events", 9);
    await press("dp:t:6:smm", 9);
    expect(team[2].departments).toEqual(["events", "smm"]);
    expect(screens.at(-1)!.buttons).toEqual(["✓ СММ", "✓ Ивенты", "← К команде"]);
    await press("dp:t:6:smm", 9);
    expect(team[2].departments).toEqual(["events"]);
  });

  it("участник менять отделы не может", async () => {
    await press("dp:t:6:smm", 5);
    expect(team[2].departments).toEqual([]);
    expect(screens.at(-1)!.text).toContain("только фаундеры");
  });
});
