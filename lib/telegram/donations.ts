import { Api, InlineKeyboard } from "grammy";
import { normalizeTelegramUsername } from "../coffeerun/telegram-username";
import { publicOriginFromEnv } from "../public-origin";
import { yookassaFromEnv } from "../yookassa";
import {
  lastKnownEmail,
  normalizeEmail,
  parseDonationAmount,
  startDonationPayment,
  type DonationPaymentDeps,
} from "../donations/payment";
import {
  supabaseDonations,
  supabaseDrafts,
  type DonationContext,
  type DonationStore,
  type DraftStore,
  type Donation,
} from "../donations/store";
import {
  recipientsFor,
  runFollowup,
  supabaseFollowupDeps,
  todaysEvents,
  type FollowupDeps,
} from "../donations/after-event-dispatch";
import { afterEventEnabled, doneUsernames, eventStart, startedToday, type FollowupEvent } from "../donations/rules";
import {
  ASK_AMOUNT_TEXT,
  ASK_EMAIL_TEXT,
  BAD_AMOUNT_TEXT,
  BAD_EMAIL_TEXT,
  DONATE_SCREEN_TEXT,
  DONATIONS_DB_DOWN,
  DONE_CANCEL_LABEL,
  DONE_CANCELLED_TEXT,
  DONE_DISABLED_TEXT,
  DONE_FAILED_TEXT,
  DONE_LIST_TEXT,
  DONE_NIGHT_TEXT,
  DONE_NOTHING_TEXT,
  DONE_SEND_LABEL,
  PAYMENT_FAILED_TEXT,
  PAYMENT_UNAVAILABLE_TEXT,
  THANKS_TEXT,
  doneAlreadyText,
  doneConfirmText,
  doneEventLine,
  doneSentText,
  donationsSummaryText,
} from "./donation-copy";
import { amountsKeyboard, parseDonateCallback, payKeyboard, retryKeyboard, DONATE_RETRY_CALLBACK_RE } from "./donation-keyboard";
import { MENU_LABELS, UNKNOWN_INPUT_TEXT, menuKeyboard } from "./menu";
import { isAdminChat } from "./poll-store";
import { SUPPORT_LABEL, SUPPORT_URL } from "./cta";
import { tgAdmin } from "./supabase";
import type { BotContext } from "./bot";

/**
 * Поддержка клуба в боте мероприятий: кнопка меню «🧡 Поддержать», суммы,
 * своя сумма, почта для чека, оплата ЮKassa и сообщения после оплаты. Плюс
 * команды организатора /done (разослать «спасибо» по событию) и /donations.
 *
 * Тексты — только из donation-copy.ts.
 */

export interface DonationBotDeps {
  store: DonationStore;
  drafts: DraftStore;
  email(who: { chatId: number; username: string | null }): Promise<string | null>;
  payment: DonationPaymentDeps;
  followup: FollowupDeps;
  now(): Date;
  /** Сводка /donations: оплаченные донаты с даты since. */
  paidSince(since: string): Promise<Array<{ amount_rub: number; source: string; paid_at: string }>>;
}

let _deps: DonationBotDeps | null = null;

export function defaultDonationDeps(): DonationBotDeps {
  if (_deps) return _deps;
  const store = supabaseDonations(tgAdmin());
  _deps = {
    store,
    drafts: supabaseDrafts(tgAdmin()),
    email: (who) => lastKnownEmail(tgAdmin(), who),
    payment: { store, yk: yookassaFromEnv(), origin: publicOriginFromEnv() },
    followup: supabaseFollowupDeps(),
    now: () => new Date(),
    async paidSince(since) {
      const { data, error } = await tgAdmin()
        .from("donations")
        .select("amount_rub, source, paid_at")
        .eq("payment_status", "paid")
        .gte("paid_at", since);
      if (error) throw new Error(`donations: ${error.message}`);
      return (data as Array<{ amount_rub: number; source: string; paid_at: string }> | null) ?? [];
    },
  };
  return _deps;
}

const who = (ctx: BotContext) => ({
  chatId: ctx.from!.id,
  username: normalizeTelegramUsername(ctx.from?.username ?? null),
});

function supportKeyboard(): InlineKeyboard {
  return new InlineKeyboard().url(SUPPORT_LABEL, SUPPORT_URL);
}

// ── Экран «Поддержать» ───────────────────────────────────────────────────────

