import { describe, expect, it, vi } from "vitest";
import { createYooKassa, kopecks, rub, yookassaConfig } from "./yookassa";

describe("клиент API ЮKassa", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("ключи только из env; без них — null", () => {
    expect(yookassaConfig({ YOOKASSA_SHOP_ID: "123", YOOKASSA_SECRET_KEY: "test_x" })).toEqual({ shopId: "123", secretKey: "test_x" });
    expect(yookassaConfig({ YOOKASSA_SHOP_ID: "123" })).toBeNull();
  });

  it("платёж: Basic-авторизация, Idempotence-Key, redirect, capture, metadata и чек", async () => {
    const fetchImpl = vi.fn(async () => ok({ id: "p1", status: "pending", paid: false, amount: rub(1000), confirmation: { type: "redirect", confirmation_url: "https://pay" } }));
    const yk = createYooKassa({ shopId: "123", secretKey: "test_x" }, fetchImpl as unknown as typeof fetch);
    await yk.createPayment({ amount: rub(1000), description: "Пилатес", returnUrl: "https://www.mynika.online/paid?o=t", metadata: { order_id: "o1" },
      receipt: { customer: { email: "a@b.ru" }, items: [] } }, "club-o1-1");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.yookassa.ru/v3/payments");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${btoa("123:test_x")}`);
    expect(headers["Idempotence-Key"]).toBe("club-o1-1");
    expect(JSON.parse(String(init.body))).toMatchObject({
      amount: { value: "1000.00", currency: "RUB" }, capture: true,
      confirmation: { type: "redirect", return_url: "https://www.mynika.online/paid?o=t" },
      metadata: { order_id: "o1" }, receipt: { customer: { email: "a@b.ru" } },
    });
  });

  it("ошибка API — исключение со статусом; возврат по неоплаченному платежу не отправляется", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: "not_found", description: "Payment not found" }), { status: 404 }));
    const yk = createYooKassa({ shopId: "1", secretKey: "k" }, fetchImpl as unknown as typeof fetch);
    await expect(yk.getPayment("p404")).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(yk.refundPayment({ id: "p1", status: "pending", paid: false, amount: rub(10) }, "refund-p1")).rejects.toThrow(/возвращать нечего/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(yk.getPayment("../hack")).rejects.toThrow(/странный id/);
  });

  it("суммы: рубли ↔ копейки", () => {
    expect(rub(1500)).toEqual({ value: "1500.00", currency: "RUB" });
    expect(kopecks({ value: "1500.00", currency: "RUB" })).toBe(150000);
  });
});
