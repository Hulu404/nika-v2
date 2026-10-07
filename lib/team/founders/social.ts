import type { Context } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import { mskHour, mskToday } from "../../databot/time";
import { openTeamForm, teamFormExpired, type TeamFormStore } from "../form";
import {
  FOLLOWERS_JUMP,
  IG_ASK_FORM_TTL_MS,
  INSTAGRAM_OWNER_SETTING,
  SOCIAL_DAILY_HOUR,
} from "./constants";
import type { Platform, Snapshot, SocialStore } from "./social-store";

/**
 * Подписчики соцсетей — всё через «Пятницу».
 *
 * Telegram-канал (NIKA_TG_CHANNEL) снимается сам: getChatMemberCount токеном
 * «Пятницы»; бот должен быть администратором канала без права публикации.
 * Снимок — перед каждой сводкой фаундерам и раз в сутки в 21:00 МСК.
 *
 * Instagram вносят люди: в 21:00 МСК бот спрашивает ответственного
 * (team_settings instagram_owner_chat_id), а пока его нет — фаундеров, и ждёт
 * число следующим сообщением. Если за сегодня число уже есть, не спрашивает.
 * Внести число может и любой участник кнопкой «Внести Instagram» в /social.
 */

// ── Числа ────────────────────────────────────────────────────────────────────

/** «3 870», «3870», «3.870», «3,870» → 3870. Дробное и мусор → null. */
export function parseFollowers(text: string): number | null {
  const raw = text.trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  // Разделитель тысяч — пробел (в том числе неразрывный), точка или запятая,
  // и только между группами по три цифры: «38 70» — не число, а опечатка.
  if (/^\d{1,3}([\s  .,]\d{3})+$/.test(raw)) return Number(raw.replace(/\D/g, ""));
  return null;
}

/** Разница с прошлым снимком больше 20% — похоже на опечатку, переспрашиваем. */
export function isSuspiciousJump(prev: number | null | undefined, next: number): boolean {
  if (prev === null || prev === undefined || prev <= 0) return false;
  return Math.abs(next - prev) / prev > FOLLOWERS_JUMP;
}

