import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotContext } from "./bot";

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], reserve: vi.fn() }));
vi.mock("./supabase", () => ({
  tgAdmin: () => ({
    rpc: state.reserve,
    from: () => {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      let patch: Record<string, unknown> | undefined;
      const result = () => {
        const rows = state.rows.filter((row) => filters.every((filter) => filter(row)));
        if (patch) rows.forEach((row) => Object.assign(row, patch));
        return rows.map((row) => ({ ...row }));
      };
      const query = {
        select: () => query,
        update: (value: Record<string, unknown>) => { patch = value; return query; },
        eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
        in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
        maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: result(), error: null }),
      };
      return query;
    },
  }),
}));

import { handleClubPayment, handleClubPreCheckout, handleClubStart, invoicePayload } from "./club-signup";

const ID = "0b5e3c1a-7f7e-4c55-9d2b-2a1f7e9c3d10";
const token = "a".repeat(32);
const booking = () => ({
  id: ID, confirm_token: token, name: "Ника", email: "buyer@example.com", tg_username: "nika_test",
  club: "stretch", event_date: "2026-11-01", event_time: "10:30", quantity: 3, amount_rub: 3000,
  payment_status: "pending", confirmed_at: null, is_gift: true, gift_recipient: "Анна", counts_seat: true,
});
const context = () => ({
  from: { id: 123, username: "nika_test" },
  reply: vi.fn().mockResolvedValue(undefined),
  replyWithInvoice: vi.fn().mockResolvedValue(undefined),
  answerPreCheckoutQuery: vi.fn().mockResolvedValue(undefined),
  preCheckoutQuery: { invoice_payload: invoicePayload(ID), currency: "RUB", total_amount: 300000 },
  message: { successful_payment: {
    invoice_payload: invoicePayload(ID), currency: "RUB", total_amount: 300000,
    telegram_payment_charge_id: "tg-charge", provider_payment_charge_id: "provider-charge",
  } },
});

describe("фоллбэк: счёт Telegram, отправленный до перехода на ЮKassa", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
    vi.stubEnv("TELEGRAM_PAYMENT_PROVIDER_TOKEN", "test-token");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.mynika.online");
    state.rows = [booking()];
    state.reserve.mockReset().mockResolvedValue({ data: true, error: null });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("одобряет списание только после атомарного резервирования", async () => {
    const ctx = context();
    await handleClubPreCheckout(ctx as unknown as BotContext);
    expect(state.reserve).toHaveBeenCalledWith("reserve_club_tickets", { signup_id: ID, expected_amount: 300000, session_capacity: 16 });
    expect(ctx.answerPreCheckoutQuery).toHaveBeenCalledWith(true);
  });

  it.each([{ data: false, error: null }, { data: null, error: { message: "database unavailable" } }])("отказывает, если резерв не получен: %j", async (result) => {
    state.reserve.mockResolvedValue(result);
    const ctx = context();
    await handleClubPreCheckout(ctx as unknown as BotContext);
    expect(ctx.answerPreCheckoutQuery).toHaveBeenCalledWith(false, expect.any(Object));
  });

  it("не одобряет старый счёт на один билет", async () => {
    const ctx = context();
    ctx.preCheckoutQuery.total_amount = 100000;
    await handleClubPreCheckout(ctx as unknown as BotContext);
    expect(state.reserve).not.toHaveBeenCalled();
    expect(ctx.answerPreCheckoutQuery).toHaveBeenCalledWith(false, expect.any(Object));
  });

  it("сохраняет оплату всех билетов и отправляет подарок отдельным сообщением", async () => {
    const ctx = context();
    expect(await handleClubPayment(ctx as unknown as BotContext)).toBe(true);
    expect(state.rows[0]).toMatchObject({ payment_status: "paid", quantity: 3, amount_rub: 3000, tg_payment_charge_id: "tg-charge" });
    expect(ctx.reply).toHaveBeenCalledTimes(2);
    expect(ctx.reply.mock.calls[1][0]).toContain("Анна, тебе подарили");
    expect(ctx.reply.mock.calls[1][0]).toContain(ID);
    expect(ctx.reply.mock.calls[1][0]).not.toContain("3000");

    const reopened = context();
    await handleClubStart(reopened as unknown as BotContext, `st_${token}`);
    expect(reopened.replyWithInvoice).not.toHaveBeenCalled();
    expect(reopened.reply).toHaveBeenCalledTimes(2);
  });

  it("повтор платёжного апдейта не меняет первую оплату", async () => {
    const ctx = context();
    await handleClubPayment(ctx as unknown as BotContext);
    ctx.message.successful_payment.telegram_payment_charge_id = "duplicate";
    await handleClubPayment(ctx as unknown as BotContext);
    expect(state.rows[0].tg_payment_charge_id).toBe("tg-charge");
  });

  it("в подтверждении есть ссылка на докупку через сайт", async () => {
    const ctx = context();
    await handleClubPayment(ctx as unknown as BotContext);
    const buttons = ctx.reply.mock.calls[0][1].reply_markup.inline_keyboard.flat();
    expect(buttons).toContainEqual({ text: "Докупить билеты", url: "https://www.mynika.online/stretch?purchase=more#reg" });
  });

  it("не выдаёт подарок за неподходящую сумму платежа", async () => {
    const ctx = context();
    ctx.message.successful_payment.total_amount = 100000;
    await handleClubPayment(ctx as unknown as BotContext);
    expect(state.rows[0].payment_status).toBe("pending");
    expect(ctx.reply).toHaveBeenCalledOnce();
    expect(ctx.reply.mock.calls[0][0]).toContain("не удалось подтвердить билеты");
  });
});
