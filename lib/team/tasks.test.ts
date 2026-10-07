import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bot, type Api } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { MemoryStore } from "../databot/data/memory-store";
import { handleTeamTaskUpdate, syncTeamTaskMembers, type TeamTaskDeps } from "./tasks";
import type { TeamMember } from "./access";
import { setTeamCommands, TEAM_COMMANDS } from "./bot";
import { MemoryTeamForms } from "./form";
import { tasksScreen } from "./copy";

const NOW = new Date("2026-10-01T09:00:00Z"); // чт 01.10, 12:00 МСК
const member = (chat_id: number, username: string, role: TeamMember["role"] = "member"): TeamMember => ({
  chat_id, username, display_name: username, role, joined_at: NOW.toISOString(),
  added_by: null, last_seen_at: null, digest_opt_in: true,
});
const people: TeamMember[] = [member(9, "owner", "owner"), member(1, "alice"), member(2, "bob"), member(3, "carol")];
const person = (id: number, username: string) => ({ id, is_bot: false, first_name: username, username });

let store: MemoryStore;
let forms: MemoryTeamForms;
let calls: Array<{ method: string; payload: Record<string, unknown> }>;
let send: (text: string, id?: number, username?: string, messageId?: number) => Promise<void>;
let press: (data: string, id?: number, username?: string) => Promise<void>;
let clock: Date;

const texts = (chat: number, method = "sendMessage") =>
  calls.filter((c) => c.method === method && c.payload.chat_id === chat).map((c) => String(c.payload.text));
const lastScreen = (chat: number) =>
  calls.filter((c) => (c.method === "sendMessage" || c.method === "editMessageText") && c.payload.chat_id === chat).at(-1)!;
const buttons = (call: { payload: Record<string, unknown> }) =>
  ((call.payload.reply_markup as { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> })?.inline_keyboard ?? []).flat();

beforeEach(() => {
  vi.stubEnv("DATABOT_OWNER_IDS", "");
  vi.stubEnv("TEAM_FOUNDER_IDS", "9");
  store = new MemoryStore();
  clock = NOW;
  store.clock = () => clock;
  forms = new MemoryTeamForms();
  calls = [];
  const deps: TeamTaskDeps = {
    store,
    forms,
    findMember: async (id) => people.find((m) => m.chat_id === id) ?? null,
    listTeam: async () => people,
  };
  const bot = new Bot("999:test", { botInfo: { id: 999, is_bot: true, first_name: "Пятница", username: "test_team_bot" } as UserFromGetMe });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: { message_id: 100 + calls.length } } as Awaited<ReturnType<typeof _prev>>;
  });
  bot.use((ctx) => handleTeamTaskUpdate(ctx, deps, clock).then(() => {}));
  let updateId = 0;
  send = async (text, id = 9, username = "owner", messageId = 10) => {
    await bot.handleUpdate({ update_id: ++updateId, message: { message_id: messageId, date: 100,
      chat: { id, type: "private", first_name: username }, from: person(id, username), text } } as Update);
  };
  press = async (data, id = 1, username = "alice") => {
    await bot.handleUpdate({ update_id: ++updateId, callback_query: { id: `cb${updateId}`, from: person(id, username),
      chat_instance: "test", data, message: { message_id: 500, date: 100, text: "x",
        chat: { id, type: "private", first_name: username } } } } as Update);
  };
});
afterEach(() => vi.unstubAllEnvs());

