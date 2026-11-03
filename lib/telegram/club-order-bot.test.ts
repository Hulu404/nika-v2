import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeYooKassa } from "../../test/fake-yookassa";
import { MemoryClubOrders, type ClubOrder } from "../clubs/orders";
import { startPayment, type PaymentDeps } from "../clubs/payments";
import { SESSIONS } from "../clubs/sessions";
import type { BotContext } from "./bot";
import { handleClubCheck, handleClubStart, NO_SEATS_TEXT, OVERBOOKED_TEXT } from "./club-signup";

const session = SESSIONS[0];
const TOKEN = "c".repeat(32);

type Sent = { text: string; buttons: Array<{ text: string; url?: string; callback_data?: string }> };

describe("бот мероприятий: /start st_<token> после оплаты на сайте", () => {
  let orders: MemoryClubOrders;
  let yk: FakeYooKassa;
  let deps: PaymentDeps;
  let sent: Sent[];
  let now: Date;
  const ctx = (data?: string) => ({
    from: { id: 123, username: "Nika_Test" },
    callbackQuery: data ? { data } : undefined,
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    reply: vi.fn(async (text: string, other?: { reply_markup?: { inline_keyboard?: Array<Array<Sent["buttons"][number]>> } }) => {
      sent.push({ text, buttons: (other?.reply_markup?.inline_keyboard ?? []).flat() });
    }),
  }) as unknown as BotContext;
  const add = (patch: Partial<ClubOrder> = {}) => orders.add({ id: "o1", confirm_token: TOKEN, ...patch });
  const last = () => sent.at(-1)!;

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.mynika.online");
    now = new Date("2026-10-29T12:00:00+03:00");
    orders = new MemoryClubOrders(() => now);
    yk = new FakeYooKassa();
    sent = [];
    deps = { orders, yk, origin: "https://www.mynika.online", now: () => now };
  });

  it("оплачено: «всё супер, заявка оплачена, приходи» с датой, временем и адресом; чат привязан к заказу", async () => {
    add({ payment_status: "paid" });
    await handleClubStart(ctx(), `st_${TOKEN}`, deps);
    expect(last().text).toContain("всё супер, заявка оплачена, приходи");
    expect(last().text).toContain("1 ноября");
    expect(last().text).toContain("10:30");
    expect(last().text).toContain("Климашкина, 20");
    expect((await orders.byId("o1"))!).toMatchObject({ tg_chat_id: 123, tg_username: "nika_test" });
  });

  it("ждёт оплаты, а в ЮKassa уже оплачено — бот сам сверяет и отвечает «оплачено»", async () => {
    await startPayment(deps, add(), session);
    yk.succeed("pay_1");
    await handleClubStart(ctx(), `st_${TOKEN}`, deps);
    expect(last().text).toContain("заявка оплачена");
    expect((await orders.byId("o1"))!.payment_status).toBe("paid");
  });

  it("ждёт оплаты и в ЮKassa ещё не оплачено — «Ждём подтверждения» с «Оплатить» и «Проверить ещё раз»; проверка после оплаты — «оплачено»", async () => {
    await startPayment(deps, add(), session);
    await handleClubStart(ctx(), `st_${TOKEN}`, deps);
    expect(last().text).toContain("ждём подтверждения оплаты");
    expect(last().buttons).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "Оплатить", url: yk.payments.get("pay_1")!.confirmation!.confirmation_url }),
      expect.objectContaining({ text: "Проверить ещё раз", callback_data: `stpay:${TOKEN}` }),
    ]));
    yk.succeed("pay_1");
    await handleClubCheck(ctx(`stpay:${TOKEN}`), deps);
    expect(last().text).toContain("заявка оплачена");
  });

  it("платёж отменён, места есть — новая ссылка на оплату (новый платёж)", async () => {
    await startPayment(deps, add(), session);
    yk.cancel("pay_1");
    await handleClubStart(ctx(), `st_${TOKEN}`, deps);
    expect(last().text).toContain("ссылка на оплату готова");
    expect(last().buttons[0]).toMatchObject({ text: "Оплатить", url: yk.payments.get("pay_2")!.confirmation!.confirmation_url });
    expect((await orders.byId("o1"))!).toMatchObject({ payment_status: "pending_payment", payment_attempt: 2 });
  });

  it("холд истёк, а места выкупили — «мест не осталось»", async () => {
    await startPayment(deps, add(), session);
    now = new Date(now.getTime() + 21 * 60_000);
    await orders.expireHolds(now);
    orders.add({ id: "full", confirm_token: "f".repeat(32), quantity: 16, amount_rub: 16000, payment_status: "paid" });
    await handleClubStart(ctx(), `st_${TOKEN}`, deps);
    expect(last().text).toBe(NO_SEATS_TEXT);
  });

  it("старая заявка без платежа (до релиза) — тоже ссылка ЮKassa, а не счёт в Telegram", async () => {
    add({ payment_status: "pending" });
    await handleClubStart(ctx(), `st_${TOKEN}`, deps);
    expect(last().text).toContain("ссылка на оплату готова");
    expect(yk.payments.size).toBe(1);
  });

  it("овербукинг с возвратом — честное сообщение", async () => {
    add({ payment_status: "refunded_overbooked", refund_id: "ref_1" });
    await handleClubStart(ctx(), `st_${TOKEN}`, deps);
    expect(last().text).toBe(OVERBOOKED_TEXT);
  });

  it("неизвестный токен — вежливо и ссылка на страницу занятия", async () => {
    await handleClubStart(ctx(), `st_${"d".repeat(32)}`, deps);
    expect(last().text).toContain("Не нашла заказ по этой ссылке");
    expect(last().buttons[0]).toMatchObject({ url: `https://www.mynika.online${session.landing}` });
  });
});
