import { can } from "../access";
import { cb } from "../callback";
import { answerText, pageScreen } from "../copy";
import { fetchTraffic, type TrafficRow } from "../data/traffic";
import { periodFromCode, type Period } from "../dates";
import { escapeHtml, formatInt, formatPeriodRange } from "../format";
import { listTeam, type TeamMember } from "../../team/access";
import { founderIds } from "../../team/config";
import { INSTAGRAM_OWNER_SETTING } from "../founders/constants";
import { buildFounderDigestNow } from "../founders/digest";
import { formatNumber, supabaseSocialForms, telegramChannel, type SocialFormStore } from "../founders/social";
import { supabaseSocialStore, type Platform, type Snapshot, type SocialStore } from "../founders/social-store";
import type { SectionHandler, SectionRequest } from "../section";
import type { InlineButton, Screen } from "../types";
import { isPage } from "../validate";
import { SUMMARY_PERIODS, isSummaryPeriod } from "./summaries";

/**
 * Раздел «Соцсети» (только фаундеры): подписчики Telegram-канала и Instagram
 * с приростом, переходы по меткам за период (RPC databot_traffic), кнопки
 * «Внести Instagram», «Кто вносит Instagram» и «Сводка сейчас».
 */

export interface SocialSectionDeps {
  social: () => SocialStore;
  forms: () => SocialFormStore;
  fetchTraffic: (from: Date, to: Date) => Promise<TrafficRow[]>;
  team: () => Promise<TeamMember[]>;
  founders: () => number[];
}

const DEFAULT_DEPS: SocialSectionDeps = {
  social: supabaseSocialStore,
  forms: supabaseSocialForms,
  fetchTraffic,
  team: listTeam,
  founders: () => [...founderIds()],
};

const DAY = 24 * 3_600_000;
const PERIOD_LABELS = ["7 дней", "Прошлая неделя", "Этот месяц", "30 дней"];
const DEFAULT_PERIOD = "7d";
const CHANNEL_LABELS: Record<string, string> = {
  instagram: "Instagram", telegram: "Telegram", vk: "ВКонтакте", offline: "Офлайн", partner: "Партнёры", other: "Другие",
};
const TOP_CODES = 5;

const ddmm = (iso: string) => {
  const d = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit" }).format(new Date(iso));
  return d;
};

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
  const last = platform === "instagram" ? ` · последний снимок ${ddmm(latest.taken_at)}` : "";
  return `${name}: ${formatNumber(latest.followers)} · ${growth}${last}`;
}

export function trafficLines(rows: readonly TrafficRow[]): string[] {
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  if (!clicks) return ["Переходов по меткам за период нет"];
  const sum = (key: "clicks" | "visitors" | "signupsCoffeerun" | "signupsApp", list = rows) => list.reduce((s, r) => s + r[key], 0);
  const lines = [
    `Переходы по меткам: ${formatInt(clicks)}, уникальных ${formatInt(sum("visitors"))}`,
    `Из них заявок на кофе-ран ${formatInt(sum("signupsCoffeerun"))}, регистраций ${formatInt(sum("signupsApp"))}`,
  ];
  const byChannel = new Map<string, TrafficRow[]>();
  for (const r of rows) byChannel.set(r.channel ?? "other", [...(byChannel.get(r.channel ?? "other") ?? []), r]);
  for (const [channel, list] of [...byChannel].sort(([, a], [, b]) => sum("clicks", b) - sum("clicks", a))) {
    if (!sum("clicks", list)) continue;
    lines.push(`${escapeHtml(CHANNEL_LABELS[channel] ?? channel)}: ${formatInt(sum("clicks", list))} переходов, ` +
      `${formatInt(sum("signupsCoffeerun", list))} заявок, ${formatInt(sum("signupsApp", list))} регистраций`);
  }
  for (const r of [...rows].filter((x) => x.clicks > 0).sort((a, b) => b.clicks - a.clicks).slice(0, TOP_CODES)) {
    lines.push(`Метка ${escapeHtml(r.code)}${r.label ? ` (${escapeHtml(r.label.slice(0, 60))})` : ""}: ${formatInt(r.clicks)} переходов`);
  }
  return lines;
}

