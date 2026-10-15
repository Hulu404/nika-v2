import type { Api } from "grammy";
import type { InlineKeyboardButton, InlineKeyboardMarkup } from "grammy/types";
import { tgAdmin } from "../telegram/supabase";
import { escapeHtmlTeam } from "./copy";
import { NIKA } from "./projects/projects";
import { isQuiet, quietEnd } from "./quiet";

/**
 * Очередь отложенных сообщений (team_outbox, миграция 062). Автоматическое
 * сообщение в тихие часы (quiet.ts) не уходит, а ложится сюда с send_after =
 * 09:00; тикер отправляет его утром. Если одному человеку накопилось
 * несколько — одно сообщение «Пока тебя не было:» со списком и кнопками.
 *
 * До миграции 062 очереди нет: сообщение уходит сразу, как раньше.
 */

export const AWAY_HEAD = "Пока тебя не было:";

export interface OutboxPayload {
  /** Текст сообщения, всегда HTML. */
  html: string;
  /** Кнопки, если сообщение уходит одно. */
  keyboard?: InlineKeyboardButton[][];
  /** Строка в сводке «Пока тебя не было» (по умолчанию — весь текст). */
  line?: string;
  /** Кнопки этого пункта в сводке (по умолчанию — keyboard). */
  buttons?: InlineKeyboardButton[][];
}

export interface OutboxRow {
  id: number;
  chat_id: number;
  project_id: string;
  kind: string;
  payload: OutboxPayload;
  send_after: string;
  sent_at: string | null;
}

export interface OutboxStore {
  enqueue(row: { chat_id: number; project_id?: string; kind: string; payload: OutboxPayload; send_after: Date }, now: Date): Promise<void>;
  /** Неотправленные, чьё время пришло, по порядку. */
  due(now: Date): Promise<OutboxRow[]>;
  /** Занять под отправку: id тех, что занял этот вызов (второй тикер их не получит). */
  claim(ids: number[], now: Date): Promise<number[]>;
}

export function supabaseOutboxStore(): OutboxStore {
  const t = () => tgAdmin().from("team_outbox");
  const fail = (e: { message: string }) => new Error(`team_outbox: ${e.message}`);
  return {
    async enqueue(row, now) {
      const { error } = await t().insert({ chat_id: row.chat_id, project_id: row.project_id ?? NIKA, kind: row.kind, payload: row.payload,
        send_after: row.send_after.toISOString(), created_at: now.toISOString() });
      if (error) throw fail(error);
    },
    async due(now) {
      const { data, error } = await t().select("*").is("sent_at", null).lte("send_after", now.toISOString()).order("id").limit(500);
      if (error) throw fail(error);
      return (data ?? []) as OutboxRow[];
    },
    async claim(ids, now) {
      if (!ids.length) return [];
      const { data, error } = await t().update({ sent_at: now.toISOString() }).in("id", ids).is("sent_at", null).select("id");
      if (error) throw fail(error);
      return ((data ?? []) as Array<{ id: number }>).map((r) => r.id);
    },
  };
}

export class MemoryOutboxStore implements OutboxStore {
  rows: OutboxRow[] = [];
  async enqueue(row: { chat_id: number; project_id?: string; kind: string; payload: OutboxPayload; send_after: Date }) {
    this.rows.push({ id: this.rows.length + 1, chat_id: row.chat_id, project_id: row.project_id ?? NIKA, kind: row.kind,
      payload: structuredClone(row.payload), send_after: row.send_after.toISOString(), sent_at: null });
  }
  async due(now: Date) {
    return this.rows.filter((r) => !r.sent_at && Date.parse(r.send_after) <= now.getTime()).map((r) => structuredClone(r));
  }
  async claim(ids: number[], now: Date) {
    const out: number[] = [];
    for (const r of this.rows) if (ids.includes(r.id) && !r.sent_at) {
      r.sent_at = now.toISOString();
      out.push(r.id);
    }
    return out;
  }
}

// Очередь по умолчанию; тесты подменяют configureOutbox.
let configured: OutboxStore | null | undefined;
export function configureOutbox(store: OutboxStore | null | undefined): void {
  configured = store;
}
export function defaultOutbox(): OutboxStore {
  return configured ?? supabaseOutboxStore();
}

type SendOptions = { parse_mode?: "HTML"; reply_markup?: unknown; link_preview_options?: unknown };

