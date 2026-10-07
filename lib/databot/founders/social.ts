import type { Context, MiddlewareFn } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import { founderIds } from "../../team/config";
import { tgAdmin } from "../../telegram/supabase";
import { mskHour, mskToday } from "../time";
import {
  FOLLOWERS_JUMP,
  IG_ASK_FORM_TTL_MS,
  INSTAGRAM_OWNER_SETTING,
  SOCIAL_DAILY_HOUR,
} from "./constants";
import { supabaseSocialStore, type Platform, type Snapshot, type SocialStore } from "./social-store";

/**
 * Подписчики соцсетей.
 *
 * Telegram-канал (NIKA_TG_CHANNEL) снимается сам: getChatMemberCount токеном
 * «Цифр команды»; бот должен быть администратором канала без права публикации.
 * Снимок — перед каждой сводкой фаундерам и раз в сутки в 21:00 МСК.
 *
 * Instagram вносит человек: в 21:00 МСК бот спрашивает ответственного (team_settings
 * instagram_owner_chat_id), а если его нет — фаундеров, и ждёт число следующим
 * сообщением. Если за сегодня число уже есть, не спрашивает.
 */

// ── Числа ────────────────────────────────────────────────────────────────────

/** «3 870», «3870», «3.870», «3,870» → 3870. Дробное и мусор → null. */
export function parseFollowers(text: string): number | null {
  const raw = text.trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  // Разделитель тысяч — пробел (в том числе неразрывный), точка или запятая,
  // и только между группами по три цифры: «38 70» — не число, а опечатка.
  if (/^\d{1,3}([\s\u00a0\u202f.,]\d{3})+$/.test(raw)) return Number(raw.replace(/\D/g, ""));
  return null;
}

/** Разница с прошлым снимком больше 20% — похоже на опечатку, переспрашиваем. */
export function isSuspiciousJump(prev: number | null | undefined, next: number): boolean {
  if (prev === null || prev === undefined || prev <= 0) return false;
  return Math.abs(next - prev) / prev > FOLLOWERS_JUMP;
}

/** «1 240» — с неразрывным узким пробелом не связываемся, обычный пробел читается везде. */
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
  forms: SocialFormStore;
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

// ── Форма «ждём число» ───────────────────────────────────────────────────────
// Свой ключ в tg_sessions (data:social:<chat_id>), отдельно от форм отчётов:
// ответ на вопрос в 21:00 не должен уехать в разбор вопроса.

export interface SocialForm {
  /** Число, которое ждёт подтверждения «Да» после проверки на 20%. */
  pending?: number;
  expiresAt: string;
}

export interface SocialFormStore {
  get(chatId: number): Promise<SocialForm | null>;
  set(chatId: number, form: SocialForm, now: Date): Promise<void>;
  clear(chatId: number): Promise<void>;
}

const formKey = (chatId: number) => `data:social:${chatId}`;

export function supabaseSocialForms(): SocialFormStore {
  return {
    async get(chatId) {
      const { data, error } = await tgAdmin().from("tg_sessions").select("value").eq("key", formKey(chatId)).maybeSingle();
      if (error) throw new Error(`social form: ${error.message}`);
      const v = (data as { value?: SocialForm } | null)?.value;
      return v && typeof v.expiresAt === "string" ? v : null;
    },
    async set(chatId, form, now) {
      const { error } = await tgAdmin().from("tg_sessions")
        .upsert({ key: formKey(chatId), value: form, updated_at: now.toISOString() }, { onConflict: "key" });
      if (error) throw new Error(`social form: ${error.message}`);
    },
    async clear(chatId) {
      const { error } = await tgAdmin().from("tg_sessions").delete().eq("key", formKey(chatId));
      if (error) console.error("[founders] social form clear:", error.message);
    },
  };
}

export class MemorySocialForms implements SocialFormStore {
  forms = new Map<number, SocialForm>();
  async get(chatId: number) {
    return this.forms.get(chatId) ?? null;
  }
  async set(chatId: number, form: SocialForm) {
    this.forms.set(chatId, { ...form });
  }
  async clear(chatId: number) {
    this.forms.delete(chatId);
  }
}

const FORM_TTL_MS = 10 * 60_000;
const openForm = (now: Date, ttl = FORM_TTL_MS, pending?: number): SocialForm =>
  ({ expiresAt: new Date(now.getTime() + ttl).toISOString(), ...(pending !== undefined ? { pending } : {}) });

// ── Вопрос в 21:00 ───────────────────────────────────────────────────────────

export const IG_QUESTION = "Сколько сейчас подписчиков в Instagram?";
export const SOCIAL_CB = { enter: "so:ig", yes: (n: number) => `so:yes:${n}`, fix: "so:fix" };
const enterKeyboard = (): InlineKeyboardMarkup => ({ inline_keyboard: [[{ text: "Внести", callback_data: SOCIAL_CB.enter }]] });

/** Кто вносит Instagram: назначенный ответственный, а пока его нет — фаундеры. */
export async function instagramRecipients(deps: Pick<SocialDeps, "store" | "founders">): Promise<number[]> {
  const owner = Number(await deps.store.getSetting(INSTAGRAM_OWNER_SETTING));
  return Number.isFinite(owner) && owner !== 0 ? [owner] : deps.founders();
}