export async function handleDonateMenu(ctx: BotContext, deps: DonationBotDeps = defaultDonationDeps()): Promise<void> {
  if (ctx.from?.id !== undefined) await deps.drafts.clear(ctx.from.id).catch(() => {});
  await ctx.reply(DONATE_SCREEN_TEXT, { reply_markup: amountsKeyboard({ source: "menu", event_kind: null, event_ref: null }) });
}

/**
 * Сумма выбрана: почта есть — сразу платёж и кнопка «Оплатить», почты нет —
 * один раз спрашиваем её. editMessage — кнопка оплаты встаёт на место кнопок
 * сумм в том же сообщении (нажатие из экрана или из сообщения после события).
 */
async function proceedWithAmount(
  ctx: BotContext,
  amount: number,
  context: DonationContext,
  deps: DonationBotDeps,
  editMessage: boolean,
): Promise<void> {
  const person = who(ctx);
  let email: string | null = null;
  try {
    email = await deps.email(person);
  } catch (err) {
    console.error("[donation] почта:", err instanceof Error ? err.message : err);
  }
  if (!email) {
    await deps.drafts.set({ tg_chat_id: person.chatId, step: "email", amount_rub: amount, tg_username: person.username, ...context });
    await ctx.reply(ASK_EMAIL_TEXT);
    return;
  }
  await createAndPay(ctx, amount, email, context, deps, editMessage);
}

async function createAndPay(
  ctx: BotContext,
  amount: number,
  email: string,
  context: DonationContext,
  deps: DonationBotDeps,
  editMessage: boolean,
): Promise<void> {
  const person = who(ctx);
  try {
    const donation = await deps.store.create({ tg_chat_id: person.chatId, tg_username: person.username, email, amount_rub: amount, ...context });
    const res = await startDonationPayment(deps.payment, donation);
    if (res.kind !== "redirect") {
      console.error(`[donation] оплата ${donation.id} не готова: ${res.reason}`);
      await ctx.reply(PAYMENT_UNAVAILABLE_TEXT, { reply_markup: supportKeyboard() });
      return;
    }
    const keyboard = payKeyboard(amount, res.url);
    if (editMessage) {
      const edited = await ctx.editMessageReplyMarkup({ reply_markup: keyboard }).then(() => true, () => false);
      if (edited) return;
    }
    await ctx.reply(DONATE_SCREEN_TEXT, { reply_markup: keyboard });
  } catch (err) {
    console.error("[donation] создание:", err instanceof Error ? err.message : err);
    await ctx.reply(PAYMENT_UNAVAILABLE_TEXT, { reply_markup: supportKeyboard() });
  }
}

/** Кнопки сумм: don:<сумма|c>:<контекст>. */
export async function handleDonateCallback(ctx: BotContext, deps: DonationBotDeps = defaultDonationDeps()): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  const parsed = parseDonateCallback(ctx.callbackQuery?.data ?? "");
  if (!parsed || ctx.from?.id === undefined) return;
  if (parsed.amount === "custom") {
    const person = who(ctx);
    await deps.drafts.set({ tg_chat_id: person.chatId, step: "amount", amount_rub: null, tg_username: person.username, ...parsed.context });
    await ctx.reply(ASK_AMOUNT_TEXT);
    return;
  }
  const amount = parseDonationAmount(String(parsed.amount));
  if (!amount) return;
  await proceedWithAmount(ctx, amount, parsed.context, deps, true);
}

/** «Оплатить N ₽» после неудачной оплаты: новая попытка того же доната. */
export async function handleDonateRetry(ctx: BotContext, deps: DonationBotDeps = defaultDonationDeps()): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  const id = DONATE_RETRY_CALLBACK_RE.exec(ctx.callbackQuery?.data ?? "")?.[1];
  const donation = id ? await deps.store.byId(id).catch(() => null) : null;
  if (!donation || donation.tg_chat_id !== ctx.from?.id) return;
  if (donation.payment_status === "paid") {
    await ctx.reply(THANKS_TEXT);
    return;
  }
  const res = await startDonationPayment(deps.payment, donation).catch((err) => {
    console.error("[donation] повтор:", err instanceof Error ? err.message : err);
    return null;
  });
  if (!res || res.kind !== "redirect") {
    await ctx.reply(PAYMENT_UNAVAILABLE_TEXT, { reply_markup: supportKeyboard() });
    return;
  }
  const keyboard = payKeyboard(donation.amount_rub, res.url);
  const edited = await ctx.editMessageReplyMarkup({ reply_markup: keyboard }).then(() => true, () => false);
  if (!edited) await ctx.reply(PAYMENT_FAILED_TEXT, { reply_markup: keyboard });
}

