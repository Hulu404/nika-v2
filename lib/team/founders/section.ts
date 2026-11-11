import { InlineKeyboard, type Context } from "grammy";
import { fetchTraffic, type TrafficRow } from "../../databot/data/traffic";
import { periodFromCode } from "../../databot/dates";
import { findMember, listTeam, type TeamMember } from "../access";
import { canSeeSocial } from "../config";
import { escapeHtmlTeam, type TaskScreen } from "../copy";
import { supabaseTeamForms, type TeamFormStore } from "../form";
import type { FounderDigestDeps } from "./digest";
import { formatNumber, handleInstagramInput, telegramChannel } from "./social";
import { supabaseSocialStore, type Platform, type Snapshot, type SocialStore } from "./social-store";

/**
 * Раздел «Соцсети» в «Пятнице» (/social). Только для ников из
 * TEAM_SOCIAL_USERNAMES (по умолчанию @srbrkvss, lib/team/config.ts):
 * остальным раздел не виден, команда отвечает как на раздел, которого нет.
 * Instagram вносит он же кнопкой «Внести Instagram».
 *
 * Экран: подписчики Telegram-канала и Instagram с приростом за сутки, неделю и
 * месяц, переходы по меткам (RPC databot_traffic) за выбранный период.
 */

export interface SocialSectionDeps {
  store: SocialStore;
  forms: TeamFormStore;
  fetchTraffic: (from: Date, to: Date) => Promise<TrafficRow[]>;
  findMember: (chatId: number) => Promise<TeamMember | null>;
  listTeam: () => Promise<TeamMember[]>;
  /** Задачи всей команды для «Сводки сейчас». */
  tasks: FounderDigestDeps["tasks"];
}

export function defaultSocialSectionDeps(): SocialSectionDeps {
  return {
    store: supabaseSocialStore(),
    forms: supabaseTeamForms(),
    fetchTraffic,
    findMember,
    listTeam,
    tasks: async (since) => {
      const { createSupabaseStore } = await import("../../databot/data/supabase-store");
      return createSupabaseStore().listAssignedOverview(since);
    },
  };
}

const DAY = 24 * 3_600_000;
const PERIODS = [
  { code: "7d", label: "7 дней" },
  { code: "pw", label: "Прошлая неделя" },
  { code: "tm", label: "Этот месяц" },
  { code: "30d", label: "30 дней" },
] as const;
const DEFAULT_PERIOD = "7d";
const CHANNEL_LABELS: Record<string, string> = {
  instagram: "Instagram", telegram: "Telegram", vk: "ВКонтакте", offline: "Офлайн", partner: "Партнёры", other: "Другие",
};
const TOP_CODES = 5;
const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

export const SOCIAL_CALLBACK_RE = /^so:(p|ig|yes|fix)(?::([a-z0-9]+))?$/;

const ddmm = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit" }).format(new Date(iso));
const ddmmYmd = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;

function diff(latest: Snapshot, ref: Snapshot | null, label: string): string {
  if (!ref) return `нет данных за ${label}`;
  const d = latest.followers - ref.followers;
  return `${d >= 0 ? "+" : "-"}${formatNumber(Math.abs(d))} за ${label}`;
}

async function followersLine(store: SocialStore, platform: Platform, now: Date): Promise<string> {
  const name = platform === "telegram" ? "TG-канал" : "Instagram";
  const [latest, day, week, month] = await Promise.all([
    store.latest(platform),
    store.latestAtOrBefore(platform, new Date(now.getTime() - DAY)),
    store.latestAtOrBefore(platform, new Date(now.getTime() - 7 * DAY)),
    store.latestAtOrBefore(platform, new Date(now.getTime() - 30 * DAY)),
  ]);
  if (!latest) {
    if (platform === "telegram") return `${name}: снимков пока нет${telegramChannel() ? "" : " (не задан NIKA_TG_CHANNEL)"}`;
    return `${name}: ещё ни разу не вносили`;
  }
  const growth = [diff(latest, day, "сутки"), diff(latest, week, "неделю"), diff(latest, month, "месяц")].join(", ");
  const last = platform === "instagram" ? `, последний снимок ${ddmm(latest.taken_at)}` : "";
  return `${name}: <b>${formatNumber(latest.followers)}</b>\n  ${growth}${last}`;
}

export function trafficLines(rows: readonly TrafficRow[]): string[] {
  const sum = (key: "clicks" | "visitors" | "signupsCoffeerun" | "signupsApp", list: readonly TrafficRow[] = rows) =>
    list.reduce((s, r) => s + r[key], 0);
  if (!sum("clicks")) return ["Переходов по меткам за период нет"];
  const lines = [
    `Переходы по меткам: ${formatNumber(sum("clicks"))}, уникальных ${formatNumber(sum("visitors"))}`,
    `Из них заявок на кофе-ран ${formatNumber(sum("signupsCoffeerun"))}, регистраций ${formatNumber(sum("signupsApp"))}`,
  ];
  const byChannel = new Map<string, TrafficRow[]>();
  for (const r of rows) byChannel.set(r.channel ?? "other", [...(byChannel.get(r.channel ?? "other") ?? []), r]);
  for (const [channel, list] of [...byChannel].sort(([, a], [, b]) => sum("clicks", b) - sum("clicks", a))) {
    if (!sum("clicks", list)) continue;
    lines.push(`${escapeHtmlTeam(CHANNEL_LABELS[channel] ?? channel)}: ${formatNumber(sum("clicks", list))} переходов, ` +
      `${formatNumber(sum("signupsCoffeerun", list))} заявок, ${formatNumber(sum("signupsApp", list))} регистраций`);
  }
  for (const r of [...rows].filter((x) => x.clicks > 0).sort((a, b) => b.clicks - a.clicks).slice(0, TOP_CODES)) {
    lines.push(`Метка ${escapeHtmlTeam(r.code)}${r.label ? ` (${escapeHtmlTeam(r.label.slice(0, 60))})` : ""}: ${formatNumber(r.clicks)} переходов`);
  }
  return lines;
}

