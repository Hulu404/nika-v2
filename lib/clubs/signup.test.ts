import { beforeEach, describe, expect, it } from "vitest";
import { FakeYooKassa } from "../../test/fake-yookassa";
import { MemoryClubOrders, type ClubOrder } from "./orders";
import { handleSignup, type SignupDeps } from "./signup";

const NOW = new Date("2026-10-29T12:00:00+03:00");
const form = {
  name: "Ника", telegram: "@Nika_Test", email: "nika@example.com", level: "first", mat: "studio", towel: "yes", water: "no",
  consent: true, club: "stretch", event_date: "2026-11-01", source: "stretch",
};
const key = (c: string) => c.repeat(32);

describe("заявка с лендинга → сразу оплата ЮKassa", () => {
  let orders: MemoryClubOrders;
  let yk: FakeYooKassa;
  let deps: SignupDeps;
  let taken: number | null;
  let n: number;

  beforeEach(() => {
    orders = new MemoryClubOrders(() => NOW);
    yk = new FakeYooKassa();
    taken = null;
    n = 0;
    const inSession = (o: ClubOrder, s: { club: string; date: string; time: string }) => o.club === s.club && o.event_date === s.date && o.event_time === s.time;
    deps = {
      orders, yk, origin: "https://www.mynika.online", botUsername: "nika_cofferun_signupsbot", now: () => NOW,
      taken: async (s) => taken ?? orders.taken({ club: s.club, event_date: s.date, event_time: s.time }, null),
      findByKey: async (s, k) => [...orders.rows].reverse().find((o) => inSession(o, s) && ("token" in k ? o.confirm_token === k.token : o.tg_username === k.username)) ?? null,
      findSamePending: async (s, q) => [...orders.rows].reverse().find((o) => inSession(o, s) && o.tg_username === q.username && o.quantity === q.quantity
        && o.is_gift === q.isGift && o.payment_status === "pending_payment" && Date.parse(o.hold_expires_at!) > NOW.getTime()) ?? null,
      insert: async (f) => {
        if (orders.rows.some((o) => o.confirm_token === f.confirm_token)) return "duplicate";
        orders.add({ ...(f as Partial<ClubOrder>), id: `o${++n}`, confirm_token: String(f.confirm_token) });
        return "ok";
      },
    };
  });
  /** Оплаченные места: строки paid на занятии. */
  const paidSeats = (q: number, username = "other") => orders.add({ id: `paid-${orders.rows.length}`, confirm_token: `p${orders.rows.length}`.padEnd(32, "0"), tg_username: username, quantity: q, amount_rub: q * 1000, payment_status: "paid" });

  it("создаёт заказ с ценой из конфига, холд мест и отдаёт redirectUrl ЮKassa, /paid и ссылку в бота", async () => {
    const res = await handleSignup({ ...form, quantity: 2, request_token: key("a") }, deps);
    expect(res.status).toBe(200);
    const order = orders.rows[0];
    expect(order).toMatchObject({ payment_status: "pending_payment", amount_rub: 2000, quantity: 2, tg_username: "nika_test", yk_payment_id: "pay_1" });
    expect(res.body).toMatchObject({
      ok: true, paid: false, waitlist: false, amount: 2000,
      redirectUrl: yk.payments.get("pay_1")!.confirmation!.confirmation_url,
      statusUrl: `https://www.mynika.online/paid?o=${key("a")}`,
      confirmUrl: `https://t.me/nika_cofferun_signupsbot?start=st_${key("a")}`,
    });
  });

  it("повтор с тем же ключом — тот же заказ и тот же платёж", async () => {
    const a = await handleSignup({ ...form, request_token: key("a") }, deps);
    const b = await handleSignup({ ...form, request_token: key("a") }, deps);
    expect(b.body.redirectUrl).toBe(a.body.redirectUrl);
    expect(orders.rows).toHaveLength(1);
    expect(yk.calls.create).toBe(1);
  });

  it("та же форма с новым ключом (перезагрузили страницу), пока холд жив, — тот же платёж", async () => {
    const a = await handleSignup({ ...form, request_token: key("a") }, deps);
    const b = await handleSignup({ ...form, request_token: key("b") }, deps);
    expect(b.body.redirectUrl).toBe(a.body.redirectUrl);
    expect(orders.rows).toHaveLength(1);
  });

  it("другое количество с тем же Telegram — отдельный заказ и отдельный платёж", async () => {
    await handleSignup({ ...form, request_token: key("a") }, deps);
    await handleSignup({ ...form, quantity: 2, request_token: key("b") }, deps);
    expect(orders.rows.map((o) => o.quantity)).toEqual([1, 2]);
    expect(yk.payments.size).toBe(2);
  });

  it("15 из 16 оплачено — продаём последнее; 16 — лист ожидания без оплаты", async () => {
    paidSeats(15);
    expect((await handleSignup({ ...form, request_token: key("a") }, deps)).body.redirectUrl).toBeTruthy();
    const res = await handleSignup({ ...form, telegram: "@another_one", request_token: key("b") }, deps);
    expect(res.body).toMatchObject({ waitlist: true, redirectUrl: null });
    expect(orders.rows.at(-1)!.payment_status).toBe("waitlist");
    expect(yk.payments.size).toBe(1);
  });

  it("при остатке 5 принимает 5 билетов и отклоняет 6 — 409 с остатком", async () => {
    paidSeats(11);
    expect((await handleSignup({ ...form, quantity: 6, request_token: key("a") }, deps))).toMatchObject({ status: 409, body: { error: "Not enough seats", available: 5 } });
    expect((await handleSignup({ ...form, quantity: 5, request_token: key("b") }, deps)).status).toBe(200);
  });

  it("чужой холд держит места: 15 в холде — на 2 билета 409", async () => {
    await handleSignup({ ...form, telegram: "@holder_one", quantity: 15, request_token: key("a") }, deps);
    expect((await handleSignup({ ...form, quantity: 2, request_token: key("b") }, deps)).status).toBe(409);
  });

  it("оплаченный заказ по старому ключу — paid без новой оплаты; докупка с новым ключом — новый заказ", async () => {
    await handleSignup({ ...form, request_token: key("a") }, deps);
    yk.succeed("pay_1");
    await orders.confirm(orders.rows[0].id, "pay_1", 100_000, 16);
    expect((await handleSignup({ ...form, request_token: key("a") }, deps)).body).toMatchObject({ paid: true, redirectUrl: null });
    expect(yk.calls.create).toBe(1);
    const more = await handleSignup({ ...form, request_token: key("c") }, deps);
    expect(more.body.redirectUrl).toBeTruthy();
    expect(orders.rows).toHaveLength(2);
  });

  it("подарок без анкеты получателя", async () => {
    const res = await handleSignup({ ...form, level: undefined, mat: undefined, towel: undefined, water: undefined, is_gift: true, gift_recipient: "Анна", quantity: 2, request_token: key("a") }, deps);
    expect(res.status).toBe(200);
    expect(orders.rows[0]).toMatchObject({ is_gift: true, gift_recipient: "Анна", level: null, mat: null });
  });

  it("ЮKassa недоступна — 503, холд снят, места свободны", async () => {
    yk.failCreate = true;
    const res = await handleSignup({ ...form, quantity: 16, request_token: key("a") }, deps);
    expect(res).toMatchObject({ status: 503, body: { error: "Payment unavailable" } });
    expect(orders.rows[0].payment_status).toBe("canceled");
    yk.failCreate = false;
    expect((await handleSignup({ ...form, telegram: "@another_one", request_token: key("b") }, deps)).status).toBe(200);
  });

  it("не смогли посчитать места — 503 и заказ не создаётся", async () => {
    taken = Number.POSITIVE_INFINITY;
    expect((await handleSignup({ ...form, request_token: key("a") }, deps)).status).toBe(503);
    expect(orders.rows).toHaveLength(0);
  });

  it("проверка полей: 422 со списком, null — 400, неизвестный клуб — 404", async () => {
    expect(await handleSignup({ ...form, consent: false, email: "x", telegram: "@" }, deps)).toMatchObject({ status: 422, body: { fields: ["telegram", "email", "consent"] } });
    expect((await handleSignup(null, deps)).status).toBe(400);
    expect((await handleSignup({ ...form, club: "unknown" }, deps)).status).toBe(404);
    expect(orders.rows).toHaveLength(0);
  });
});