/**
 * Текст, которого ждёт донат: своя сумма или почта. true — сообщение наше.
 * Кнопка меню отменяет ожидание и уходит своему обработчику.
 */
export async function handleDonationText(ctx: BotContext, depsArg?: DonationBotDeps): Promise<boolean> {
  const text = ctx.message?.text;
  const chatId = ctx.from?.id;
  if (ctx.chat?.type !== "private" || !text || text.startsWith("/") || chatId === undefined) return false;

  // Этот хендлер смотрит каждое сообщение: сбой базы или env не должен ломать
  // остальной бот, поэтому любая ошибка здесь — «сообщение не наше».
  let deps: DonationBotDeps;
  let draft;
  try {
    deps = depsArg ?? defaultDonationDeps();
    draft = await deps.drafts.get(chatId);
  } catch (err) {
    console.error("[donation] черновик:", err instanceof Error ? err.message : err);
    return false;
  }
  if (!draft) return false;

  if ((MENU_LABELS as readonly string[]).includes(text.trim())) {
    await deps.drafts.clear(chatId).catch(() => {});
    return false;
  }

  const context: DonationContext = { source: draft.source, event_kind: draft.event_kind, event_ref: draft.event_ref };
  if (draft.step === "amount") {
    const amount = parseDonationAmount(text);
    if (!amount) {
      await ctx.reply(BAD_AMOUNT_TEXT);
      return true;
    }
    await deps.drafts.clear(chatId).catch(() => {});
    await proceedWithAmount(ctx, amount, context, deps, false);
    return true;
  }

  const email = normalizeEmail(text);
  if (!email || !draft.amount_rub) {
    await ctx.reply(BAD_EMAIL_TEXT);
    return true;
  }
  await deps.drafts.clear(chatId).catch(() => {});
  await createAndPay(ctx, draft.amount_rub, email, context, deps, false);
  return true;
}

/** Сообщение в бот после вебхука ЮKassa. */
export async function notifyDonation(donation: Donation, event: "paid" | "canceled"): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN;
  if (!donation.tg_chat_id || !token) return;
  const api = new Api(token);
  if (event === "paid") {
    await api.sendMessage(donation.tg_chat_id, THANKS_TEXT);
    return;
  }
  await api.sendMessage(donation.tg_chat_id, PAYMENT_FAILED_TEXT, { reply_markup: retryKeyboard(donation.amount_rub, donation.id) });
}

// ── /done: организатор закрывает событие ─────────────────────────────────────

export const DONE_CALLBACK_RE = /^d(n|g):([ck]):([a-z0-9_-]{1,32}:\d{4}-\d{2}-\d{2})$|^dx$/;

function isDoneAllowed(ctx: BotContext, env?: Record<string, string | undefined>): boolean {
  const username = normalizeTelegramUsername(ctx.from?.username ?? null);
  return !!username && doneUsernames(env).has(username);
}

const kindCode = (e: FollowupEvent) => (e.kind === "club" ? "k" : "c");

