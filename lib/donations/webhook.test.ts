import { describe, expect, it, vi } from "vitest";

// Модули с базой и ботом под вебхуком не нужны: обработчики подменяем.
vi.mock("../telegram/supabase", () => ({ tgAdmin: () => ({}) }));

import { FakeYooKassa } from "../../test/fake-yookassa";
import { handleVerifiedPayment } from "./webhook";

describe("вебхук ЮKassa: донат и билет расходятся по своим обработчикам", () => {
  async function setup(metadata: Record<string, string>) {
    const yk = new FakeYooKassa();
    const p = await yk.createPayment(
      { amount: { value: "500.00", currency: "RUB" }, description: "x", returnUrl: "https://x", metadata },
      "k1",
    );
    yk.succeed(p.id);
    const ticket = vi.fn(async () => ({ outcome: "paid", ref: "заказ" }));
    const donation = vi.fn(async () => ({ outcome: "paid", ref: "донат" }));
    return { yk, id: p.id, ticket, donation };
  }

  it("metadata.kind = donation → обработчик донатов, processPayment билетов не вызывается", async () => {
    const { yk, id, ticket, donation } = await setup({ kind: "donation", donation_id: "d1" });
    await handleVerifiedPayment(yk, id, { ticket, donation });
    expect(donation).toHaveBeenCalledTimes(1);
    expect(ticket).not.toHaveBeenCalled();
  });

  it("билет (order_id) → processPayment, донатов не касается", async () => {
    const { yk, id, ticket, donation } = await setup({ order_id: "o1", club: "stretch", event_date: "2026-11-08" });
    await handleVerifiedPayment(yk, id, { ticket, donation });
    expect(ticket).toHaveBeenCalledTimes(1);
    expect(donation).not.toHaveBeenCalled();
  });

  it("статус берётся из API, а не из тела вебхука", async () => {
    const { yk, id, ticket, donation } = await setup({ kind: "donation", donation_id: "d1" });
    await handleVerifiedPayment(yk, id, { ticket, donation });
    expect(yk.calls.get).toBe(1);
    expect((donation.mock.calls as unknown as Array<[unknown]>)[0][0]).toMatchObject({ id, status: "succeeded", paid: true });
  });
});