describe("Пятница: постановка задач", () => {
  it("исполнитель получает одно сообщение на /assign со всеми своими задачами", async () => {
    await send("/assign\nМакет / пт 18:00 / @alice + @bob\nТекст / 03.10 / @bob\nАфиша / завтра / @bob", 1, "alice", 10);
    expect(store.assignedTasks.size).toBe(4);
    const toBob = texts(2);
    expect(toBob).toHaveLength(1);
    expect(toBob[0]).toContain("Новые задачи: 3 от @alice");
    expect(toBob[0]).toContain("1. Макет · до пт 18:00 · вместе с @alice");
    expect(toBob[0]).toContain("2. Текст · до сб");
    expect(toBob[0]).toContain("3. Афиша");
    const bobCall = calls.find((c) => c.method === "sendMessage" && c.payload.chat_id === 2)!;
    expect(buttons(bobCall).map((b) => b.text)).toEqual(["Открыть мои задачи"]);
    // все три задачи Боба помечены доставленными одним сообщением
    const bobTasks = [...store.assignedTasks.values()].filter((t) => t.assignee_id === 2);
    expect(new Set(bobTasks.map((t) => t.delivered_message_id)).size).toBe(1);
    expect(texts(1).some((t) => t.includes("Сохранено задач: 4. Доставлено: 4."))).toBe(true);
  });

  it("повторная обработка того же сообщения не создаёт дублей и не шлёт второй раз", async () => {
    const list = "/assign\nМакет / пт 18:00 / @alice + @bob";
    await send(list);
    await send(list);
    expect(store.assignedTasks.size).toBe(2);
    expect(texts(2)).toHaveLength(1);
  });

  it("неизвестный ник отменяет весь список", async () => {
    await send("/assign\nМакет / завтра / @alice + @missing");
    expect(store.assignedTasks.size).toBe(0);
    expect(texts(9).at(-1)).toContain("Список не сохранён");
  });

  it("/assign без списка ждёт его следующим сообщением, /cancel отменяет", async () => {
    await send("/assign", 2, "bob", 20);
    await send("Сверстать афишу / завтра / @carol", 2, "bob", 21);
    expect(store.assignedTasks.size).toBe(1);
    await send("/assign", 2, "bob", 22);
    await send("/cancel", 2, "bob", 23);
    await send("Ещё одна / завтра / @carol", 2, "bob", 24);
    expect(store.assignedTasks.size).toBe(1);
    expect(texts(2)).toContain("Загрузка задач отменена.");
  });
});

describe("Пятница: видимость", () => {
  beforeEach(async () => {
    await send("/assign\nМакет / пт 18:00 / @alice + @bob\nТекст / 03.10 / @bob", 1, "alice", 10);
    await press("tk:s:done:2", 2, "bob"); // bob сделал свою часть «Макета»
  });

  it("чужая задача не видна ни в одном из трёх экранов, даже фаундеру", async () => {
    for (const viewer of [3, 9]) {
      const mine = await store.listMyAssigned(viewer);
      expect(mine).toEqual([]);
      for (const tab of ["me", "by", "done"] as const) {
        const screen = tasksScreen(tab, mine, viewer, new Map(), NOW);
        expect(screen.text).not.toContain("Макет");
        expect(screen.text).not.toContain("Текст");
      }
    }
    await send("/tasks", 3, "carol", 30);
    expect(texts(3).at(-1)).toContain("Открытых задач нет");
  });

  it("«Мне»: открытые задачи исполнителя, просроченные первыми, с автором", async () => {
    clock = new Date("2026-10-03T16:00:00Z"); // сб 19:00 МСК: «Текст» до 03.10 ещё не просрочен, «Макет» до пт 18:00 — да
    await send("/tasks", 2, "bob", 31);
    const screen = lastScreen(2);
    const text = String(screen.payload.text);
    expect(text).toContain("<b>Задачи · Мне</b> · 1");
    expect(text).toContain("1. Текст · до сб · от @alice");
    expect(text).not.toContain("Макет"); // своя часть сделана
    expect(buttons(screen).map((b) => b.text)).toEqual(["• Мне", "Я поставил", "Выполненные", "1. Текст"]);
  });

  it("«Я поставил»: совместная задача одной строкой со статусом и временем каждого", async () => {
    await press("tk:l:by:0", 1, "alice");
    const text = String(lastScreen(1).payload.text);
    expect(text).toContain("Макет · до пт 18:00 · @alice 🆕, @bob ✅ 01.10 12:00");
    expect(text).toContain("Текст · до сб · @bob 🆕");
    expect(lastScreen(1).method).toBe("editMessageText");
  });

  it("«Выполненные»: и у исполнителя, и у автора", async () => {
    await press("tk:l:done:0", 2, "bob");
    expect(String(lastScreen(2).payload.text)).toContain("✅ Макет · @bob · 01.10");
    await press("tk:l:done:0", 1, "alice");
    expect(String(lastScreen(1).payload.text)).toContain("✅ Макет · @bob · 01.10");
  });
});