function hhmmMsk(iso: string): string {
  const d = new Date(Date.parse(iso) + 3 * 60 * 60 * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

async function findTodayEvent(code: string, ref: string, deps: DonationBotDeps): Promise<FollowupEvent | null> {
  const events = await todaysEvents(deps.followup, deps.now());
  return events.find((e) => kindCode(e) === code && e.ref === ref) ?? null;
}

export async function handleDoneCommand(ctx: BotContext, deps: DonationBotDeps = defaultDonationDeps()): Promise<void> {
  console.log(`[done] /done от ${ctx.from?.id} @${ctx.from?.username ?? "—"}`);
  if (!isDoneAllowed(ctx, deps.followup.env)) {
    // Для остальных — как любая незнакомая команда: не выдаём, что она есть.
    await ctx.reply(UNKNOWN_INPUT_TEXT, { reply_markup: menuKeyboard() });
    return;
  }
  if (!afterEventEnabled(deps.followup.env)) {
    await ctx.reply(DONE_DISABLED_TEXT);
    return;
  }
  const now = deps.now();
  try {
    const events = (await todaysEvents(deps.followup, now))
      .filter((e) => startedToday(e, now))
      .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime());
    if (events.length === 0) {
      await ctx.reply(DONE_NOTHING_TEXT);
      return;
    }
    const lines: string[] = [DONE_LIST_TEXT];
    const keyboard = new InlineKeyboard();
    let buttons = 0;
    for (const event of events) {
      const state = await deps.followup.followup(event.ref);
      if (state) {
        lines.push("", doneAlreadyText(event.title, hhmmMsk(state.started_at), state.sent_count));
        continue;
      }
      const count = (await recipientsFor(event, deps.followup, now)).length;
      if (buttons > 0) keyboard.row();
      keyboard.text(doneEventLine(event.title, count), `dn:${kindCode(event)}:${event.ref}`);
      buttons++;
    }
    await ctx.reply(lines.join("\n"), buttons ? { reply_markup: keyboard } : undefined);
  } catch (err) {
    console.error("[done] список:", err instanceof Error ? err.message : err);
    await ctx.reply(DONE_FAILED_TEXT);
  }
}

export async function handleDoneCallback(ctx: BotContext, deps: DonationBotDeps = defaultDonationDeps()): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  console.log(`[done] кнопка ${ctx.callbackQuery?.data} от ${ctx.from?.id} @${ctx.from?.username ?? "—"}`);
  if (!isDoneAllowed(ctx, deps.followup.env)) return;
  const m = DONE_CALLBACK_RE.exec(ctx.callbackQuery?.data ?? "");
  if (!m) return;
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  if (!m[1]) {
    await ctx.reply(DONE_CANCELLED_TEXT);
    return;
  }
  const now = deps.now();
  try {
    const event = await findTodayEvent(m[2], m[3], deps);
    if (!event) {
      await ctx.reply(DONE_NOTHING_TEXT);
      return;
    }
    const state = await deps.followup.followup(event.ref);
    if (state) {
      await ctx.reply(doneAlreadyText(event.title, hhmmMsk(state.started_at), state.sent_count));
      return;
    }
    if (m[1] === "n") {
      const count = (await recipientsFor(event, deps.followup, now)).length;
      await ctx.reply(doneConfirmText(event.title, count), {
        reply_markup: new InlineKeyboard()
          .text(DONE_SEND_LABEL, `dg:${kindCode(event)}:${event.ref}`)
          .text(DONE_CANCEL_LABEL, "dx"),
      });
      return;
    }
    const res = await runFollowup(event, "done", ctx.from?.id ?? null, deps.followup, now);
    if (res.kind === "disabled") await ctx.reply(DONE_DISABLED_TEXT);
    else if (res.kind === "night") await ctx.reply(DONE_NIGHT_TEXT);
    else if (res.kind === "already") {
      await ctx.reply(doneAlreadyText(event.title, res.state ? hhmmMsk(res.state.started_at) : "—", res.state?.sent_count ?? 0));
    } else await ctx.reply(doneSentText(event.title, res.sent));
  } catch (err) {
    console.error("[done] рассылка:", err instanceof Error ? err.message : err);
    await ctx.reply(DONE_FAILED_TEXT);
  }
}

// ── /donations: сводка для организатора ──────────────────────────────────────

export function summarizeDonations(rows: Array<{ amount_rub: number; source: string; paid_at: string }>, now: Date) {
  return [7, 30].map((days) => {
    const since = now.getTime() - days * 86_400_000;
    const inRange = rows.filter((r) => Date.parse(r.paid_at) >= since);
    const bySource: Record<string, { total: number; count: number }> = {};
    for (const r of inRange) {
      const s = (bySource[r.source] ??= { total: 0, count: 0 });
      s.total += r.amount_rub;
      s.count++;
    }
    return { days, total: inRange.reduce((sum, r) => sum + r.amount_rub, 0), count: inRange.length, bySource };
  });
}

export async function handleDonationsCommand(ctx: BotContext, deps: DonationBotDeps = defaultDonationDeps()): Promise<void> {
  const chatId = ctx.chat?.id;
  // Как остальные команды организатора: незнакомому чату не отвечаем вовсе.
  if (chatId === undefined || !isAdminChat(chatId)) return;
  const now = deps.now();
  try {
    const rows = await deps.paidSince(new Date(now.getTime() - 30 * 86_400_000).toISOString());
    await ctx.reply(donationsSummaryText(summarizeDonations(rows, now)));
  } catch (err) {
    console.error("[donations] сводка:", err instanceof Error ? err.message : err);
    await ctx.reply(DONATIONS_DB_DOWN);
  }
}
