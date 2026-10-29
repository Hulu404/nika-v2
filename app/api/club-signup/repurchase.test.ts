import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, fakeClient } from "@/test/fake-supabase";

let database = createFakeDb();
vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeClient(database) }));
import { GET, POST } from "./route";

const firstToken = "a".repeat(32);
const nextToken = "b".repeat(32);
const form = {
  name: "Анна", telegram: "@anna_test", email: "anna@example.com", consent: true,
  club: "stretch", event_date: "2026-11-01", level: "first", mat: "studio", towel: "no", water: "yes",
};
const post = (token: string, quantity = 1) => POST(new Request("http://x/api/club-signup", {
  method: "POST", body: JSON.stringify({ ...form, request_token: token, quantity }),
}));
const availability = async () => (await GET(new Request("http://x/api/club-signup?club=stretch&date=2026-11-01"))).json();

describe("докупка на тот же Telegram-аккаунт", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test");
    vi.stubEnv("NEXT_PUBLIC_TELEGRAM_BOT_USERNAME", "nika_test_bot");
    database = createFakeDb({
      club_signups: (row, db) => ({ id: `order-${db.tables.club_signups.length + 1}`, counts_seat: true, ...row }),
    });
    await post(firstToken);
    Object.assign(database.tables.club_signups[0], { payment_status: "paid", tg_chat_id: 123, tg_payment_charge_id: "first-charge" });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("после одного оплаченного билета создаёт второй заказ с отдельным счётом", async () => {
    const original = { ...database.tables.club_signups[0] };
    const res = await post(nextToken);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ paid: false, quantity: 1, amount: 1000, confirmUrl: `https://t.me/nika_test_bot?start=st_${nextToken}` });
    expect(database.tables.club_signups).toHaveLength(2);
    expect(database.tables.club_signups[0]).toEqual(original);
    expect(database.tables.club_signups[1]).toMatchObject({ tg_username: "anna_test", quantity: 1, amount_rub: 1000, payment_status: "pending" });
    database.tables.club_signups[1].payment_status = "paid";
    expect(await availability()).toMatchObject({ available: 14 });
  });

  it("сетевой повтор докупки возвращает тот же заказ", async () => {
    const first = await (await post(nextToken)).json();
    const retry = await (await post(nextToken)).json();
    expect(retry).toEqual(first);
    expect(database.tables.club_signups).toHaveLength(2);
  });

  it("старый токен возвращает оплаченный билет, не создавая новую оплату", async () => {
    expect(await (await post(firstToken)).json()).toMatchObject({ paid: true, quantity: 1, amount: 1000 });
    expect(database.tables.club_signups).toHaveLength(1);
  });

  it("даёт докупить последний билет, но не два", async () => {
    database.tables.club_signups.push({ ...database.tables.club_signups[0], id: "other-buyer", tg_username: "another", confirm_token: "c".repeat(32), quantity: 14 });
    const rejected = await post(nextToken, 2);
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ available: 1 });
    expect(database.tables.club_signups).toHaveLength(2);
    expect(await (await post(nextToken)).json()).toMatchObject({ paid: false, waitlist: false, amount: 1000 });
    expect(database.tables.club_signups).toHaveLength(3);
  });

  it("при распродаже даёт только лист ожидания, сохраняя старый билет", async () => {
    database.tables.club_signups.push({ ...database.tables.club_signups[0], id: "other-buyer", tg_username: "another", confirm_token: "c".repeat(32), quantity: 15 });
    expect(await (await post(nextToken)).json()).toMatchObject({ paid: false, waitlist: true });
    expect(database.tables.club_signups[0]).toMatchObject({ payment_status: "paid", quantity: 1, tg_payment_charge_id: "first-charge" });
    expect(database.tables.club_signups[2].payment_status).toBe("waitlist");
  });
});
