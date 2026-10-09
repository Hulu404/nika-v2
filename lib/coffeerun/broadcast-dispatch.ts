import { tgAdmin } from "../telegram/supabase";
import { copyBotMessage } from "../telegram/send";
import { alreadyNotified, markNotified } from "../telegram/poll-store";
import { optedOutChats } from "./invite-dispatch";

/**
 * Общая рассылка организатора (/say): одно сообщение всем, кто с нами бегал.
 *
 * Кому: все чаты, хоть раз подтверждавшие участие в забеге (любой спот, любая
 * дата), минус попросившие не писать (/stop) — как у приглашений, на эту
 * рассылку человек тоже не подписывался.
 *
 * Сообщение не собираем, а копируем из чата организатора (copyMessage):
 * форматирование, фото и подпись уезжают как есть.
 *
 * Дедуп — в памяти процесса, по ключу сообщения-источника, как у /moved и
 * /cancel: эта рассылка уходит только по кнопке и под присмотром, тикера у неё
 * нет. Повторное нажатие (или «Дослать остальным») шлёт только тем, кому ещё не
 * ушло.
 */

/** Троттлинг под лимиты Telegram (~30 msg/sec суммарно) — шлём последовательно. */
const THROTTLE_MS = 1100;

/**
 * Порция за проход. Рассылка идёт в фоне, вебхук её не ждёт; 300 человек — это
 * пять с половиной минут. Остаток — кнопкой «Дослать остальным».
 */
export const MAX_SENDS = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface BroadcastSource {
  /** Чат организатора, где лежит сообщение. */
  fromChatId: number;
  messageId: number;
}

export interface BroadcastDispatchResult {
  ok: boolean;
  dryRun?: boolean;
  /** Уникальных чатов, когда-либо подтверждавших участие. */
  alumni?: number;
  optedOut?: number;
  wouldSend?: number;
  sent?: number;
  blocked?: number;
  failed?: number;
  hasMore?: boolean;
}

/** Ключ дедупа: одно сообщение-источник — одна рассылка. */
export function broadcastKey(src: BroadcastSource): string {
  return `say:${src.fromChatId}:${src.messageId}`;
}

/** Уникальные чаты всех подтверждённых заявок. */
async function alumniChats(): Promise<number[]> {
  const { data, error } = await tgAdmin()
    .from("coffee_run_signups")
    .select("tg_chat_id")
    .not("confirmed_at", "is", null)
    .not("tg_chat_id", "is", null);

  if (error) {
    console.error("[coffeerun-say] signups select:", error.message);
    throw new Error("DB error");
  }

  const rows = (data as { tg_chat_id: number }[] | null) ?? [];
  return [...new Set(rows.map((r) => r.tg_chat_id))];
}

/**
 * Кому уйдёт: бегавшие минус отписавшиеся минус те, кому это сообщение уже
 * ушло. Чистая функция — проверяется тестами без базы.
 */
export function broadcastAudience(
  alumni: readonly number[],
  optedOut: ReadonlySet<number>,
  delivered: (chatId: number) => boolean,
): { due: number[]; optedOut: number } {
  const due: number[] = [];
  let skippedOptedOut = 0;

  for (const chatId of alumni) {
    if (optedOut.has(chatId)) {
      skippedOptedOut++;
      continue;
    }
    if (delivered(chatId)) continue;
    due.push(chatId);
  }

  return { due, optedOut: skippedOptedOut };
}

export async function dispatchBroadcast(
  src: BroadcastSource,
  opts: { dryRun?: boolean } = {},
): Promise<BroadcastDispatchResult> {
  const key = broadcastKey(src);
  const [alumni, optedOut] = await Promise.all([alumniChats(), optedOutChats()]);
  const audience = broadcastAudience(alumni, optedOut, (chatId) => alreadyNotified(key, chatId));

  const due = audience.due.slice(0, MAX_SENDS);
  const hasMore = audience.due.length > MAX_SENDS;
  const base = { alumni: alumni.length, optedOut: audience.optedOut, hasMore };

  if (opts.dryRun) return { ok: true, dryRun: true, wouldSend: due.length, ...base };

  let sent = 0;
  let blocked = 0;
  let failed = 0;

  for (const chatId of due) {
    const res = await copyBotMessage(chatId, src.fromChatId, src.messageId);

    if (res.ok) sent++;
    else if (res.blocked) blocked++;
    else {
      // Транзиентная ошибка (429 и прочее): НЕ помечаем — дошлём кнопкой.
      failed++;
      continue;
    }

    // Помечаем и доставленных, и заблокировавших бота: второй попытки не будет.
    markNotified(key, chatId);

    await sleep(THROTTLE_MS);
  }

  return { ok: true, sent, blocked, failed, ...base };
}
