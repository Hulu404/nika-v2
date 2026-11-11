import { InlineKeyboard } from "grammy";
import { CUSTOM_AMOUNT_LABEL, DONATION_AMOUNTS, amountLabel, payLabel } from "./donation-copy";
import type { DonationContext } from "../donations/store";

/**
 * Кнопки донатов и разбор их callback_data. Отдельно от хендлеров, чтобы
 * рассылка после события (lib/donations) и бот собирали одни и те же кнопки.
 *
 *   don:<сумма|c>:m                  — экран «Поддержать» из меню;
 *   don:<сумма|c>:c:<spot>:<date>    — после кофе-рана;
 *   don:<сумма|c>:k:<club>:<date>    — после занятия клуба;
 *   donr:<id доната>                 — «Оплатить N ₽» после неудачной оплаты.
 */

export const DONATE_CALLBACK_RE = /^don:(\d{1,5}|c):(m|[ck]:[a-z0-9_-]{1,32}:\d{4}-\d{2}-\d{2})$/;
export const DONATE_RETRY_CALLBACK_RE = /^donr:([0-9a-f-]{36})$/i;

function contextCode(ctx: DonationContext): string {
  if (ctx.source === "menu" || !ctx.event_ref) return "m";
  return `${ctx.event_kind === "club" ? "k" : "c"}:${ctx.event_ref}`;
}

export function parseDonateCallback(data: string): { amount: number | "custom"; context: DonationContext } | null {
  const m = DONATE_CALLBACK_RE.exec(data);
  if (!m) return null;
  const amount = m[1] === "c" ? "custom" : Number(m[1]);
  if (m[2] === "m") return { amount, context: { source: "menu", event_kind: null, event_ref: null } };
  const [kind, ...ref] = m[2].split(":");
  return {
    amount,
    context: { source: "after_event", event_kind: kind === "k" ? "club" : "coffee_run", event_ref: ref.join(":") },
  };
}

/** 200 ₽ · 500 ₽ · 1000 ₽ в строку, «Своя сумма» ниже. */
export function amountsKeyboard(ctx: DonationContext): InlineKeyboard {
  const code = contextCode(ctx);
  const kb = new InlineKeyboard();
  for (const amount of DONATION_AMOUNTS) kb.text(amountLabel(amount), `don:${amount}:${code}`);
  return kb.row().text(CUSTOM_AMOUNT_LABEL, `don:c:${code}`);
}

export function payKeyboard(amount: number, url: string): InlineKeyboard {
  return new InlineKeyboard().url(payLabel(amount), url);
}

export function retryKeyboard(amount: number, donationId: string): InlineKeyboard {
  return new InlineKeyboard().text(payLabel(amount), `donr:${donationId}`);
}
