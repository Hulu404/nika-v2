import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeYooKassa } from "../../../../test/fake-yookassa";
import { MemoryClubOrders } from "@/lib/clubs/orders";
import { startPayment } from "@/lib/clubs/payments";
import { SESSIONS } from "@/lib/clubs/sessions";

const state = vi.hoisted(() => ({ yk: null as unknown, orders: null as unknown, notified: [] as string[] }));
vi.mock("@/lib/yookassa", async (orig) => ({ ...(await orig<typeof import("@/lib/yookassa")>()), yookassaFromEnv: () => state.yk }));
vi.mock("@/lib/clubs/orders", async (orig) => ({ ...(await orig<typeof import("@/lib/clubs/orders")>()), supabaseClubOrders: () => state.orders }));
vi.mock("@/lib/telegram/supabase", () => ({ tgAdmin: () => ({}) }));
vi.mock("@/lib/telegram/club-signup", () => ({ notifyClubOrder: async (o: { id: string }, e: string) => void state.notified.push(`${o.id}:${e}`) }));

import { POST } from "./route";

const hook = (event: string, object: Record<string, unknown>) =>
  POST(new Request("https://www.mynika.online/api/yookassa/webhook", { method: "POST", body: JSON.stringify({ type: "notification", event, object }) }));

describe("вебхук ЮKassa", () => {
  let yk: FakeYooKassa;
  let orders: MemoryClubOrders;

  beforeEach(async () => {
    yk = new FakeYooKassa();
    orders = new MemoryClubOrders(() => new Date("2026-10-29T12:00:00+03:00"));
    state.yk = yk;
    state.orders = orders;
    state.notified = [];
    orders.add({ id: "o1", confirm_token: "a".repeat(32), tg_chat_id: 5 });
    await startPayment({ orders, yk, origin: "https://www.mynika.online", now: () => new Date("2026-10-29T12:00:00+03:00") }, (await orders.byId("o1"))!, SESSIONS[0]);
  });

  it("payment.succeeded → статус берётся из API: заказ оплачен; повторная доставка ничего не меняет", async () => {
    yk.succeed("pay_1");
    const r1 = await hook("payment.succeeded", { id: "pay_1", status: "succeeded" });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ outcome: "paid" });
    const r2 = await hook("payment.succeeded", { id: "pay_1", status: "succeeded" });
    expect(await r2.json()).toMatchObject({ outcome: "already_paid" });
    expect((await orders.byId("o1"))!.payment_status).toBe("paid");
    expect(state.notified).toEqual(["o1:paid"]);
  });

  it("подделка: тело говорит succeeded, а в API платёж pending — заказ не оплачен", async () => {
    const r = await hook("payment.succeeded", { id: "pay_1", status: "succeeded", paid: true, amount: { value: "1000.00", currency: "RUB" } });
    expect(await r.json()).toMatchObject({ outcome: "pending" });
    expect((await orders.byId("o1"))!.payment_status).toBe("pending_payment");
  });

  it("несуществующий платёж — 200 без изменений (повторять бессмысленно)", async () => {
    const r = await hook("payment.succeeded", { id: "pay_404" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ignored: true });
  });

  it("payment.canceled → заказ отменён, места свободны", async () => {
    yk.cancel("pay_1");
    expect(await (await hook("payment.canceled", { id: "pay_1" })).json()).toMatchObject({ outcome: "canceled" });
    expect((await orders.byId("o1"))!.payment_status).toBe("canceled");
  });

  it("refund.* и мусор — 200, ничего не делаем; сбой возврата — 500, ЮKassa повторит", async () => {
    expect(await (await hook("refund.succeeded", { id: "ref_1" })).json()).toMatchObject({ ignored: true });
    expect((await POST(new Request("https://x/api/yookassa/webhook", { method: "POST", body: "{" }))).status).toBe(400);
    // Овербукинг с отказом API возврата.
    orders.add({ id: "full", confirm_token: "f".repeat(32), quantity: 16, amount_rub: 16000, payment_status: "paid" });
    (await orders.byId("o1"))!;
    orders.rows.find((r) => r.id === "o1")!.hold_expires_at = "2026-10-29T08:00:00.000Z";
    yk.succeed("pay_1");
    yk.failRefund = true;
    expect((await hook("payment.succeeded", { id: "pay_1" })).status).toBe(500);
    yk.failRefund = false;
    expect(await (await hook("payment.succeeded", { id: "pay_1" })).json()).toMatchObject({ outcome: "overbooked_refunded" });
  });
});
