import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Донаты в базе: donations (миграция 073) и черновики ввода donation_drafts.
 * Интерфейсы — чтобы бот, вебхук и тесты работали с одним контрактом;
 * Memory* — для тестов.
 */

export type DonationSource = "menu" | "after_event";
export type DonationEventKind = "coffee_run" | "club";
export type DonationStatus = "pending_payment" | "paid" | "canceled";

export interface Donation {
  id: string;
  tg_chat_id: number | null;
  tg_username: string | null;
  email: string;
  amount_rub: number;
  source: DonationSource;
  event_kind: DonationEventKind | null;
  event_ref: string | null;
  payment_status: DonationStatus;
  yk_payment_id: string | null;
  yk_confirmation_url: string | null;
  payment_attempt: number;
  created_at: string;
  paid_at: string | null;
}

export interface DonationContext {
  source: DonationSource;
  event_kind: DonationEventKind | null;
  event_ref: string | null;
}

export type NewDonation = Pick<Donation, "tg_chat_id" | "tg_username" | "email" | "amount_rub"> & DonationContext;

export interface DonationStore {
  create(input: NewDonation): Promise<Donation>;
  byId(id: string): Promise<Donation | null>;
  /** Следующая попытка оплаты: payment_attempt + 1. Возвращает новый номер. */
  nextAttempt(id: string): Promise<number>;
  /** Платёж попытки: ссылка на оплату, статус снова pending_payment. */
  setPayment(id: string, paymentId: string, url: string): Promise<void>;
  /** → paid, если ещё не paid. null — уже было оплачено (повтор вебхука). */
  markPaid(id: string, paymentId: string, paidAt: string): Promise<Donation | null>;
  /** → canceled, если ждёт оплаты именно этим платежом. null — нечего менять. */
  markCanceled(id: string, paymentId: string): Promise<Donation | null>;
  /** Есть ли у чата оплаченный донат (с даты since, если задана). */
  hasPaid(chatId: number, since?: string): Promise<boolean>;
}

export interface DonationDraft extends DonationContext {
  tg_chat_id: number;
  step: "amount" | "email";
  amount_rub: number | null;
  tg_username: string | null;
  updated_at: string;
}

export interface DraftStore {
  get(chatId: number): Promise<DonationDraft | null>;
  set(draft: Omit<DonationDraft, "updated_at">): Promise<void>;
  clear(chatId: number): Promise<void>;
}

const COLUMNS =
  "id, tg_chat_id, tg_username, email, amount_rub, source, event_kind, event_ref, payment_status, " +
  "yk_payment_id, yk_confirmation_url, payment_attempt, created_at, paid_at";

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`donations ${what}: ${error?.message ?? "нет ответа"}`);
}

export function supabaseDonations(db: SupabaseClient): DonationStore {
  const t = () => db.from("donations");
  return {
    async create(input) {
      const { data, error } = await t().insert({ ...input, payment_status: "pending_payment" }).select(COLUMNS).single();
      if (error || !data) fail("insert", error);
      return data as unknown as Donation;
    },
    async byId(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const { data, error } = await t().select(COLUMNS).eq("id", id).maybeSingle();
      if (error) fail("select", error);
      return (data as unknown as Donation | null) ?? null;
    },
    async nextAttempt(id) {
      const current = await this.byId(id);
      if (!current) fail("attempt", { message: `доната ${id} нет` });
      const next = current.payment_attempt + 1;
      const { error } = await t().update({ payment_attempt: next }).eq("id", id).eq("payment_attempt", current.payment_attempt);
      if (error) fail("attempt", error);
      return next;
    },
    async setPayment(id, paymentId, url) {
      const { error } = await t()
        .update({ yk_payment_id: paymentId, yk_confirmation_url: url, payment_status: "pending_payment" })
        .eq("id", id)
        .neq("payment_status", "paid");
      if (error) fail("set payment", error);
    },
    async markPaid(id, paymentId, paidAt) {
      const { data, error } = await t()
        .update({ payment_status: "paid", paid_at: paidAt, yk_payment_id: paymentId })
        .eq("id", id)
        .neq("payment_status", "paid")
        .select(COLUMNS);
      if (error) fail("paid", error);
      return ((data as unknown as Donation[] | null) ?? [])[0] ?? null;
    },
    async markCanceled(id, paymentId) {
      const { data, error } = await t()
        .update({ payment_status: "canceled" })
        .eq("id", id)
        .eq("payment_status", "pending_payment")
        .eq("yk_payment_id", paymentId)
        .select(COLUMNS);
      if (error) fail("canceled", error);
      return ((data as unknown as Donation[] | null) ?? [])[0] ?? null;
    },
    async hasPaid(chatId, since) {
      let q = t().select("id").eq("tg_chat_id", chatId).eq("payment_status", "paid");
      if (since) q = q.gte("paid_at", since);
      const { data, error } = await q.limit(1);
      if (error) fail("has paid", error);
      return ((data as unknown[] | null) ?? []).length > 0;
    },
  };
}

