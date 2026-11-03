import { isRefundable, YooKassaError, type CreatePaymentInput, type YkPayment, type YkRefund, type YooKassaApi } from "../lib/yookassa";

/**
 * ЮKassa в памяти для тестов: платежи по Idempotence-Key, смена статуса
 * руками (succeed / cancel), возвраты только по успешным платежам — как в API.
 */
export class FakeYooKassa implements YooKassaApi {
  payments = new Map<string, YkPayment>();
  inputs = new Map<string, CreatePaymentInput>();
  byKey = new Map<string, string>();
  refunds: YkRefund[] = [];
  refundKeys = new Map<string, YkRefund>();
  failCreate = false;
  failRefund = false;
  calls = { create: 0, get: 0, refund: 0 };

  async createPayment(input: CreatePaymentInput, key: string): Promise<YkPayment> {
    this.calls.create++;
    if (this.failCreate) throw new YooKassaError("ЮKassa недоступна", 503);
    const known = this.byKey.get(key);
    if (known) return structuredClone(this.payments.get(known)!);
    const id = `pay_${this.payments.size + 1}`;
    const p: YkPayment = {
      id, status: "pending", paid: false, amount: input.amount, refundable: false,
      confirmation: { type: "redirect", confirmation_url: `https://yoomoney.ru/checkout/payments/v2/contract?orderId=${id}` },
      metadata: input.metadata,
    };
    this.payments.set(id, p);
    this.inputs.set(id, input);
    this.byKey.set(key, id);
    return structuredClone(p);
  }
  async getPayment(id: string): Promise<YkPayment> {
    this.calls.get++;
    const p = this.payments.get(id);
    if (!p) throw new YooKassaError(`payment ${id} not found`, 404, "not_found");
    return structuredClone(p);
  }
  async refundPayment(payment: YkPayment, key: string): Promise<YkRefund> {
    this.calls.refund++;
    const real = this.payments.get(payment.id);
    if (!real || !isRefundable(real)) throw new YooKassaError(`ЮKassa: платёж ${payment.id} возвращать нечего`, 400);
    if (this.failRefund) throw new YooKassaError("ЮKassa: возврат не прошёл", 500);
    const known = this.refundKeys.get(key);
    if (known) return known;
    const refund: YkRefund = { id: `ref_${this.refunds.length + 1}`, status: "succeeded", payment_id: payment.id, amount: payment.amount };
    this.refunds.push(refund);
    this.refundKeys.set(key, refund);
    real.refundable = false;
    return refund;
  }

  /** Человек оплатил. */
  succeed(id: string) {
    Object.assign(this.payments.get(id)!, { status: "succeeded", paid: true, refundable: true });
  }
  /** Платёж отменён (истёк, отказ банка). */
  cancel(id: string) {
    Object.assign(this.payments.get(id)!, { status: "canceled", paid: false, cancellation_details: { party: "yoo_money", reason: "expired_on_confirmation" } });
  }
}
