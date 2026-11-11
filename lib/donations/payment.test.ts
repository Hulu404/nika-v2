import { describe, expect, it, vi } from "vitest";
import { FakeYooKassa } from "../../test/fake-yookassa";
import { MemoryDonations } from "./store";
import { normalizeEmail, parseDonationAmount, startDonationPayment } from "./payment";
import { isDonationPayment, processDonationPayment } from "./process";

const ORIGIN = "https://www.mynika.online";
const ENV = { YOOKASSA_TAX_SYSTEM_CODE: "2", YOOKASSA_VAT_CODE: "1" };

async function setup(amount = 500) {
  const store = new MemoryDonations();
  const yk = new FakeYooKassa();
  const notify = vi.fn(async () => {});
  const deps = { store, yk, origin: ORIGIN, env: ENV, notify };
  const donation = await store.create({
    tg_chat_id: 42, tg_username: "nika", email: "run@example.com", amount_rub: amount,
    source: "menu", event_kind: null, event_ref: null,
  });
  return { store, yk, notify, deps, donation };
}

describe("создание платежа доната", () => {
  it("сумма, описание, metadata, чек и Idempotence-Key donation-<id>-<попытка>", async () => {
    const { yk, deps, donation, store } = await setup(500);
    const res = await startDonationPayment(deps, donation);
    expect(res.kind).toBe("redirect");
    const [paymentId] = [...yk.inputs.keys()];
    const input = yk.inputs.get(paymentId)!;
    expect(input.amount).toEqual({ value: "500.00", currency: "RUB" });
    expect(input.description).toBe("Поддержка клуба NIKA");
    expect(input.metadata).toEqual({ kind: "donation", donation_id: donation.id });
    expect(input.returnUrl).toBe(`${ORIGIN}/thanks?d=${donation.id}`);
    expect(input.receipt).toEqual({
      customer: { email: "run@example.com" },
      items: [{
        description: "Добровольная оплата участия в мероприятиях клуба NIKA",
        quantity: "1.00",
        amount: { value: "500.00", currency: "RUB" },
        vat_code: 1,
        payment_mode: "full_payment",
        payment_subject: "service",
      }],
      tax_system_code: 2,
    });
    expect([...yk.byKey.keys()]).toEqual([`donation-${donation.id}-1`]);
    expect((await store.byId(donation.id))!.yk_payment_id).toBe(paymentId);
  });

  it("повторная попытка — новый ключ идемпотентности", async () => {
    const { yk, deps, donation } = await setup();
    await startDonationPayment(deps, donation);
    await startDonationPayment(deps, (await deps.store.byId(donation.id))!);
    expect([...yk.byKey.keys()]).toEqual([`donation-${donation.id}-1`, `donation-${donation.id}-2`]);
  });

  it("YOOKASSA_RECEIPT=0 — без чека", async () => {
    const { yk, deps, donation } = await setup();
    await startDonationPayment({ ...deps, env: { YOOKASSA_RECEIPT: "0" } }, donation);
    expect([...yk.inputs.values()][0].receipt).toBeUndefined();
  });

  it("ЮKassa недоступна — unavailable, без ссылки", async () => {
    const { yk, deps, donation } = await setup();
    yk.failCreate = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await startDonationPayment(deps, donation)).kind).toBe("unavailable");
  });
});

describe("платёж доната по вебхуку", () => {
  it("succeeded → paid и благодарность; повтор ничего не меняет", async () => {
    const { yk, deps, donation, notify, store } = await setup();
    await startDonationPayment(deps, donation);
    const id = [...yk.payments.keys()][0];
    yk.succeed(id);
    const payment = await yk.getPayment(id);
    expect(isDonationPayment(payment)).toBe(true);
    expect((await processDonationPayment(deps, payment)).outcome).toBe("paid");
    expect((await processDonationPayment(deps, payment)).outcome).toBe("already_paid");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ payment_status: "paid" }), "paid");
    expect((await store.byId(donation.id))!.paid_at).not.toBeNull();
  });

  it("canceled → canceled и «оплата не прошла»; повтор не пишет второй раз", async () => {
    const { yk, deps, donation, notify } = await setup();
    await startDonationPayment(deps, donation);
    const id = [...yk.payments.keys()][0];
    yk.cancel(id);
    const payment = await yk.getPayment(id);
    expect((await processDonationPayment(deps, payment)).outcome).toBe("canceled");
    expect((await processDonationPayment(deps, payment)).outcome).toBe("ignored");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.anything(), "canceled");
  });

  it("сумма не совпала — не помечаем оплаченным", async () => {
    const { yk, deps, donation, store } = await setup(500);
    await startDonationPayment(deps, donation);
    const id = [...yk.payments.keys()][0];
    yk.succeed(id);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const forged = { ...(await yk.getPayment(id)), amount: { value: "5.00", currency: "RUB" } };
    expect((await processDonationPayment(deps, forged)).outcome).toBe("mismatch");
    expect((await store.byId(donation.id))!.payment_status).toBe("pending_payment");
  });
});

describe("своя сумма", () => {
  it.each([
    ["99", null],
    ["100", 100],
    ["50000", 50000],
    ["50 000", 50000],
    ["50001", null],
    ["пятьсот", null],
    ["500 р", 500],
    ["500 ₽", 500],
    ["350", 350],
    ["50", null],
    ["300.50", null],
    ["-300", null],
  ])("«%s» → %s", (input, expected) => {
    expect(parseDonationAmount(input)).toBe(expected);
  });
});

describe("почта для чека", () => {
  it("нормальная почта проходит, опечатка — нет", () => {
    expect(normalizeEmail("  run@example.com ")).toBe("run@example.com");
    expect(normalizeEmail("run@example")).toBeNull();
    expect(normalizeEmail("run example.com")).toBeNull();
  });
});
