import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeYooKassa } from "../../test/fake-yookassa";
import { MemoryDonations, MemoryDrafts } from "./store";
import type { FollowupDeps } from "./after-event-dispatch";
import {
  handleDonateCallback,
  handleDonateMenu,
  handleDonationText,
  handleDoneCommand,
  type DonationBotDeps,
} from "../telegram/donations";
import {
  ASK_AMOUNT_TEXT,
  ASK_EMAIL_TEXT,
  BAD_AMOUNT_TEXT,
  BAD_EMAIL_TEXT,
  DONATE_SCREEN_TEXT,
} from "../telegram/donation-copy";
import { MENU_SCHEDULE, UNKNOWN_INPUT_TEXT } from "../telegram/menu";

type Button = { text: string; url?: string; callback_data?: string };
type Out = { kind: "reply" | "edit"; text?: string; buttons: Button[] };

describe("бот: поддержка клуба", () => {
  let out: Out[];
  let deps: DonationBotDeps;
  let yk: FakeYooKassa;
  let store: MemoryDonations;
  let drafts: MemoryDrafts;
  let email: string | null;

  const ctx = (opts: { text?: string; data?: string; username?: string } = {}) =>
    ({
      from: { id: 42, username: opts.username ?? "Nika_Run" },
      chat: { id: 42, type: "private" },
      message: opts.text !== undefined ? { text: opts.text } : undefined,
      callbackQuery: opts.data ? { data: opts.data } : undefined,
      answerCallbackQuery: vi.fn(async () => true),
      reply: vi.fn(async (text: string, other?: { reply_markup?: { inline_keyboard?: Button[][] } }) => {
        out.push({ kind: "reply", text, buttons: (other?.reply_markup?.inline_keyboard ?? []).flat() });
      }),
      editMessageReplyMarkup: vi.fn(async (other: { reply_markup?: { inline_keyboard?: Button[][] } }) => {
        out.push({ kind: "edit", buttons: (other.reply_markup?.inline_keyboard ?? []).flat() });
        return true;
      }),
    }) as never;

  beforeEach(() => {
    out = [];
    yk = new FakeYooKassa();
    store = new MemoryDonations();
    drafts = new MemoryDrafts();
    email = "run@example.com";
    deps = {
      store,
      drafts,
      email: async () => email,
      payment: { store, yk, origin: "https://www.mynika.online", env: {} },
      followup: { env: { DONATIONS_AFTER_EVENT: "1", EVENT_DONE_USERNAMES: "meine_nika,hulu404" } } as unknown as FollowupDeps,
      now: () => new Date("2026-11-15T15:00:00+03:00"),
      paidSince: async () => [],
    };
  });

  it("меню → «Поддержать»: текст 4 и кнопки сумм", async () => {
    await handleDonateMenu(ctx(), deps);
    expect(out[0].text).toBe(DONATE_SCREEN_TEXT);
    expect(out[0].buttons.map((b) => b.text)).toEqual(["200 ₽", "500 ₽", "1000 ₽", "Своя сумма"]);
    expect(out[0].buttons[0].callback_data).toBe("don:200:m");
  });

  it("200 ₽ → кнопка «Оплатить 200 ₽» на страницу ЮKassa встаёт на место сумм", async () => {
    await handleDonateCallback(ctx({ data: "don:200:m" }), deps);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("edit");
    expect(out[0].buttons).toEqual([{ text: "Оплатить 200 ₽", url: expect.stringContaining("yoomoney.ru") }]);
    const [d] = store.rows.values();
    expect(d).toMatchObject({ amount_rub: 200, email: "run@example.com", source: "menu", tg_chat_id: 42, tg_username: "nika_run" });
  });

  it("своя сумма: 50 — переспросить, 350 — проходит", async () => {
    await handleDonateCallback(ctx({ data: "don:c:m" }), deps);
    expect(out.at(-1)!.text).toBe(ASK_AMOUNT_TEXT);
    expect(await handleDonationText(ctx({ text: "50" }), deps)).toBe(true);
    expect(out.at(-1)!.text).toBe(BAD_AMOUNT_TEXT);
    expect(await handleDonationText(ctx({ text: "350" }), deps)).toBe(true);
    expect(out.at(-1)!.buttons).toEqual([{ text: "Оплатить 350 ₽", url: expect.any(String) }]);
    expect([...store.rows.values()][0].amount_rub).toBe(350);
  });

  it("почты нет нигде — спрашиваем один раз, опечатку переспрашиваем, адрес ложится в донат", async () => {
    email = null;
    await handleDonateCallback(ctx({ data: "don:500:c:cave:2026-11-15" }), deps);
    expect(out.at(-1)!.text).toBe(ASK_EMAIL_TEXT);
    await handleDonationText(ctx({ text: "run@example" }), deps);
    expect(out.at(-1)!.text).toBe(BAD_EMAIL_TEXT);
    await handleDonationText(ctx({ text: "new@example.com" }), deps);
    expect(out.at(-1)!.buttons[0].text).toBe("Оплатить 500 ₽");
    expect([...store.rows.values()][0]).toMatchObject({
      email: "new@example.com", source: "after_event", event_kind: "coffee_run", event_ref: "cave:2026-11-15",
    });
  });

  it("кнопка меню отменяет ожидание суммы и уходит своему обработчику", async () => {
    await handleDonateCallback(ctx({ data: "don:c:m" }), deps);
    expect(await handleDonationText(ctx({ text: MENU_SCHEDULE }), deps)).toBe(false);
    expect(await drafts.get(42)).toBeNull();
    expect(await handleDonationText(ctx({ text: "300" }), deps)).toBe(false);
  });

  it("без ожидания текст не наш", async () => {
    expect(await handleDonationText(ctx({ text: "300" }), deps)).toBe(false);
  });

  it("/done от постороннего — как незнакомая команда, без намёка на неё", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleDoneCommand(ctx({ username: "someone" }), deps);
    expect(out.at(-1)!.text).toBe(UNKNOWN_INPUT_TEXT);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("42 @someone"));
    log.mockRestore();
  });
});