/** Может ли человек вносить число Instagram: фаундер или назначенный ответственный. */
export async function canEnterInstagram(deps: Pick<SocialDeps, "store" | "founders">, chatId: number): Promise<boolean> {
  if (deps.founders().includes(chatId)) return true;
  return Number(await deps.store.getSetting(INSTAGRAM_OWNER_SETTING)) === chatId;
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
    await deps.forms.set(chatId, openForm(now, IG_ASK_FORM_TTL_MS), now).catch(() => {});
    await deps.send(chatId, `${IG_QUESTION} Пришли число следующим сообщением.`, enterKeyboard()).catch(() => {});
  }
  done.push("ig_ask");
  return done;
}

// ── Ответ ────────────────────────────────────────────────────────────────────

export async function saveInstagram(deps: Pick<SocialDeps, "store">, followers: number, by: number, now: Date): Promise<void> {
  await deps.store.addSnapshot({ platform: "instagram", followers, source: "manual", entered_by: by }, now);
}

/** Открыть приём числа (кнопка «Внести» или «Внести Instagram» в /social). */
export async function askInstagram(ctx: Context, deps: SocialDeps, now: Date): Promise<void> {
  await deps.forms.set(ctx.from!.id, openForm(now), now);
  await ctx.reply(`${IG_QUESTION} Пришли число, например 3 870. Отмена: /cancel.`);
}

/**
 * Кнопки «Внести», «Да», «Исправить» и число следующим сообщением. false —
 * апдейт не про Instagram, его разбирает остальной бот.
 */
export async function handleSocialUpdate(ctx: Context, deps: SocialDeps, now = new Date()): Promise<boolean> {
  if (ctx.chat?.type !== "private" || !ctx.from) return false;
  const uid = ctx.from.id;
  const data = ctx.callbackQuery?.data ?? "";
  const text = ctx.message?.text?.trim() ?? "";

  if (data === SOCIAL_CB.enter || data === SOCIAL_CB.fix || data.startsWith("so:yes:")) {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await canEnterInstagram(deps, uid))) {
      await ctx.reply("Вносить Instagram могут фаундеры и назначенный ответственный.");
      return true;
    }
    if (data.startsWith("so:yes:")) {
      const n = Number(data.slice("so:yes:".length));
      if (!Number.isInteger(n) || n < 0) return true;
      await deps.forms.clear(uid);
      await saveInstagram(deps, n, uid, now);
      await ctx.reply(`Записала: Instagram ${formatNumber(n)}.`);
      return true;
    }
    await askInstagram(ctx, deps, now);
    return true;
  }

  if (!text) return false;
  const form = await deps.forms.get(uid);
  if (!form) return false;
  if (text.startsWith("/")) {
    // Любая команда закрывает форму; /cancel ещё и говорит об этом.
    await deps.forms.clear(uid);
    if (/^\/cancel(?:@\w+)?$/i.test(text)) {
      await ctx.reply("Отменила.");
      return true;
    }
    return false;
  }
  if (Date.parse(form.expiresAt) <= now.getTime()) {
    await deps.forms.clear(uid);
    return false;
  }
  if (!(await canEnterInstagram(deps, uid))) {
    await deps.forms.clear(uid);
    return false;
  }
  const n = parseFollowers(text);
  if (n === null) {
    await ctx.reply("Нужно целое число подписчиков, например 3 870. Отмена: /cancel.");
    return true;
  }
  const prev = await deps.store.latest("instagram");
  if (isSuspiciousJump(prev?.followers, n)) {
    await deps.forms.set(uid, openForm(now, FORM_TTL_MS, n), now);
    await ctx.reply(`Было ${formatNumber(prev!.followers)}, ты вводишь ${formatNumber(n)}. Верно?`, {
      reply_markup: { inline_keyboard: [[{ text: "Да", callback_data: SOCIAL_CB.yes(n) }, { text: "Исправить", callback_data: SOCIAL_CB.fix }]] },
    });
    return true;
  }
  await deps.forms.clear(uid);
  await saveInstagram(deps, n, uid, now);
  await ctx.reply(`Записала: Instagram ${formatNumber(n)}.`);
  return true;
}

export function socialMiddleware(deps: SocialDeps): MiddlewareFn<Context> {
  return async (ctx, next) => {
    try {
      if (await handleSocialUpdate(ctx, deps)) return;
    } catch (err) {
      console.error("[founders] social:", err instanceof Error ? err.message : String(err));
    }
    await next();
  };
}

export function defaultSocialDeps(api: {
  sendMessage: (chatId: number, text: string, other?: { reply_markup?: InlineKeyboardMarkup }) => Promise<unknown>;
  getChatMemberCount: (chatId: string) => Promise<number>;
}): SocialDeps {
  return {
    store: supabaseSocialStore(),
    forms: supabaseSocialForms(),
    send: (chatId, text, keyboard) => api.sendMessage(chatId, text, keyboard ? { reply_markup: keyboard } : {}),
    memberCount: (channel) => api.getChatMemberCount(channel),
    founders: () => [...founderIds()],
  };
}

export type { Platform };
