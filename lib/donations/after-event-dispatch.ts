import type { SupabaseClient } from "@supabase/supabase-js";
import { COFFEE_RUNS } from "../coffeerun/run";
import { SESSIONS, moscowToday } from "../clubs/sessions";
import { runStatus, type RunStatus } from "../coffeerun/run-changes";
import { optedOutChats } from "../coffeerun/invite-dispatch";
import { clubOrderCounts, coffeeRunAttendedForFollowup } from "../telegram/attendance";
import { afterEventText, eventPrep } from "../telegram/donation-copy";
import { amountsKeyboard } from "../telegram/donation-keyboard";
import { sendBotMessage } from "../telegram/send";
import { tgAdmin } from "../telegram/supabase";
import type { InlineKeyboard } from "grammy";
import {
  afterEventEnabled,
  fromRunEvent,
  fromSessionEvent,
  inAutoWindow,
  isNightMsk,
  mskDayStart,
  pickRecipients,
  repeatSince,
  type Attendee,
  type Exclusions,
  type FollowupEvent,
} from "./rules";

/**
 * Сообщение после события: «спасибо, что сегодня был(а)…» и кнопки сумм.
 *
 * Два входа, одно сообщение на событие:
 *   • тикер раз в минуту (instrumentation.ts) — через 40–60 минут после окончания;
 *   • организатор командой /done — сразу (lib/telegram/donations.ts).
 * Кто первым вставил строку в event_followups, тот и рассылает. Второй
 * страховкой человеку ставится donation_asked_at атомарно прямо перед
 * отправкой: двух сообщений одному человеку не будет и при гонке.
 *
 * Включается только флагом DONATIONS_AFTER_EVENT=1. Сомнение = молчание: не
 * прочиталась база или не проверилась отмена — не пишем, только console.error.
 */

export interface FollowupState {
  started_at: string;
  sent_count: number;
  trigger: "done" | "auto";
}

export interface FollowupDeps {
  runStatus(run: { date: string; spot: string }): Promise<RunStatus>;
  attendees(event: FollowupEvent): Promise<Attendee[]>;
  exclusions(chatIds: number[], now: Date): Promise<Exclusions>;
  /** insert … on conflict do nothing. true — строку вставил этот вызов. */
  claim(ref: string, trigger: "done" | "auto", by: number | null): Promise<boolean>;
  followup(ref: string): Promise<FollowupState | null>;
  /** donation_asked_at = now, только если там пусто. true — поставил этот вызов. */
  markAsked(attendee: Attendee, now: Date): Promise<boolean>;
  setSentCount(ref: string, sent: number): Promise<void>;
  send(chatId: number, text: string, keyboard: InlineKeyboard): Promise<{ ok: boolean; blocked?: boolean }>;
  env?: Record<string, string | undefined>;
}

/** События сегодняшнего дня: отменённые забеги выкинуты, перенос учтён. Ошибка базы по забегу — забег пропускаем. */
export async function todaysEvents(deps: Pick<FollowupDeps, "runStatus">, now: Date): Promise<FollowupEvent[]> {
  const today = moscowToday(now);
  const events: FollowupEvent[] = [];
  for (const run of COFFEE_RUNS.filter((r) => r.date === today)) {
    let status: RunStatus;
    try {
      status = await deps.runStatus(run);
    } catch (err) {
      console.error(`[after-event] статус забега ${run.spot} ${run.date} не прочитан, молчим:`, err instanceof Error ? err.message : err);
      continue;
    }
    if (status.cancelled) continue;
    events.push(fromRunEvent(run, status.movedStart));
  }
  for (const session of SESSIONS.filter((s) => s.date === today)) events.push(fromSessionEvent(session));
  return events;
}

/** Кому уйдёт сообщение по событию. Бросает при ошибке базы. */
export async function recipientsFor(event: FollowupEvent, deps: Pick<FollowupDeps, "attendees" | "exclusions">, now: Date): Promise<Attendee[]> {
  const attendees = await deps.attendees(event);
  if (attendees.length === 0) return [];
  const ex = await deps.exclusions([...new Set(attendees.map((a) => a.chatId))], now);
  return pickRecipients(attendees, ex);
}

export type FollowupResult =
  | { kind: "sent"; sent: number }
  | { kind: "already"; state: FollowupState | null }
  | { kind: "night" }
  | { kind: "disabled" };

/** Разослать сообщение по событию (тикер или /done). Бросает при ошибке базы до отправки. */
export async function runFollowup(
  event: FollowupEvent,
  trigger: "done" | "auto",
  by: number | null,
  deps: FollowupDeps,
  now: Date = new Date(),
): Promise<FollowupResult> {
  if (!afterEventEnabled(deps.env)) return { kind: "disabled" };
  if (isNightMsk(now)) return { kind: "night" };

  const recipients = await recipientsFor(event, deps, now);
  if (!(await deps.claim(event.ref, trigger, by))) return { kind: "already", state: await deps.followup(event.ref) };

  const text = afterEventText(eventPrep(event.format));
  const keyboard = amountsKeyboard({ source: "after_event", event_kind: event.kind, event_ref: event.ref });
  let sent = 0;
  for (const r of recipients) {
    try {
      if (!(await deps.markAsked(r, now))) continue;
      const res = await deps.send(r.chatId, text, keyboard);
      if (res.ok) sent++;
    } catch (err) {
      console.error(`[after-event] ${event.ref} → ${r.chatId}:`, err instanceof Error ? err.message : err);
    }
  }
  await deps.setSentCount(event.ref, sent).catch((err) =>
    console.error(`[after-event] sent_count ${event.ref}:`, err instanceof Error ? err.message : err),
  );
  return { kind: "sent", sent };
}

