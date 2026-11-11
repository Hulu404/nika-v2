import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClubAttendanceRow, CoffeeRunAttendanceRow } from "./attendance";

/**
 * Записи человека для экрана «🎟 Мои записи» и запись ответа переклички.
 *
 * Ищем по tg_chat_id (его пишет бот, когда человек подтверждает заявку), а
 * если по нему в таблице пусто — по нику: заявка с сайта, по которой человек
 * ещё не открывал бота, знает только ник. Ник в базе уже нормализован
 * (normalizeTelegramUsername: нижний регистр, без @), поэтому сравниваем
 * точным равенством с нормализованным ником, без ilike и его подстановочных _.
 */

export interface MyCoffeeRunRow extends CoffeeRunAttendanceRow {
  id: string;
}

export interface MyClubRow extends ClubAttendanceRow {
  id: string;
  confirm_token: string;
  quantity: number;
  hold_expires_at: string | null;
  yk_confirmation_url: string | null;
}

export interface Who {
  chatId: number;
  /** Уже нормализованный ник (normalizeTelegramUsername) или null. */
  username: string | null;
}

const COFFEE_BASE = "id, spot, run_date, confirmed_at";
const CLUB_COLUMNS =
  "id, confirm_token, club, event_date, event_time, payment_status, amount_rub, confirmed_at, is_gift, quantity, hold_expires_at, yk_confirmation_url";

/** PostgREST: «столбца нет» — миграция ещё не применена. */
function missingColumn(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === "42703" || /column .* does not exist/i.test(error.message ?? ""));
}

async function byChatThenUsername<T>(
  who: Who,
  query: (column: "tg_chat_id" | "tg_username", value: number | string) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>,
): Promise<{ rows: T[]; error: { code?: string; message: string } | null }> {
  const first = await query("tg_chat_id", who.chatId);
  if (first.error) return { rows: [], error: first.error };
  const rows = (first.data as T[] | null) ?? [];
  if (rows.length > 0 || !who.username) return { rows, error: null };
  const second = await query("tg_username", who.username);
  return { rows: (second.data as T[] | null) ?? [], error: second.error };
}

/**
 * Заявки человека на кофе-раны. С ответом переклички, если колонка есть: без
 * миграции 072 запрос без неё, чтобы экран не падал (так сломалась запись на
 * сайте, когда код опередил миграцию).
 */
export async function myCoffeeRuns(db: SupabaseClient, who: Who): Promise<MyCoffeeRunRow[]> {
  const run = (columns: string) =>
    byChatThenUsername<MyCoffeeRunRow>(who, (column, value) =>
      db.from("coffee_run_signups").select(columns).eq(column, value).order("run_date", { ascending: true }),
    );
  let res = await run(`${COFFEE_BASE}, rollcall_answer`);
  if (missingColumn(res.error)) res = await run(COFFEE_BASE);
  if (res.error) {
    console.error("[my-signups] coffee_run_signups:", res.error.message);
    return [];
  }
  return res.rows;
}

export async function myClubSignups(db: SupabaseClient, who: Who): Promise<MyClubRow[]> {
  const res = await byChatThenUsername<MyClubRow>(who, (column, value) =>
    db.from("club_signups").select(CLUB_COLUMNS).eq(column, value).order("event_date", { ascending: true }),
  );
  if (res.error) {
    console.error("[my-signups] club_signups:", res.error.message);
    return [];
  }
  return res.rows;
}

/**
 * Забеги из `dates`, на которых перекличка была: хоть у одной заявки есть
 * rollcall_answered_at. Без колонки (миграция не применена) — пусто.
 */
export async function rollcallDates(db: SupabaseClient, dates: readonly string[]): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const { data, error } = await db
    .from("coffee_run_signups")
    .select("run_date")
    .in("run_date", [...dates])
    .not("rollcall_answered_at", "is", null);
  if (error) {
    if (!missingColumn(error)) console.error("[my-signups] rollcall dates:", error.message);
    return new Set();
  }
  return new Set(((data as Array<{ run_date: string }> | null) ?? []).map((r) => r.run_date));
}

/**
 * Ответ переклички в заявку человека на этот забег: сначала по чату, если такой
 * заявки нет — по нику. Возвращает, сколько строк обновлено. Ошибка — исключение:
 * вызывающий ловит её сам и не даёт сломать ответ человеку.
 */
export async function saveRollcallAnswer(
  db: SupabaseClient,
  who: Who,
  runDate: string,
  answer: "yes" | "no",
  now: Date = new Date(),
): Promise<number> {
  const patch = { rollcall_answer: answer, rollcall_answered_at: now.toISOString() };
  const update = async (column: "tg_chat_id" | "tg_username", value: number | string) => {
    const { data, error } = await db
      .from("coffee_run_signups")
      .update(patch)
      .eq("run_date", runDate)
      .eq(column, value)
      .select("id");
    if (error) throw new Error(`coffee_run_signups rollcall: ${error.message}`);
    return ((data as unknown[] | null) ?? []).length;
  };
  const byChat = await update("tg_chat_id", who.chatId);
  if (byChat > 0 || !who.username) return byChat;
  return update("tg_username", who.username);
}
