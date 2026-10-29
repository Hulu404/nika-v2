/**
 * Клиент API ЮKassa v3 (https://yookassa.ru/developers/api) — только то, что
 * нужно оплате занятий клуба: создать платёж (redirect), получить платёж,
 * сделать возврат. Работает и в edge, и в node: fetch + btoa.
 *
 * Ключи — только из env: YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY. Тестовый
 * магазин отличается только ключами.
 */

export const YOOKASSA_API = "https://api.yookassa.ru/v3";

export type YkPaymentStatus = "pending" | "waiting_for_capture" | "succeeded" | "canceled";

export interface YkAmount {
  value: string;
  currency: string;
}

export interface YkPayment {
  id: string;
  status: YkPaymentStatus;
  paid: boolean;
  amount: YkAmount;
  refundable?: boolean;
  confirmation?: { type: string; confirmation_url?: string };
  metadata?: Record<string, string>;
  cancellation_details?: { party: string; reason: string };
  created_at?: string;
}

export interface YkRefund {
  id: string;
  status: "pending" | "succeeded" | "canceled";
  payment_id: string;
  amount: YkAmount;
}

export interface YkReceiptItem {
  description: string;
  quantity: string;
  amount: YkAmount;
  vat_code: number;
  payment_mode: "full_payment";
  payment_subject: "service";
}

export interface YkReceipt {
  customer: { email?: string; phone?: string };
  items: YkReceiptItem[];
  tax_system_code?: number;
}

export interface CreatePaymentInput {
  amount: YkAmount;
  description: string;
  returnUrl: string;
  metadata: Record<string, string>;
  receipt?: YkReceipt;
}

export class YooKassaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface YooKassaApi {
  createPayment(input: CreatePaymentInput, idempotenceKey: string): Promise<YkPayment>;
  getPayment(id: string): Promise<YkPayment>;
  /** Возврат всей суммы. Только по успешному платежу — иначе ошибка, денег не трогаем. */
  refundPayment(payment: YkPayment, idempotenceKey: string): Promise<YkRefund>;
}

export interface YooKassaConfig {
  shopId: string;
  secretKey: string;
}

export function yookassaConfig(env: Record<string, string | undefined> = process.env): YooKassaConfig | null {
  const shopId = env.YOOKASSA_SHOP_ID?.trim();
  const secretKey = env.YOOKASSA_SECRET_KEY?.trim();
  return shopId && secretKey ? { shopId, secretKey } : null;
}

/** «1000.00» из рублей; копейки — для сверки с базой. */
export const rub = (amountRub: number): YkAmount => ({ value: amountRub.toFixed(2), currency: "RUB" });
export const kopecks = (amount: YkAmount) => Math.round(Number(amount.value) * 100);

/** Можно ли возвращать деньги по платежу: только реально списанные. */
export const isRefundable = (p: YkPayment) => p.status === "succeeded" && p.paid && p.refundable !== false;

export function createYooKassa(config: YooKassaConfig, fetchImpl: typeof fetch = fetch): YooKassaApi {
  const auth = `Basic ${btoa(`${config.shopId}:${config.secretKey}`)}`;
  async function call<T>(method: "GET" | "POST", path: string, body?: unknown, idempotenceKey?: string): Promise<T> {
    const res = await fetchImpl(`${YOOKASSA_API}${path}`, {
      method,
      headers: {
        Authorization: auth,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(idempotenceKey ? { "Idempotence-Key": idempotenceKey } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* не JSON — ниже ошибка со статусом */
    }
    if (!res.ok) {
      throw new YooKassaError(
        `ЮKassa ${method} ${path}: HTTP ${res.status} ${String(json.code ?? "")} ${String(json.description ?? "").slice(0, 200)}`.trim(),
        res.status,
        typeof json.code === "string" ? json.code : undefined,
      );
    }
    return json as T;
  }

  return {
    createPayment: (input, key) =>
      call<YkPayment>("POST", "/payments", {
        amount: input.amount,
        capture: true,
        confirmation: { type: "redirect", return_url: input.returnUrl },
        description: input.description.slice(0, 128),
        metadata: input.metadata,
        ...(input.receipt ? { receipt: input.receipt } : {}),
      }, key),
    getPayment: async (id) => {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new YooKassaError("ЮKassa: странный id платежа", 400);
      return call<YkPayment>("GET", `/payments/${id}`);
    },
    refundPayment: async (payment, key) => {
      if (!isRefundable(payment)) throw new YooKassaError(`ЮKassa: платёж ${payment.id} в статусе ${payment.status}, возвращать нечего`, 400);
      return call<YkRefund>("POST", "/refunds", { payment_id: payment.id, amount: payment.amount }, key);
    },
  };
}

/** Клиент из env; null — ключи не заданы (оплата недоступна). */
export function yookassaFromEnv(env: Record<string, string | undefined> = process.env): YooKassaApi | null {
  const config = yookassaConfig(env);
  return config ? createYooKassa(config) : null;
}