/** Черновик живёт полчаса: потом «300» — это уже не ответ на «напиши сумму». */
export const DRAFT_TTL_MS = 30 * 60_000;

export function supabaseDrafts(db: SupabaseClient, now: () => Date = () => new Date()): DraftStore {
  const t = () => db.from("donation_drafts");
  return {
    async get(chatId) {
      const { data, error } = await t()
        .select("tg_chat_id, step, amount_rub, source, event_kind, event_ref, tg_username, updated_at")
        .eq("tg_chat_id", chatId)
        .maybeSingle();
      if (error) fail("draft get", error);
      const draft = (data as DonationDraft | null) ?? null;
      if (draft && now().getTime() - Date.parse(draft.updated_at) > DRAFT_TTL_MS) return null;
      return draft;
    },
    async set(draft) {
      const { error } = await t().upsert({ ...draft, updated_at: now().toISOString() }, { onConflict: "tg_chat_id" });
      if (error) fail("draft set", error);
    },
    async clear(chatId) {
      const { error } = await t().delete().eq("tg_chat_id", chatId);
      if (error) fail("draft clear", error);
    },
  };
}

// ── Для тестов ────────────────────────────────────────────────────────────────

export class MemoryDonations implements DonationStore {
  rows = new Map<string, Donation>();
  private seq = 0;
  constructor(private now: () => Date = () => new Date()) {}

  async create(input: NewDonation): Promise<Donation> {
    const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}`;
    const row: Donation = {
      ...input, id, payment_status: "pending_payment", yk_payment_id: null, yk_confirmation_url: null,
      payment_attempt: 0, created_at: this.now().toISOString(), paid_at: null,
    };
    this.rows.set(id, row);
    return { ...row };
  }
  async byId(id: string) {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }
  async nextAttempt(id: string) {
    const r = this.rows.get(id)!;
    r.payment_attempt += 1;
    return r.payment_attempt;
  }
  async setPayment(id: string, paymentId: string, url: string) {
    const r = this.rows.get(id)!;
    if (r.payment_status === "paid") return;
    Object.assign(r, { yk_payment_id: paymentId, yk_confirmation_url: url, payment_status: "pending_payment" });
  }
  async markPaid(id: string, paymentId: string, paidAt: string) {
    const r = this.rows.get(id);
    if (!r || r.payment_status === "paid") return null;
    Object.assign(r, { payment_status: "paid", paid_at: paidAt, yk_payment_id: paymentId });
    return { ...r };
  }
  async markCanceled(id: string, paymentId: string) {
    const r = this.rows.get(id);
    if (!r || r.payment_status !== "pending_payment" || r.yk_payment_id !== paymentId) return null;
    r.payment_status = "canceled";
    return { ...r };
  }
  async hasPaid(chatId: number, since?: string) {
    return [...this.rows.values()].some(
      (r) => r.tg_chat_id === chatId && r.payment_status === "paid" && (!since || (r.paid_at ?? "") >= since),
    );
  }
}

export class MemoryDrafts implements DraftStore {
  rows = new Map<number, DonationDraft>();
  async get(chatId: number) {
    return this.rows.get(chatId) ?? null;
  }
  async set(draft: Omit<DonationDraft, "updated_at">) {
    this.rows.set(draft.tg_chat_id, { ...draft, updated_at: new Date().toISOString() });
  }
  async clear(chatId: number) {
    this.rows.delete(chatId);
  }
}
