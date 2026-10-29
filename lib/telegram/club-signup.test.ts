import { describe, expect, it } from "vitest";
import {
  checkoutRefusal,
  giftTicketText,
  invoicePayload,
  paidText,
  parseClubToken,
  parseInvoicePayload,
  SOLD_OUT_REFUSAL,
  waitlistText,
} from "./club-signup";
import { SESSIONS } from "../clubs/sessions";

const session = SESSIONS[0];
const ID = "0b5e3c1a-7f7e-4c55-9d2b-2a1f7e9c3d10";

describe("parseClubToken", () => {
  it("достаёт токен из st_<hex>", () => {
    expect(parseClubToken(`st_${"a".repeat(32)}`)).toBe("a".repeat(32));
  });
  it("чужие и битые payload не принимает", () => {
    expect(parseClubToken(`cr_${"a".repeat(32)}`)).toBeNull();
    expect(parseClubToken("st_<script>")).toBeNull();
  });
});

describe("invoice payload", () => {
  it("туда и обратно даёт id заявки", () => {
    expect(parseInvoicePayload(invoicePayload(ID))).toBe(ID);
  });
  it("чужой формат — null", () => {
    expect(parseInvoicePayload("sub:monthly")).toBeNull();
    expect(parseInvoicePayload("club:1; drop table")).toBeNull();
  });
});

describe("checkoutRefusal", () => {
  const pending = { payment_status: "pending" as const, amount_rub: 1000, event_date: "2026-11-01" };
  const query = { currency: "RUB", total_amount: 100000 };

  it("пропускает неоплаченную заявку с верной суммой", () => {
    expect(checkoutRefusal(pending, query, "2026-10-27")).toBeNull();
  });
  it("отказывает: нет заявки, уже оплачено, прошло, сумма не та", () => {
    expect(checkoutRefusal(null, query, "2026-10-27")).toMatch(/Не нашла/);
    expect(checkoutRefusal({ ...pending, payment_status: "paid" }, query, "2026-10-27")).toMatch(/уже оплачено/);
    expect(checkoutRefusal(pending, query, "2026-11-02")).toMatch(/прошло/);
    expect(checkoutRefusal(pending, { currency: "RUB", total_amount: 50000 }, "2026-10-27")).toMatch(/Сумма/);
    expect(checkoutRefusal(pending, { currency: "USD", total_amount: 100000 }, "2026-10-27")).toMatch(/Сумма/);
  });
  it("коврики выкуплены или заявка в листе ожидания — деньги не берём", () => {
    expect(checkoutRefusal(pending, query, "2026-10-27", true)).toBe(SOLD_OUT_REFUSAL);
    expect(checkoutRefusal({ ...pending, payment_status: "waitlist" }, query, "2026-10-27")).toBe(SOLD_OUT_REFUSAL);
  });
});

describe("waitlistText", () => {
  it("говорит про лист ожидания следующего занятия", () => {
    expect(waitlistText({ name: "Ника" }, session)).toMatch(/выкуплены[\s\S]*листе ожидания следующего занятия/);
  });
});

describe("paidText", () => {
  it("называет время сбора и адрес", () => {
    const text = paidText({ name: "Ника" }, session);
    expect(text).toContain("всё супер, заявка оплачена, приходи");
    expect(text).toContain("10:10");
    expect(text).toContain("Климашкина, 20");
  });
  it("подтверждает все билеты компании", () => {
    expect(paidText({ name: "Ника", quantity: 3 }, session)).toContain("3 билета");
  });
  it("подарочный билет содержит получателя и заказ без цены", () => {
    const gift = { id: ID, name: "Ника", quantity: 2, is_gift: true, gift_recipient: "Анна" };
    expect(paidText(gift, session)).toContain("Перешли получателю");
    const text = giftTicketText(gift, session);
    expect(text).toContain("Анна");
    expect(text).toContain(ID);
    expect(text).toContain("2 билета");
    expect(text).not.toContain("1000");
    expect(text).not.toContain("₽");
    expect(text).not.toContain("Ника");
  });
});
