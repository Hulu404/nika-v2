import { vi } from "vitest";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { MemoryStore } from "../../databot/data/memory-store";
import type { TeamMember } from "../access";
import { MemoryEventStore } from "../events";
import { MemoryTeamForms } from "../form";
import { ROSTER } from "../roster";
import { handleAiMessage, handleAiUpdate, type AssistantDeps } from "./assistant";
import { MemoryStateStore, MemoryTurnStore } from "./memory";
import { MemoryDraftStore, MemoryParticipantStore, MemoryReminderStore } from "./stores";
import { TeamAiError, type StepInput, type StepResult, type TeamAi } from "./yandex";

/**
 * Только для тестов: «Пятница» с ассистентом на памяти и мок-моделью, которая
 * отвечает по сценарию (вызовы инструментов и текст).
 */

export const msk = (local: string) => new Date(`${local}+03:00`);
export const NOW = msk("2026-10-13T14:05"); // вт 13.10

// Команда — как после roster.ts; chat_id по порядку: Настя-глава 1 … Али 8, Дмитрий 9.
export const TEAM: TeamMember[] = ROSTER.map((r, i) => ({
  chat_id: i + 1, username: r.username, display_name: r.firstName, role: "member", joined_at: "2026-10-01T00:00:00Z",
  added_by: null, last_seen_at: null, digest_opt_in: true, first_name: r.firstName, title: r.title,
  departments: r.departments, name_aliases: r.aliases,
}));
export const ALI = 8;
export const NASTYA = 2; // Настя из SMM, не фаундер
export const VIKA_DEV = 4;
export const MASHA_EVENTS = 6;
export const SALMA = 7;

export type Sent = { method: string; chat: number; text: string; message_id?: number; buttons: Array<{ text: string; data?: string }>; keyboard?: unknown };
export type Script = Array<StepResult | Error | ((input: StepInput) => StepResult)>;

export const call = (name: string, args: Record<string, unknown> = {}): StepResult => ({ type: "tools", calls: [{ name, arguments: args }], tokensIn: 100, tokensOut: 10 });
export const reply = (text: string): StepResult => ({ type: "text", text, tokensIn: 50, tokensOut: 5 });

export function harness() {
  const h = {
    sent: [] as Sent[],
    script: [] as Script,
    inputs: [] as StepInput[],
    clock: NOW,
    drafts: new MemoryDraftStore(),
    tasks: new MemoryStore(),
    events: new MemoryEventStore(),
    reminders: new MemoryReminderStore(),
    participants: new MemoryParticipantStore(),
    turns: new MemoryTurnStore(),
    state: new MemoryStateStore(),
    usage: [] as Array<[number, number, number]>,
    limited: false,
    transcribe: vi.fn(async (_chat: number, _ogg: Uint8Array, _seconds: number) => "поставь маше из ивента найти пейсеров до четверга 20:00"),
    download: vi.fn(async () => new Uint8Array([1, 2, 3])),
    deps: null as unknown as AssistantDeps,
    say: async (_text: string, _from = ALI) => {},
    voice: async (_duration: number, _from = ALI, _size = 20_000) => {},
    press: async (_data: string, _from = ALI) => {},
    preview: () => [...h.sent].reverse().find((s) => s.text.startsWith("Проверь, пожалуйста"))!,
    button: (label: string) => h.preview()?.buttons.find((b) => b.text === label)?.data,
    last: () => h.sent.at(-1)!,
    /** Все тексты бота за тест. */
    texts: () => h.sent.map((s) => s.text),
  };
  const ai: TeamAi = {
    transcribe: h.transcribe,
    step: async (input) => {
      h.inputs.push(structuredClone(input));
      const next = h.script.shift();
      if (!next) return reply("");
      if (next instanceof Error) throw next;
      return typeof next === "function" ? next(input) : next;
    },
    checkLimit: async () => {
      if (h.limited) throw new TeamAiError("rate_limit", "limit");
    },
    recordLlm: async (chat, tin, tout) => void h.usage.push([chat, tin, tout]),
  };
  h.deps = {
    ai, drafts: h.drafts, tasks: h.tasks, events: h.events, reminders: h.reminders, participants: h.participants,
    turns: h.turns, state: h.state, forms: new MemoryTeamForms(),
    listTeam: async () => TEAM,
    findMember: async (id) => TEAM.find((m) => m.chat_id === id) ?? null,
    downloadVoice: h.download,
    showSchedule: async (ctx, range) => { await ctx.reply(`🗓 Расписание · ${range}`); },
    myDay: async (m) => `☀️ План для ${m.first_name}`,
  };
  const bot = new Bot("1:x", { botInfo: { id: 1, is_bot: true, first_name: "П", username: "t_bot" } as UserFromGetMe });
  let mid = 1000;
  bot.api.config.use(async (_prev, method, payload) => {
    const p = payload as { chat_id: number; message_id?: number; text?: string; reply_markup?: { inline_keyboard?: Array<Array<{ text: string; callback_data?: string }>>; keyboard?: unknown } };
    const record: Sent = { method, chat: p.chat_id, text: String(p.text ?? ""), message_id: p.message_id,
      buttons: (p.reply_markup?.inline_keyboard ?? []).flat().map((b) => ({ text: b.text, data: b.callback_data })), keyboard: p.reply_markup?.keyboard };
    if (method === "sendMessage" || method === "editMessageText") h.sent.push(record);
    const result = method === "sendMessage" ? { message_id: ++mid, date: 1, chat: { id: p.chat_id, type: "private" } } : true;
    return { ok: true, result } as never;
  });
  bot.use(async (ctx) => {
    if (await handleAiUpdate(ctx, h.deps, h.clock)) return;
    const member = TEAM.find((m) => m.chat_id === ctx.from?.id)!;
    await handleAiMessage(ctx, member, h.deps, h.clock);
  });
  let id = 0;
  const chat = (from: number) => ({ id: from, type: "private" as const, first_name: "x" });
  const user = (from: number) => ({ id: from, is_bot: false, first_name: "x" });
  h.say = async (text, from = ALI) => {
    await bot.handleUpdate({ update_id: ++id, message: { message_id: ++mid, date: 1, text, chat: chat(from), from: user(from) } } as Update);
  };
  h.voice = async (duration, from = ALI, size = 20_000) => {
    await bot.handleUpdate({ update_id: ++id, message: { message_id: ++mid, date: 1, chat: chat(from), from: user(from),
      voice: { file_id: "v1", file_unique_id: "u1", duration, mime_type: "audio/ogg", file_size: size } } } as Update);
  };
  h.press = async (data, from = ALI) => {
    const msg = [...h.sent].reverse().find((s) => s.buttons.some((b) => b.data === data));
    await bot.handleUpdate({ update_id: ++id, callback_query: { id: `c${id}`, chat_instance: "x", data, from: user(from),
      message: { message_id: msg?.message_id ?? 1, date: 1, text: "x", chat: chat(from) } } } as Update);
  };
  return h;
}
