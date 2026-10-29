import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeYooKassa } from "../../test/fake-yookassa";
import { MemoryClubOrders, type ClubOrder } from "./orders";
import { botStartUrl, expireHolds, HOLD_MINUTES, paymentReceipt, processPayment, refreshOrder, startPayment, type PaymentDeps } from "./payments";
import { SESSIONS } from "./sessions";

const session = SESSIONS[0]; // /stretch, 16 мест, 1000 ₽
let t = new Date("2026-10-29T12:00:00+03:00");
const at = (min: number) => new Date(t.getTime() + min * 60_000);

describe("оплата занятия через ЮKassa", () => {
  let orders: MemoryClubOrders;
  let yk: FakeYooKassa;
  let deps: PaymentDeps;
  let notified: Array<[string, string]>;
  let now: Date;
  const order = (id: string, patch: Partial<ClubOrder> = {}) => orders.add({ id, confirm_token: `${id}`.padEnd(32, "0"), ...patch });

  beforeEach(() => {
    t = new Date("2026-10-29T12:00:00+03:00");
    now = t;
    orders = new MemoryClubOrders(() => now);
    yk = new FakeYooKassa();
    notified = [];
    deps = { orders, yk, origin: "https://www.mynika.online", now: () => now, notify: async (o, e) => void notified.push([o.id, e]) };
  });

  it("форма → холд на 20 минут, платёж redirect с order_id, ключом идемпотентности, чеком и return_url /paid", async () => {
    const o = order("a1", { quantity: 2, amount_rub: 2000, email: "buyer@example.com" });
    const res = await startPayment(deps, o, session);
    expect(res.kind).toBe("redirect");
    const row = (await orders.byId("a1"))!;
    expect(row).toMatchObject({ payment_status: "pending_payment", payment_attempt: 1, yk_payment_id: "pay_1" });
    expect(Date.parse(row.hold_expires_at!)).toBe(at(HOLD_MINUTES).getTime());
    expect(yk.byKey.get("club-a1-1")).toBe("pay_1");
    const input = yk.inputs.get("pay_1")!;
    expect(input.metadata.order_id).toBe("a1");
    expect(input.amount).toEqual({ value: "2000.00", currency: "RUB" });
    expect(input.returnUrl).toBe(`https://www.mynika.online/paid?o=${o.confirm_token}`);
    expect(input.receipt!.customer).toEqual({ email: "buyer@example.com" });
    expect(input.receipt!.items[0]).toMatchObject({ quantity: "2.00", amount: { value: "1000.00", currency: "RUB" } });
  });

  it("повторная отправка, пока холд жив, — тот же платёж, без нового", async () => {
    const o = order("a1");
    const first = await startPayment(deps, o, session);
    const again = await startPayment(deps, (await orders.byId("a1"))!, session);
    expect(again).toMatchObject({ kind: "redirect", url: first.kind === "redirect" ? first.url : "" });
    expect(yk.calls.create).toBe(1);
    expect(yk.payments.size).toBe(1);
  });

  it("холд учитывается в свободных местах: 16 мест, 15 в холде — второй заказ на 2 не проходит", async () => {
    await startPayment(deps, order("big", { quantity: 15, amount_rub: 15000 }), session);
    expect(orders.taken(order("x", { quantity: 0 }), null)).toBe(15);
    expect((await startPayment(deps, order("two", { quantity: 2, amount_rub: 2000 }), session)).kind).toBe("no_seats");
    expect((await startPayment(deps, order("one"), session)).kind).toBe("redirect");
  });

  it("успешная оплата: вебхук проверяет платёж в API → paid; повторный вебхук ничего не меняет", async () => {
    await startPayment(deps, order("a1", { tg_chat_id: 77 }), session);
    yk.succeed("pay_1");
    expect((await processPayment(deps, "pay_1")).outcome).toBe("paid");
    const paid = (await orders.byId("a1"))!;
    expect(paid).toMatchObject({ payment_status: "paid", yk_payment_id: "pay_1", hold_expires_at: null });
    expect(notified).toEqual([["a1", "paid"]]);
    expect((await processPayment(deps, "pay_1")).outcome).toBe("already_paid");
    expect((await orders.byId("a1"))!.paid_at).toBe(paid.paid_at);
    expect(notified).toHaveLength(1);
    expect(yk.refunds).toHaveLength(0);
  });

  it("телу вебхука не доверяем: в API платёж ещё pending — заказ не оплачен", async () => {
    await startPayment(deps, order("a1"), session);
    expect((await processPayment(deps, "pay_1")).outcome).toBe("pending");
    expect((await orders.byId("a1"))!.payment_status).toBe("pending_payment");
    await expect(processPayment(deps, "pay_999")).rejects.toMatchObject({ status: 404 });
  });

  it("отмена: payment.canceled → canceled, места свободны; повтор отмены ничего не меняет", async () => {
    await startPayment(deps, order("a1", { quantity: 16, amount_rub: 16000 }), session);
    yk.cancel("pay_1");
    expect((await processPayment(deps, "pay_1")).outcome).toBe("canceled");
    expect((await orders.byId("a1"))!.payment_status).toBe("canceled");
    expect((await processPayment(deps, "pay_1")).outcome).toBe("canceled");
    expect((await startPayment(deps, order("b"), session)).kind).toBe("redirect");
  });

  it("овербукинг: холд истёк, место продали, а оплата всё же пришла — автоматический возврат и refunded_overbooked", async () => {
    await startPayment(deps, order("late", { tg_chat_id: 5 }), session);
    now = at(21);
    expect(await expireHolds(deps)).toBe(1);
    expect((await orders.byId("late"))!.payment_status).toBe("expired");
    await startPayment(deps, order("full", { quantity: 16, amount_rub: 16000 }), session);
    yk.succeed("pay_2");
    await processPayment(deps, "pay_2");
    yk.succeed("pay_1");
    const res = await processPayment(deps, "pay_1");
    expect(res.outcome).toBe("overbooked_refunded");
    expect((await orders.byId("late"))!).toMatchObject({ payment_status: "refunded_overbooked", refund_id: "ref_1" });
    expect(yk.refunds).toEqual([expect.objectContaining({ payment_id: "pay_1" })]);
    expect(notified).toContainEqual(["late", "refunded_overbooked"]);
    // Повтор вебхука — второго возврата нет.
    expect((await processPayment(deps, "pay_1")).outcome).toBe("already_paid");
    expect(yk.refunds).toHaveLength(1);
  });

  it("холд истёк, но места есть — поздняя оплата засчитывается", async () => {
    await startPayment(deps, order("late"), session);
    now = at(25);
    await expireHolds(deps);
    yk.succeed("pay_1");
    expect((await processPayment(deps, "pay_1")).outcome).toBe("paid");
  });

  it("возврат не прошёл — ошибка (вебхук ответит 500, ЮKassa повторит), повтор доводит до конца", async () => {
    await startPayment(deps, order("late"), session);
    now = at(21);
    await expireHolds(deps);
    await startPayment(deps, order("full", { quantity: 16, amount_rub: 16000 }), session);
    yk.succeed("pay_1");
    yk.failRefund = true;
    await expect(processPayment(deps, "pay_1")).rejects.toThrow(/возврат не прошёл/);
    expect((await orders.byId("late"))!).toMatchObject({ payment_status: "refunded_overbooked", refund_id: null });
    yk.failRefund = false;
    expect((await processPayment(deps, "pay_1")).outcome).toBe("overbooked_refunded");
    expect((await orders.byId("late"))!.refund_id).toBe("ref_1");
  });

  it("возврат без оплаты невозможен: по неоплаченному платежу деньги не трогаем", async () => {
    await startPayment(deps, order("a1"), session);
    const pending = await yk.getPayment("pay_1");
    await expect(yk.refundPayment(pending, "refund-pay_1")).rejects.toThrow(/возвращать нечего/);
    yk.cancel("pay_1");
    await expect(yk.refundPayment(await yk.getPayment("pay_1"), "refund-pay_1")).rejects.toThrow(/возвращать нечего/);
    expect(yk.refunds).toHaveLength(0);
  });

  it("второй платёж по уже оплаченному заказу возвращается", async () => {
    await startPayment(deps, order("a1"), session);
    now = at(21);
    await expireHolds(deps);
    await startPayment(deps, (await orders.byId("a1"))!, session); // новая попытка: pay_2
    yk.succeed("pay_2");
    await processPayment(deps, "pay_2");
    yk.succeed("pay_1");
    expect((await processPayment(deps, "pay_1")).outcome).toBe("duplicate_refunded");
    expect((await orders.byId("a1"))!).toMatchObject({ payment_status: "paid", yk_payment_id: "pay_2" });
    expect(yk.refunds.map((r) => r.payment_id)).toEqual(["pay_1"]);
  });

  it("ЮKassa не создала платёж — холд снимается, места свободны", async () => {
    yk.failCreate = true;
    const res = await startPayment(deps, order("a1", { quantity: 16, amount_rub: 16000 }), session);
    expect(res.kind).toBe("unavailable");
    expect((await orders.byId("a1"))!.payment_status).toBe("canceled");
    expect(orders.taken({ club: "stretch", event_date: "2026-11-01", event_time: "10:30" }, null)).toBe(0);
  });

  it("refreshOrder: ждущий заказ сверяется с ЮKassa (страница /paid, бот)", async () => {
    await startPayment(deps, order("a1"), session);
    yk.succeed("pay_1");
    expect((await refreshOrder(deps, (await orders.byId("a1"))!)).payment_status).toBe("paid");
  });

  it("ссылка в бота и чек: имя бота из env, YOOKASSA_RECEIPT=0 выключает чек", () => {
    expect(botStartUrl("abc", "nika_cofferun_signupsbot")).toBe("https://t.me/nika_cofferun_signupsbot?start=st_abc");
    expect(botStartUrl("abc", "")).toBeNull();
    vi.stubEnv("YOOKASSA_TAX_SYSTEM_CODE", "2");
    expect(paymentReceipt({ email: "a@b.ru", amount_rub: 1000, quantity: 1 }, session)?.tax_system_code).toBe(2);
    expect(paymentReceipt({ email: "a@b.ru", amount_rub: 1000, quantity: 1 }, session, { YOOKASSA_RECEIPT: "0" })).toBeUndefined();
    vi.unstubAllEnvs();
  });
});