/** Текст как HTML: обычный текст экранируем, чтобы в сводке не сломалась разметка. */
const asHtml = (text: string, options?: SendOptions) => (options?.parse_mode === "HTML" ? text : escapeHtmlTeam(text));
const rowsOf = (options?: SendOptions) => ((options?.reply_markup as InlineKeyboardMarkup | undefined)?.inline_keyboard ?? undefined) as InlineKeyboardButton[][] | undefined;

export interface QueuedMessage {
  chatId: number;
  projectId?: string | null;
  kind: string;
  text: string;
  options?: SendOptions;
  line?: string;
  buttons?: InlineKeyboardButton[][];
}

/**
 * Отправить сейчас или, в тихие часы, положить в очередь до 09:00. Очереди
 * нет (миграция не применена) — отправить сразу. Возвращает, когда уйдёт.
 */
export async function sendOrQueue(api: Pick<Api, "sendMessage">, msg: QueuedMessage, now: Date, outbox: OutboxStore = defaultOutbox()): Promise<{ queued: Date | null }> {
  if (isQuiet(now)) {
    const at = quietEnd(now);
    try {
      await outbox.enqueue({
        chat_id: msg.chatId, project_id: msg.projectId ?? NIKA, kind: msg.kind, send_after: at,
        payload: { html: asHtml(msg.text, msg.options), keyboard: rowsOf(msg.options), line: msg.line, buttons: msg.buttons },
      }, now);
      return { queued: at };
    } catch (err) {
      console.error("[team-outbox] enqueue:", err instanceof Error ? err.message : String(err));
    }
  }
  await api.sendMessage(msg.chatId, msg.text, msg.options as never);
  return { queued: null };
}

/**
 * Api для автоматических рассылок: в тихие часы sendMessage кладёт сообщение
 * в очередь (вернёт message_id 0 — редактировать такое сообщение нечего),
 * днём — обычная отправка. except — кому отвечаем прямо сейчас (нажал кнопку):
 * ему сразу.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function quietApi<A extends { sendMessage: (...args: any[]) => Promise<unknown> }>(api: A, kind: string, now: Date, opts: { except?: number; outbox?: OutboxStore; projectId?: string } = {}): A {
  const sendMessage = (async (chatId: number, text: string, other?: SendOptions) => {
    if (chatId === opts.except || !isQuiet(now)) return api.sendMessage(chatId, text, other as never);
    const res = await sendOrQueue(api as unknown as Pick<Api, "sendMessage">, { chatId, projectId: opts.projectId, kind, text, options: other }, now, opts.outbox ?? defaultOutbox());
    if (!res.queued) return { message_id: 0 };
    return { message_id: 0, date: Math.floor(now.getTime() / 1000), chat: { id: chatId, type: "private" } };
  }) as unknown as A["sendMessage"];
  return new Proxy(api, { get: (target, prop, recv) => (prop === "sendMessage" ? sendMessage : Reflect.get(target, prop, recv)) });
}

/**
 * Проход тикера: в тихие часы ничего; днём — всё, чьё время пришло. Одно
 * сообщение — как было; несколько одному человеку — «Пока тебя не было:».
 */
export async function flushOutbox(api: Pick<Api, "sendMessage">, now: Date, outbox: OutboxStore = defaultOutbox()): Promise<number> {
  if (isQuiet(now)) return 0;
  const rows = await outbox.due(now);
  if (!rows.length) return 0;
  const byChat = new Map<number, OutboxRow[]>();
  for (const r of rows) byChat.set(r.chat_id, [...(byChat.get(r.chat_id) ?? []), r]);
  let sent = 0;
  for (const [chat, list] of byChat) {
    // Отметка до отправки: лучше потерять сообщение при сбое Telegram, чем прислать дважды.
    const mine = new Set(await outbox.claim(list.map((r) => r.id), now));
    const items = list.filter((r) => mine.has(r.id)).map((r) => r.payload);
    if (!items.length) continue;
    const opts = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
    if (items.length === 1) {
      const [p] = items;
      await api.sendMessage(chat, p.html, { ...opts, ...(p.keyboard?.length ? { reply_markup: { inline_keyboard: p.keyboard } } : {}) }).catch(() => {});
    } else {
      const text = [`<b>${AWAY_HEAD}</b>`, ...items.map((p) => `\n• ${p.line ?? p.html}`)].join("\n");
      const keyboard = items.flatMap((p) => p.buttons ?? p.keyboard ?? []);
      await api.sendMessage(chat, text, { ...opts, ...(keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {}) }).catch(() => {});
    }
    sent += items.length;
  }
  return sent;
}