/**
 * Почему блок не загрузился — словами, а не «попробуй позже». Чаще всего это
 * не применённая миграция: таблицы ещё нет, и ждать бессмысленно.
 */
export function blockError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const table = /(social_snapshots|team_settings)/.exec(msg)?.[1];
  if (table && /does not exist|could not find|schema cache|relation/i.test(msg)) {
    return `нет таблицы ${table}: примени миграцию 049_social_snapshots.sql в Supabase`;
  }
  if (/databot_traffic/.test(msg) && /does not exist|could not find|schema cache|function/i.test(msg)) {
    return "нет функции databot_traffic: примени миграцию 037_databot.sql";
  }
  return "не удалось получить, ошибка записана в логи сервера";
}

/** Один блок экрана: его ошибка не роняет остальные. */
async function safe<T>(label: string, work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await work() };
  } catch (err) {
    console.error(`[team-social] ${label}:`, err instanceof Error ? err.message : String(err));
    return { ok: false, error: blockError(err) };
  }
}

export async function socialScreen(deps: SocialSectionDeps, uid: number, code: string, now: Date): Promise<TaskScreen> {
  const period = periodFromCode(code, now) ?? periodFromCode(DEFAULT_PERIOD, now)!;
  const [tg, ig, traffic] = await Promise.all([
    safe("tg", () => followersLine(deps.store, "telegram", now)),
    safe("ig", () => followersLine(deps.store, "instagram", now)),
    safe("traffic", () => deps.fetchTraffic(period.from, period.to)),
  ]);
  const text = [
    "<b>Соцсети</b>",
    "",
    tg.ok ? tg.value : `TG-канал: ${tg.error}`,
    ig.ok ? ig.value : `Instagram: ${ig.error}`,
    "",
    `<b>Метки и переходы</b> · ${ddmmYmd(period.fromYmd)}–${ddmmYmd(period.toYmd)}`,
    ...(traffic.ok ? trafficLines(traffic.value) : [`Переходы: ${traffic.error}`]),
  ].join("\n");
  const kb = new InlineKeyboard();
  PERIODS.forEach((p, i) => {
    kb.text(`${p.code === code ? "✓ " : ""}${p.label}`, `so:p:${p.code}`);
    if (i % 2 === 1) kb.row();
  });
  kb.text("Внести Instagram", "so:ig").row();
  return { text, keyboard: kb };
}

async function show(ctx: Context, screen: TaskScreen, edit: boolean): Promise<void> {
  const opts = { ...HTML, reply_markup: screen.keyboard };
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(screen.text, opts);
      return;
    } catch (err) {
      if ((err instanceof Error ? err.message : String(err)).includes("message is not modified")) return;
    }
  }
  await ctx.reply(screen.text, opts);
}

const SOCIAL_COMMAND = /^\/social(?:@([a-z0-9_]+))?(?=\s|$)/i;

export async function handleSocialSectionUpdate(ctx: Context, providedDeps?: SocialSectionDeps, now = new Date()): Promise<boolean> {
  if (ctx.chat?.type !== "private" || !ctx.from || ctx.chat.id !== ctx.from.id) return false;
  const text = ctx.message?.text?.trim() ?? "";
  const command = SOCIAL_COMMAND.exec(text);
  if (command?.[1] && ctx.me?.username && command[1].toLowerCase() !== ctx.me.username.toLowerCase()) return false;
  const cb = SOCIAL_CALLBACK_RE.exec(ctx.callbackQuery?.data ?? "");
  const isFreeText = !!text && !text.startsWith("/");
  if (!command && !cb && !isFreeText) return false;

  const deps = providedDeps ?? defaultSocialSectionDeps();
  const uid = ctx.from.id;
  if (isFreeText) {
    const form = await deps.forms.get(uid);
    if (form?.kind !== "social.ig") return false;
  }
  if (cb) await ctx.answerCallbackQuery().catch(() => {});
  // Раздел только для своих ников (TEAM_SOCIAL_USERNAMES). Остальным — как
  // раздел, которого в проекте нет, без намёка, что он существует.
  if (!canSeeSocial(ctx.from.username)) {
    if (!command) return false;
    await ctx.reply("В этом проекте такого раздела нет.");
    return true;
  }

  try {
    if (command) {
      await show(ctx, await socialScreen(deps, uid, DEFAULT_PERIOD, now), false);
      return true;
    }
    if (isFreeText) return await handleInstagramInput(ctx, deps, now);
    const [, op, arg] = cb!;
    if (op === "p") {
      await show(ctx, await socialScreen(deps, uid, PERIODS.some((p) => p.code === arg) ? arg! : DEFAULT_PERIOD, now), true);
      return true;
    }
    // so:ig / so:yes:<число> / so:fix разбирает handleInstagramInput по полному callback_data.
    return await handleInstagramInput(ctx, deps, now);
  } catch (err) {
    console.error("[team-social]", err instanceof Error ? err.message : String(err));
    await ctx.reply(`Не получилось: ${blockError(err)}.`);
    return true;
  }
}