/** Тик раз в минуту: события в окне 40–60 минут после окончания. */
export async function dispatchAfterEvent(deps: FollowupDeps = supabaseFollowupDeps(), now: Date = new Date()): Promise<number> {
  if (!afterEventEnabled(deps.env) || isNightMsk(now)) return 0;
  let total = 0;
  for (const event of (await todaysEvents(deps, now)).filter((e) => inAutoWindow(e, now))) {
    try {
      const res = await runFollowup(event, "auto", null, deps, now);
      if (res.kind === "sent") {
        total += res.sent;
        console.log(`[after-event] ${event.ref}: разослали ${res.sent}`);
      }
    } catch (err) {
      // Сомнение = молчание. Строку в event_followups до этого места не вставляли,
      // поэтому следующий тик в пределах окна попробует снова.
      console.error(`[after-event] ${event.ref}, молчим:`, err instanceof Error ? err.message : err);
    }
  }
  return total;
}

// ── База ──────────────────────────────────────────────────────────────────────

function must<T>(what: string, res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? ([] as unknown)) as T;
}

export function supabaseFollowupDeps(db: () => SupabaseClient = tgAdmin, env: Record<string, string | undefined> = process.env): FollowupDeps {
  return {
    env,
    runStatus: (run) => runStatus(run, db()),
    async attendees(event) {
      if (event.run) {
        const rows = must<Array<{ id: string; tg_chat_id: number; confirmed_at: string | null; rollcall_answer: "yes" | "no" | null }>>(
          "coffee_run_signups",
          await db()
            .from("coffee_run_signups")
            .select("id, tg_chat_id, confirmed_at, rollcall_answer")
            .eq("spot", event.run.spot)
            .eq("run_date", event.run.date)
            .not("tg_chat_id", "is", null),
        );
        return rows
          .filter((r) => coffeeRunAttendedForFollowup(r))
          .map((r) => ({ chatId: Number(r.tg_chat_id), rowId: r.id, table: "coffee_run_signups" as const }));
      }
      const s = event.session!;
      const rows = must<Array<{ id: string; tg_chat_id: number; payment_status: string; amount_rub: number; confirmed_at: string | null; is_gift: boolean | null }>>(
        "club_signups",
        await db()
          .from("club_signups")
          .select("id, tg_chat_id, payment_status, amount_rub, confirmed_at, is_gift")
          .eq("club", s.club)
          .eq("event_date", s.date)
          .eq("event_time", s.time)
          .not("tg_chat_id", "is", null),
      );
      return rows
        .filter((r) => clubOrderCounts(r))
        .map((r) => ({ chatId: Number(r.tg_chat_id), rowId: r.id, table: "club_signups" as const }));
    },
    async exclusions(chatIds, now) {
      const since = repeatSince(now).toISOString();
      const dayStart = mskDayStart(now).toISOString();
      const ids = (rows: Array<{ tg_chat_id: number }>) => new Set(rows.map((r) => Number(r.tg_chat_id)));
      const [coffeeAsked, clubAsked, donated, bought, optedOut] = await Promise.all([
        db().from("coffee_run_signups").select("tg_chat_id").in("tg_chat_id", chatIds).gte("donation_asked_at", since),
        db().from("club_signups").select("tg_chat_id").in("tg_chat_id", chatIds).gte("donation_asked_at", since),
        db().from("donations").select("tg_chat_id").in("tg_chat_id", chatIds).eq("payment_status", "paid").gte("paid_at", since),
        db().from("club_signups").select("tg_chat_id").in("tg_chat_id", chatIds).eq("payment_status", "paid").gt("amount_rub", 0).gte("paid_at", dayStart),
        optedOutChats(),
      ]);
      return {
        askedRecently: new Set([
          ...ids(must("coffee asked", coffeeAsked as never)),
          ...ids(must("club asked", clubAsked as never)),
        ]),
        donatedRecently: ids(must("donations", donated as never)),
        boughtToday: ids(must("bought today", bought as never)),
        optedOut,
      };
    },
    async claim(ref, trigger, by) {
      const rows = must<unknown[]>(
        "event_followups",
        await db()
          .from("event_followups")
          .upsert({ event_ref: ref, trigger, started_by: by, started_at: new Date().toISOString() }, { onConflict: "event_ref", ignoreDuplicates: true })
          .select("event_ref"),
      );
      return rows.length > 0;
    },
    async followup(ref) {
      const { data, error } = await db().from("event_followups").select("started_at, sent_count, trigger").eq("event_ref", ref).maybeSingle();
      if (error) throw new Error(`event_followups: ${error.message}`);
      return (data as FollowupState | null) ?? null;
    },
    async markAsked(a, now) {
      const rows = must<unknown[]>(
        a.table,
        await db().from(a.table).update({ donation_asked_at: now.toISOString() }).eq("id", a.rowId).is("donation_asked_at", null).select("id"),
      );
      return rows.length > 0;
    },
    async setSentCount(ref, sent) {
      const { error } = await db().from("event_followups").update({ sent_count: sent }).eq("event_ref", ref);
      if (error) throw new Error(`event_followups: ${error.message}`);
    },
    send: (chatId, text, keyboard) => sendBotMessage(chatId, text, keyboard),
  };
}
