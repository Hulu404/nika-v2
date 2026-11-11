import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClubSession } from "./sessions";

/**
 * Заказы на занятия клуба (club_signups, миграции 065–069) — то, что нужно
 * оплате через ЮKassa. Места и переходы статусов, где важна гонка (холд,
 * подтверждение оплаты), делают SQL-функции под блокировкой на занятие;
 * MemoryClubOrders повторяет их логику для тестов.
 */

export type ClubPaymentStatus =
  | "pending" | "pending_payment" | "paid" | "refunded" | "waitlist"
  | "canceled" | "expired" | "refunded_overbooked";

export interface ClubOrder {
  id: string;
  confirm_token: string;
  name: string;
  email: string;
  tg_username: string;
  tg_chat_id: number | null;
  club: string;
  event_date: string;
  event_time: string;
  amount_rub: number;
  quantity: number;
  is_gift: boolean;
  gift_recipient: string | null;
  payment_status: ClubPaymentStatus;
  counts_seat: boolean;
  hold_expires_at: string | null;
  payment_attempt: number;
  yk_payment_id: string | null;
  yk_confirmation_url: string | null;
  refund_id: string | null;
  confirmed_at: string | null;
  paid_at: string | null;
}

export const ORDER_COLUMNS =
  "id, confirm_token, name, email, tg_username, tg_chat_id, club, event_date, event_time, amount_rub, quantity, is_gift, gift_recipient, " +
  "payment_status, counts_seat, hold_expires_at, payment_attempt, yk_payment_id, yk_confirmation_url, refund_id, confirmed_at, paid_at";

export type HoldResult = "held" | "no_seats" | "bad_status" | "not_found";
export type ConfirmResult =
  | "paid" | "already_paid" | "duplicate" | "overbooked" | "refunded"
  | "amount_mismatch" | "not_found" | "bad_status";

export interface ClubOrderStore {
  byId(id: string): Promise<ClubOrder | null>;
  byToken(token: string): Promise<ClubOrder | null>;
  /** Холд мест на minutes под новую попытку оплаты (атомарно с проверкой вместимости). */
  hold(id: string, capacity: number, minutes: number): Promise<HoldResult>;
  /** Записать платёж текущей попытки. false — попытка уже сменилась или холда нет. */
  setPayment(id: string, attempt: number, paymentId: string, url: string): Promise<boolean>;
  /** Платёж не создался — снять холд. */
  releaseHold(id: string, attempt: number): Promise<void>;
  /** Успешный платёж (уже проверенный в API) — атомарно с проверкой вместимости. */
  confirm(id: string, paymentId: string, paidKopecks: number, capacity: number): Promise<ConfirmResult>;
  /** Отмена текущего платежа: pending_payment → canceled. true — изменил этот вызов. */
  cancel(id: string, paymentId: string): Promise<boolean>;
  setRefund(id: string, refundId: string): Promise<void>;
  /** pending_payment с истёкшим холдом → expired. Возвращает, сколько. */
  expireHolds(now: Date): Promise<number>;
  bindChat(id: string, chatId: number, username: string | null): Promise<void>;
}

/** Занято мест на занятии: оплаченные + активные холды (+ резервы старых счетов). */
export async function takenSeats(db: SupabaseClient, session: Pick<ClubSession, "club" | "date" | "time">): Promise<number> {
  const { data, error } = await db.rpc("club_taken_seats", { p_club: session.club, p_date: session.date, p_time: session.time, except_id: null });
  if (error) throw new Error(`club_taken_seats: ${error.message}`);
  return Number(data ?? 0);
}