describe("Пятница: права на задачу", () => {
  beforeEach(async () => {
    await send("/assign\nМакет / пт 18:00 / @bob", 1, "alice", 10);
  });

  it("статус отмечает исполнитель в карточке, автору приходит уведомление", async () => {
    await press("tk:o:1:me:0", 2, "bob");
    expect(buttons(lastScreen(2)).map((b) => b.text)).toEqual(["Взял в работу", "Сделано", "Не смогу", "← К списку"]);
    await press("tk:s:done:1", 2, "bob");
    expect(store.assignedTasks.get(1)?.status).toBe("done");
    expect(lastScreen(2).method).toBe("editMessageText");
    expect(texts(1).at(-1)).toContain("✅ @bob: сделано, «Макет»");
  });

  it("автор не может отметить статус за исполнителя", async () => {
    await press("tk:s:done:1", 1, "alice");
    expect(store.assignedTasks.get(1)?.status).toBe("open");
  });

  it("отменить и поменять срок может автор или фаундер, другой участник — нет", async () => {
    await send("/assign_cancel 1", 3, "carol", 40);
    await send("/assign_due 1 сб 18:00", 2, "bob", 41);
    await press("tk:x:1", 3, "carol");
    expect(store.assignedTasks.get(1)?.status).toBe("open");
    expect(store.assignedTasks.get(1)?.due_at).toBe("2026-10-02T15:00:00.000Z");

    await press("tk:x:1", 1, "alice");
    expect(String(lastScreen(1).payload.text)).toContain("Отменить задачу «Макет»?");
    await press("tk:X:1", 1, "alice");
    expect(store.assignedTasks.get(1)?.status).toBe("cancelled");
    expect(texts(2).at(-1)).toContain("✖️ Задача отменена: «Макет»");
  });

  it("автор меняет срок кнопкой: форма, сброс напоминаний, исполнитель предупреждён", async () => {
    store.assignedTasks.get(1)!.reminded_24_at = "2026-10-01T15:00:00Z";
    await press("tk:g:1:0", 1, "alice");
    expect(buttons(lastScreen(1)).map((b) => b.text)).toEqual(["Изменить срок", "Отменить", "← К списку"]);
    await press("tk:d:1", 1, "alice");
    await send("сб 12:00", 1, "alice", 42);
    const t = store.assignedTasks.get(1)!;
    expect(t.due_at).toBe("2026-10-03T09:00:00.000Z");
    expect(t.reminded_24_at).toBeNull();
    expect(texts(2).at(-1)).toContain("🗓 Новый срок задачи «Макет»: сб 12:00");
  });
});