function socialScreen(period: Period, code: string, page: number, details: string[], now: Date): Screen {
  const headline = `<b>Соцсети</b> · ${formatPeriodRange(period.fromYmd, period.toYmd)} · МСК`;
  const pages: string[] = [];
  let chunk: string[] = [];
  for (const line of details) {
    if (chunk.length && (chunk.length === 8 || answerText({ headline, details: [...chunk, line], at: now }).length > 4000)) {
      pages.push(answerText({ headline, details: chunk, at: now }));
      chunk = [];
    }
    chunk.push(line);
  }
  pages.push(answerText({ headline, details: chunk, at: now }));
  const periods = SUMMARY_PERIODS.map((p, i) => ({ text: `${p === code ? "✓ " : ""}${PERIOD_LABELS[i]}`, data: cb("tr", "summary", p) }));
  return pageScreen(pages, page - 1, (next) => cb("tr", "summary", code, next + 1), [
    periods.slice(0, 2), periods.slice(2),
    [{ text: "Внести Instagram", data: cb("tr", "ig") }, { text: "Кто вносит Instagram", data: cb("tr", "own") }],
    [{ text: "Сводка сейчас", data: cb("tr", "dig") }],
    [{ text: "В меню", data: cb("tr", "home") }],
  ]);
}

const back = (): InlineButton[][] => [[{ text: "← К соцсетям", data: cb("tr", "summary", DEFAULT_PERIOD) }]];

async function ownerName(req: SectionRequest, store: SocialStore): Promise<string> {
  const raw = await store.getSetting(INSTAGRAM_OWNER_SETTING);
  if (!raw) return "фаундеры (ответственный не назначен)";
  const m = await req.store.findMember(Number(raw)).catch(() => null);
  return m?.username ? `@${escapeHtml(m.username)}` : m?.display_name ? escapeHtml(m.display_name) : `chat_id ${escapeHtml(raw)}`;
}

export function createSocialHandler(deps: SocialSectionDeps = DEFAULT_DEPS): SectionHandler {
  return async (req) => {
    const { intent, now, subject } = req;
    const report = intent.report;
    if (report !== "tr.section" && report !== "tr.ig" && report !== "tr.owner" && report !== "tr.digest") return { kind: "stale" };
    if (!can(subject, report)) return { kind: "forbidden" };
    const store = deps.social();

    if (intent.report === "tr.ig") {
      await deps.forms().set(subject.chatId, { expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString() }, now);
      return { kind: "screens", screens: [{ text: "Сколько сейчас подписчиков в Instagram? Пришли число, например 3 870. Отмена: /cancel." }] };
    }

    if (intent.report === "tr.owner") {
      const target = intent.params.target;
      if (target === undefined) {
        const members = (await req.store.listMembers()).filter((m) => m.username || m.display_name).slice(0, 30);
        const buttons: InlineButton[][] = members.map((m) => [{
          text: m.username ? `@${m.username}` : (m.display_name ?? String(m.chat_id)), data: cb("tr", "own", m.chat_id),
        }]);
        buttons.push([{ text: "Никто, спрашивать фаундеров", data: cb("tr", "own", "0") }], ...back());
        return { kind: "screens", screens: [{ text: `Кто вносит Instagram? Сейчас: ${await ownerName(req, store)}.\nВ 21:00 МСК бот спросит этого человека.`, buttons }] };
      }
      await store.setSetting(INSTAGRAM_OWNER_SETTING, target === "0" ? null : target, subject.chatId, now);
      return { kind: "screens", screens: [{ text: `Готово. Instagram вносит: ${await ownerName(req, store)}.`, buttons: back() }] };
    }

    if (intent.report === "tr.digest") {
      const text = await buildFounderDigestNow({
        tasks: (since) => req.store.listAssignedOverview(since),
        team: deps.team,
        founders: deps.founders,
        social: store,
      }, now);
      return { kind: "screens", screens: [{ text: escapeHtml(text), buttons: back() }] };
    }

    if (intent.report !== "tr.section") return { kind: "stale" };
    const code = intent.params.period ?? DEFAULT_PERIOD;
    const page = intent.params.page ?? "1";
    if (!isSummaryPeriod(code) || !isPage(page)) return { kind: "stale" };
    const period = periodFromCode(code, now)!;
    const [tg, ig, owner, traffic] = await Promise.all([
      followersLine(store, "telegram", now),
      followersLine(store, "instagram", now),
      ownerName(req, store),
      deps.fetchTraffic(period.from, period.to),
    ]);
    const details = [tg, ig, `Кто вносит Instagram: ${owner}`, ...trafficLines(traffic)];
    return { kind: "screens", screens: [socialScreen(period, code, Number(page), details, now)] };
  };
}

export const handleSocial = createSocialHandler();