export function supabaseClubOrders(db: SupabaseClient): ClubOrderStore {
  const t = () => db.from("club_signups");
  const one = async (column: string, value: string) => {
    const { data, error } = await t().select(ORDER_COLUMNS).eq(column, value).maybeSingle();
    if (error) throw new Error(`club_signups: ${error.message}`);
    return (data as unknown as ClubOrder | null) ?? null;
  };
  const now = () => new Date().toISOString();
  return {
    byId: (id) => one("id", id),
    byToken: (token) => one("confirm_token", token),
    async hold(id, capacity, minutes) {
      const { data, error } = await db.rpc("hold_club_seats", { signup_id: id, session_capacity: capacity, hold_minutes: minutes });
      if (error) throw new Error(`hold_club_seats: ${error.message}`);
      return data as HoldResult;
    },
    async setPayment(id, attempt, paymentId, url) {
      const { data, error } = await t()
        .update({ yk_payment_id: paymentId, yk_confirmation_url: url, updated_at: now() })
        .eq("id", id).eq("payment_attempt", attempt).eq("payment_status", "pending_payment")
        .select("id");
      if (error) throw new Error(`club_signups setPayment: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async releaseHold(id, attempt) {
      const { error } = await t()
        .update({ payment_status: "canceled", hold_expires_at: null, updated_at: now() })
        .eq("id", id).eq("payment_attempt", attempt).eq("payment_status", "pending_payment");
      if (error) throw new Error(`club_signups releaseHold: ${error.message}`);
    },
    async confirm(id, paymentId, paidKopecks, capacity) {
      const { data, error } = await db.rpc("confirm_club_payment", {
        signup_id: id, payment_id: paymentId, paid_kopecks: paidKopecks, session_capacity: capacity,
      });
      if (error) throw new Error(`confirm_club_payment: ${error.message}`);
      return data as ConfirmResult;
    },
    async cancel(id, paymentId) {
      const { data, error } = await t()
        .update({ payment_status: "canceled", hold_expires_at: null, updated_at: now() })
        .eq("id", id).eq("payment_status", "pending_payment").eq("yk_payment_id", paymentId)
        .select("id");
      if (error) throw new Error(`club_signups cancel: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async setRefund(id, refundId) {
      const { error } = await t().update({ refund_id: refundId, refunded_at: now(), updated_at: now() }).eq("id", id);
      if (error) throw new Error(`club_signups setRefund: ${error.message}`);
    },
    async expireHolds(at) {
      const { data, error } = await t()
        .update({ payment_status: "expired", updated_at: at.toISOString() })
        .eq("payment_status", "pending_payment").lt("hold_expires_at", at.toISOString())
        .select("id");
      if (error) throw new Error(`club_signups expireHolds: ${error.message}`);
      return (data ?? []).length;
    },
    async bindChat(id, chatId, username) {
      const { data: row } = await t().select("confirmed_at").eq("id", id).maybeSingle();
      const patch: Record<string, unknown> = { tg_chat_id: chatId, updated_at: now() };
      if (!(row as { confirmed_at: string | null } | null)?.confirmed_at) patch.confirmed_at = now();
      if (username) patch.tg_username = username;
      const { error } = await t().update(patch).eq("id", id);
      if (error) throw new Error(`club_signups bindChat: ${error.message}`);
    },
  };
}

// ── Память (тесты): та же логика, что в SQL-функциях миграции 069 ────────────

export class MemoryClubOrders implements ClubOrderStore {
  rows: ClubOrder[] = [];
  constructor(public clock: () => Date = () => new Date()) {}

  add(patch: Partial<ClubOrder> & Pick<ClubOrder, "id" | "confirm_token">): ClubOrder {
    const row: ClubOrder = {
      name: "Ника", email: "nika@example.com", tg_username: "nika_test", tg_chat_id: null,
      club: "stretch", event_date: "2026-11-01", event_time: "10:30", amount_rub: 1000, quantity: 1,
      is_gift: false, gift_recipient: null, payment_status: "pending", counts_seat: true, hold_expires_at: null,
      payment_attempt: 0, yk_payment_id: null, yk_confirmation_url: null, refund_id: null, confirmed_at: null, paid_at: null,
      ...patch,
    };
    this.rows.push(row);
    return row;
  }
  private get(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  private holdActive(r: ClubOrder) {
    return r.payment_status === "pending_payment" && !!r.hold_expires_at && Date.parse(r.hold_expires_at) > this.clock().getTime();
  }
  taken(r: Pick<ClubOrder, "club" | "event_date" | "event_time">, exceptId: string | null): number {
    return this.rows
      .filter((x) => x.club === r.club && x.event_date === r.event_date && x.event_time === r.event_time && x.counts_seat && x.id !== exceptId)
      .filter((x) => x.payment_status === "paid" || this.holdActive(x))
      .reduce((s, x) => s + x.quantity, 0);
  }
  async byId(id: string) {
    const r = this.get(id);
    return r ? { ...r } : null;
  }
  async byToken(token: string) {
    const r = this.rows.find((x) => x.confirm_token === token);
    return r ? { ...r } : null;
  }
  async hold(id: string, capacity: number, minutes: number): Promise<HoldResult> {
    const r = this.get(id);
    if (!r) return "not_found";
    if (!["pending", "pending_payment", "canceled", "expired"].includes(r.payment_status)) return "bad_status";
    if (r.counts_seat && this.taken(r, r.id) + r.quantity > capacity) return "no_seats";
    Object.assign(r, {
      payment_status: "pending_payment", hold_expires_at: new Date(this.clock().getTime() + minutes * 60_000).toISOString(),
      payment_attempt: r.payment_attempt + 1, yk_payment_id: null, yk_confirmation_url: null,
    });
    return "held";
  }
  async setPayment(id: string, attempt: number, paymentId: string, url: string) {
    const r = this.get(id);
    if (!r || r.payment_attempt !== attempt || r.payment_status !== "pending_payment") return false;
    Object.assign(r, { yk_payment_id: paymentId, yk_confirmation_url: url });
    return true;
  }
  async releaseHold(id: string, attempt: number) {
    const r = this.get(id);
    if (r && r.payment_attempt === attempt && r.payment_status === "pending_payment") Object.assign(r, { payment_status: "canceled", hold_expires_at: null });
  }
  async confirm(id: string, paymentId: string, paidKopecks: number, capacity: number): Promise<ConfirmResult> {
    const r = this.get(id);
    if (!r) return "not_found";
    if (r.payment_status === "paid") return r.yk_payment_id === paymentId ? "already_paid" : "duplicate";
    if (r.payment_status === "refunded_overbooked" && r.yk_payment_id === paymentId) return r.refund_id ? "refunded" : "overbooked";
    if (r.payment_status === "refunded" || r.payment_status === "refunded_overbooked") return "duplicate";
    if (r.amount_rub * 100 !== paidKopecks) return "amount_mismatch";
    if (!["pending", "pending_payment", "canceled", "expired", "waitlist"].includes(r.payment_status)) return "bad_status";
    const ownHold = this.holdActive(r) && r.yk_payment_id === paymentId;
    if (!ownHold && r.counts_seat && this.taken(r, r.id) + r.quantity > capacity) {
      Object.assign(r, { payment_status: "refunded_overbooked", yk_payment_id: paymentId, hold_expires_at: null });
      return "overbooked";
    }
    Object.assign(r, { payment_status: "paid", paid_at: this.clock().toISOString(), yk_payment_id: paymentId, hold_expires_at: null });
    return "paid";
  }
  async cancel(id: string, paymentId: string) {
    const r = this.get(id);
    if (!r || r.payment_status !== "pending_payment" || r.yk_payment_id !== paymentId) return false;
    Object.assign(r, { payment_status: "canceled", hold_expires_at: null });
    return true;
  }
  async setRefund(id: string, refundId: string) {
    const r = this.get(id);
    if (r) r.refund_id = refundId;
  }
  async expireHolds(at: Date) {
    let n = 0;
    for (const r of this.rows) {
      if (r.payment_status === "pending_payment" && r.hold_expires_at && Date.parse(r.hold_expires_at) < at.getTime()) {
        r.payment_status = "expired";
        n++;
      }
    }
    return n;
  }
  async bindChat(id: string, chatId: number, username: string | null) {
    const r = this.get(id);
    if (!r) return;
    r.tg_chat_id = chatId;
    if (!r.confirmed_at) r.confirmed_at = this.clock().toISOString();
    if (username) r.tg_username = username;
  }
}