describe("Пятница: роли и меню", () => {
  it("одно меню для фаундеров и участников, без старых команд задач", async () => {
    const setMyCommands = vi.fn().mockResolvedValue(true);
    const api = { setMyCommands } as unknown as Api;
    await setTeamCommands(api, people[0]);
    await setTeamCommands(api, people[1]);
    expect(setMyCommands).toHaveBeenNthCalledWith(1, TEAM_COMMANDS, { scope: { type: "chat", chat_id: 9 } });
    expect(setMyCommands).toHaveBeenNthCalledWith(2, TEAM_COMMANDS, { scope: { type: "chat", chat_id: 1 } });
    const names = TEAM_COMMANDS.map((c) => c.command);
    expect(names).toEqual(expect.arrayContaining(["assign", "tasks"]));
    expect(names).not.toContain("assigned");
    expect(names).not.toContain("assign_status");
    expect(names).not.toContain("assign_retry");
    for (const gone of ["today", "runs", "run", "who", "notif", "contacts", "history"]) expect(names).not.toContain(gone);
  });

  it("в databot_members.is_owner пишется признак фаундера, а не роль", async () => {
    const roster: TeamMember[] = [member(1, "alice", "owner"), member(9, "owner", "member")];
    await syncTeamTaskMembers({ store }, NOW, roster);
    expect(store.members.get(1)?.is_owner).toBe(false);
    expect(store.members.get(9)?.is_owner).toBe(true);
  });

  it("участник без особой роли ставит задачу себе и другим", async () => {
    await send("/assign\nСверстать афишу / завтра / @bob\nСебе напомнить / завтра / @carol", 3, "carol", 50);
    expect([...store.assignedTasks.values()].map((t) => [t.assigned_by, t.assignee_id])).toEqual([[3, 2], [3, 3]]);
  });
});

describe("Пятница: фаундеры видят и меняют все задачи", () => {
  beforeEach(async () => {
    // alice ставит bob, carol ставит себе; фаундер (9) ни при чём
    await send("/assign\nМакет / пт 18:00 / @bob", 1, "alice", 10);
    await send("/assign\nСвоё дело / сб 12:00 / @carol", 3, "carol", 11);
    await press("tk:s:done:2", 3, "carol");
  });

  it("участнику чужая задача не видна ни в одном экране, вкладки «Вся команда» нет", async () => {
    for (const data of ["tk:l:me:0", "tk:l:by:0", "tk:l:done:0", "tk:l:all:0"]) {
      await press(data, 2, "bob");
      expect(String(lastScreen(2).payload.text)).not.toContain("Своё дело");
    }
    expect(buttons(lastScreen(2)).map((b) => b.text)).not.toContain("Вся команда");
    await press("tk:o:2:me:0", 2, "bob");
    expect(texts(2).at(-1)).toBe("Задача не найдена.");
  });

  it("фаундеру видна вся команда по исполнителям и выполненное всех", async () => {
    await send("/tasks", 9, "owner", 20);
    expect(buttons(lastScreen(9)).map((b) => b.text)).toContain("Вся команда");
    await press("tk:l:all:0", 9, "owner");
    const all = String(lastScreen(9).payload.text);
    expect(all).toContain("<b>Задачи · Вся команда</b> · 1");
    expect(all).toContain("<b>@bob</b>\n1. Макет · до пт 18:00 · от @alice · 🆕");
    expect(all).not.toContain("Своё дело"); // уже сделано
    await press("tk:l:done:0", 9, "owner");
    expect(String(lastScreen(9).payload.text)).toContain("✅ Своё дело · @carol");
  });

  it("фаундер отменяет чужую задачу, автор и исполнитель узнают; участник не может", async () => {
    await press("tk:x:1", 3, "carol");
    expect(store.assignedTasks.get(1)?.status).toBe("open");
    await press("tk:o:1:all:0", 9, "owner");
    expect(buttons(lastScreen(9)).map((b) => b.text)).toEqual(["Изменить срок", "Отменить", "← К списку"]);
    await press("tk:x:1", 9, "owner");
    await press("tk:X:1", 9, "owner");
    expect(store.assignedTasks.get(1)?.status).toBe("cancelled");
    expect(texts(2).at(-1)).toContain("✖️ Задача отменена: «Макет»");
    expect(texts(1).at(-1)).toBe("✖️ Задача «Макет» для @bob отменена (фаундер @owner).");
  });

  it("фаундер меняет срок чужой задачи", async () => {
    await press("tk:d:1", 9, "owner");
    await send("сб 10:00", 9, "owner", 21);
    expect(store.assignedTasks.get(1)?.due_at).toBe("2026-10-03T07:00:00.000Z");
    expect(texts(1).at(-1)).toContain("новый срок: сб 10:00 (фаундер @owner)");
  });
});
