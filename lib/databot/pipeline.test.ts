import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Update, UserFromGetMe } from "grammy/types";
import { createDatabot } from "./bot";
import { STRANGER_TEXT } from "./copy";

/**
 * Конвейер на настоящем grammY: вызовы Bot API перехватываются
 * трансформером, в сеть ничего не уходит.
 */

// Только нужные боту поля: остальные флаги getMe от версии к версии grammY
// прибавляются, а конвейер их не читает.
const BOT_INFO = {
  id: 999,
  is_bot: true,
  first_name: "Цифры (тест)",
  username: "test_databot",
} as UserFromGetMe;

type Call = { method: string; payload: Record<string, unknown> };

function makeBot() {
  const calls: Call[] = [];
  const bot = createDatabot("999:test-token", { botInfo: BOT_INFO });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ok: true, result: true } as any;
  });
  return { bot, calls, methods: () => calls.map((c) => c.method) };
}

const person = { id: 1001, is_bot: false, first_name: "Тест" };
const privateChat = { id: 1001, type: "private" as const, first_name: "Тест" };
const group = { id: -2002, type: "group" as const, title: "Команда" };
const supergroup = { id: -1003003, type: "supergroup" as const, title: "Команда" };
const channel = { id: -1004004, type: "channel" as const, title: "Канал" };

function message(chat: object, text = "сколько на субботу"): Update {
  return { update_id: 1, message: { message_id: 1, date: 0, chat, from: person, text } } as Update;
}

function memberUpdate(chat: object, status: string): Update {
  return {
    update_id: 2,
    my_chat_member: {
      chat,
      from: person,
      date: 0,
      old_chat_member: { status: "left", user: BOT_INFO },
      new_chat_member: { status, user: BOT_INFO },
    },
  } as unknown as Update;
}

function callback(chat: object): Update {
  return {
    update_id: 3,
    callback_query: {
      id: "cb1",
      from: person,
      chat_instance: "x",
      data: "d:run:section",
      message: { message_id: 5, date: 0, chat },
    },
  } as unknown as Update;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("личка — пока каждый чужой", () => {
  it("на любое сообщение — одна фраза для чужих", async () => {
    const { bot, calls, methods } = makeBot();
    await bot.handleUpdate(message(privateChat));
    expect(methods()).toEqual(["sendMessage"]);
    expect(calls[0].payload).toMatchObject({ chat_id: 1001, text: STRANGER_TEXT });
  });

  it("на /start — та же фраза", async () => {
    const { bot, calls } = makeBot();
    await bot.handleUpdate(message(privateChat, "/start"));
    expect(calls.map((c) => c.payload.text)).toEqual([STRANGER_TEXT]);
  });

  it("кнопка гасится answerCallbackQuery до ответа", async () => {
    const { bot, methods } = makeBot();
    await bot.handleUpdate(callback(privateChat));
    expect(methods()).toEqual(["answerCallbackQuery", "sendMessage"]);
  });

  it("человек заблокировал бота — без ответа", async () => {
    const { bot, calls } = makeBot();
    await bot.handleUpdate(memberUpdate(privateChat, "kicked"));
    expect(calls).toEqual([]);
  });
});

describe("группы и каналы — выходим и молчим", () => {
  it.each([
    ["группу", group, "member"],
    ["супергруппу", supergroup, "member"],
    ["супергруппу админом", supergroup, "administrator"],
    ["канал", channel, "administrator"],
  ])("бота добавили в %s → leaveChat, больше ничего", async (_name, chat, status) => {
    const { bot, calls } = makeBot();
    await bot.handleUpdate(memberUpdate(chat, status));
    expect(calls).toEqual([{ method: "leaveChat", payload: { chat_id: (chat as { id: number }).id } }]);
  });

  it("апдейт о собственном выходе — ничего", async () => {
    const { bot, calls } = makeBot();
    await bot.handleUpdate(memberUpdate(group, "left"));
    expect(calls).toEqual([]);
  });

  it.each([["группы", group], ["супергруппы", supergroup]])(
    "сообщение из %s — не отвечаем, выходим",
    async (_name, chat) => {
      const { bot, methods } = makeBot();
      await bot.handleUpdate(message(chat));
      expect(methods()).toEqual(["leaveChat"]);
    },
  );

  it("кнопка в группе — гасим, выходим, не отвечаем", async () => {
    const { bot, methods } = makeBot();
    await bot.handleUpdate(callback(group));
    expect(methods()).toEqual(["answerCallbackQuery", "leaveChat"]);
  });

  it("сбой leaveChat не роняет обработку", async () => {
    const { bot } = makeBot();
    bot.api.config.use(async (prev, method, payload, signal) => {
      if (method === "leaveChat") throw new Error("network");
      return prev(method, payload, signal);
    });
    await expect(bot.handleUpdate(message(group))).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("[databot] leaveChat:", "network");
  });
});