/** «1 240». */
export function formatNumber(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

// ── Telegram-канал ───────────────────────────────────────────────────────────

export function telegramChannel(): string | null {
  const raw = (process.env.NIKA_TG_CHANNEL ?? "").trim();
  if (!raw) return null;
  return raw.startsWith("@") || raw.startsWith("-") ? raw : `@${raw}`;
}

export interface SocialDeps {
  store: SocialStore;
  forms: TeamFormStore;
  send: (chatId: number, text: string, keyboard?: InlineKeyboardMarkup) => Promise<unknown>;
  memberCount: (channel: string) => Promise<number>;
  founders: () => number[];
}

/** Снять подписчиков канала. Ошибка не бросается: сводка напишет «не удалось получить». */
export async function snapshotTelegram(deps: Pick<SocialDeps, "store" | "memberCount">, now: Date): Promise<number | null> {
  const channel = telegramChannel();
  if (!channel) return null;
  try {
    const followers = await deps.memberCount(channel);
    await deps.store.addSnapshot({ platform: "telegram", followers, source: "auto", entered_by: null }, now);
    return followers;
  } catch (err) {
    console.error("[founders] tg snapshot:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

export function takenToday(s: Snapshot | null, now: Date): boolean {
  return !!s && mskToday(new Date(s.taken_at)) === mskToday(now);
}

// ── Вопрос в 21:00 ───────────────────────────────────────────────────────────

export const IG_QUESTION = "Сколько сейчас подписчиков в Instagram?";
export const SOCIAL_CB = { enter: "so:ig", yes: (n: number) => `so:yes:${n}`, fix: "so:fix" };
const enterKeyboard = (): InlineKeyboardMarkup => ({ inline_keyboard: [[{ text: "Внести", callback_data: SOCIAL_CB.enter }]] });

/** Кого спрашивать про Instagram: назначенного ответственного, а пока его нет — фаундеров. */
export async function instagramRecipients(deps: Pick<SocialDeps, "store" | "founders">): Promise<number[]> {
  const owner = Number(await deps.store.getSetting(INSTAGRAM_OWNER_SETTING));
  return Number.isFinite(owner) && owner !== 0 ? [owner] : deps.founders();
}

/**
 * Ежедневное в 21:00 МСК: снимок Telegram-канала и вопрос про Instagram.
 * Оба — один раз в день (отметка в team_digests). Вопрос не задаётся, если
 * число за сегодня уже внесено.
 */
export async function dispatchSocialDaily(deps: SocialDeps, now: Date): Promise<string[]> {
  if (mskHour(now) < SOCIAL_DAILY_HOUR) return [];
  const ymd = mskToday(now);
  const done: string[] = [];
  if (telegramChannel() && (await deps.store.claim("social_daily", "telegram", ymd))) {
    await snapshotTelegram(deps, now);
    done.push("tg_snapshot");
  }
  if (takenToday(await deps.store.latest("instagram"), now)) return done;
  if (!(await deps.store.claim("ig_ask", "instagram", ymd))) return done;
  for (const chatId of await instagramRecipients(deps)) {
    await deps.forms.set(chatId, openTeamForm("social.ig", {}, now, IG_ASK_FORM_TTL_MS), now).catch(() => {});
    await Promise.resolve(deps.send(chatId, `${IG_QUESTION} Пришли число следующим сообщением.`, enterKeyboard())).catch(() => {});
  }
  done.push("ig_ask");
  return done;
}

// ── Ответ ────────────────────────────────────────────────────────────────────

export async function saveInstagram(store: SocialStore, followers: number, by: number, now: Date): Promise<void> {
  await store.addSnapshot({ platform: "instagram", followers, source: "manual", entered_by: by }, now);
}

/** Открыть приём числа: кнопка «Внести» под вопросом или «Внести Instagram» в /social. */
export async function askInstagram(ctx: Context, forms: TeamFormStore, now: Date): Promise<void> {
  await forms.set(ctx.from!.id, openTeamForm("social.ig", {}, now), now);
  await ctx.reply(`${IG_QUESTION} Пришли число, например 3 870. Отмена: /cancel.`);
}

/**
 * Число Instagram следующим сообщением и кнопки «Да» / «Исправить» после
 * проверки на 20%. Вносить может любой участник команды (членство проверяет
 * вызывающий). false — апдейт не про Instagram.
 */
export async function handleInstagramInput(
  ctx: Context,
  deps: Pick<SocialDeps, "store" | "forms">,
  now: Date,
): Promise<boolean> {
  const uid = ctx.from!.id;
  const data = ctx.callbackQuery?.data ?? "";
  if (data === SOCIAL_CB.enter || data === SOCIAL_CB.fix) {
    await askInstagram(ctx, deps.forms, now);
    return true;
  }
  if (data.startsWith("so:yes:")) {
    const n = Number(data.slice("so:yes:".length));
    if (!Number.isInteger(n) || n < 0) return true;
    await deps.forms.clear(uid);
    await saveInstagram(deps.store, n, uid, now);
    await ctx.reply(`Записала: Instagram ${formatNumber(n)}.`);
    return true;
  }

  const text = ctx.message?.text?.trim() ?? "";
  if (!text || text.startsWith("/")) return false;
  const form = await deps.forms.get(uid);
  if (form?.kind !== "social.ig") return false;
  if (teamFormExpired(form, now)) {
    await deps.forms.clear(uid);
    await ctx.reply("Форма устарела. Открой /social и нажми «Внести Instagram».");
    return true;
  }
  const n = parseFollowers(text);
  if (n === null) {
    await ctx.reply("Нужно целое число подписчиков, например 3 870. Отмена: /cancel.");
    return true;
  }
  const prev = await deps.store.latest("instagram");
  if (isSuspiciousJump(prev?.followers, n)) {
    await deps.forms.set(uid, openTeamForm("social.ig", { pending: String(n) }, now), now);
    await ctx.reply(`Было ${formatNumber(prev!.followers)}, ты вводишь ${formatNumber(n)}. Верно?`, {
      reply_markup: { inline_keyboard: [[{ text: "Да", callback_data: SOCIAL_CB.yes(n) }, { text: "Исправить", callback_data: SOCIAL_CB.fix }]] },
    });
    return true;
  }
  await deps.forms.clear(uid);
  await saveInstagram(deps.store, n, uid, now);
  await ctx.reply(`Записала: Instagram ${formatNumber(n)}.`);
  return true;
}

export type { Platform };
