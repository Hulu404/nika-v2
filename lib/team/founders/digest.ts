import type { InlineKeyboardMarkup } from "grammy/types";
import type { AssignedTask } from "../../databot/task-list";
import { mskMidnight } from "../../databot/dates";
import { addDays, mskToday } from "../../databot/time";
import type { TeamMember } from "../access";
import { AWAY_DAYS, DIGEST_LIST_LIMIT, FOUNDER_DIGEST_SLOTS } from "./constants";
import { formatNumber, takenToday, telegramChannel } from "./social";
import type { Platform, Snapshot, SocialStore } from "./social-store";

/**
 * Сводка фаундерам от «Пятницы»: дважды в день, 10:00 и 22:30 МСК,
 * одним сообщением, только фаундерам. Окно — с прошлой сводки: 10:00
 * охватывает 22:30 прошлого дня – 10:00, 22:30 охватывает 10:00 – 22:30.
 * Тихих часов нет. Дедуп — team_digests с ключом ('founders', слот, дата):
 * повторный деплой не пришлёт сводку дважды.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface DigestSlot {
  key: string;
  /** Московская дата слота. */
  ymd: string;
  at: Date;
  /** Начало окна — момент прошлого слота. */
  from: Date;
}

function slotMoment(ymd: string, hour: number, minute: number): Date {
  return new Date(mskMidnight(ymd).getTime() + (hour * 60 + minute) * 60_000);
}

/** Последний наступивший слот и его окно. */
export function currentSlot(now: Date): DigestSlot {
  const today = mskToday(now);
  const moments = [addDays(today, -2), addDays(today, -1), today]
    .flatMap((ymd) => FOUNDER_DIGEST_SLOTS.map((s) => ({ key: s.key, ymd, at: slotMoment(ymd, s.hour, s.minute) })))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const idx = moments.reduce((best, m, i) => (m.at.getTime() <= now.getTime() ? i : best), 0);
  return { ...moments[idx], from: moments[Math.max(idx - 1, 0)].at };
}

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const dayMonth = (ymd: string) => `${Number(ymd.slice(8, 10))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]}`;
const ddmm = (iso: string) => {
  const ymd = mskToday(new Date(iso));
  return `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
};
function hhmm(d: Date): string {
  const f = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return f.format(d);
}

/** «вчера 18:00», «сегодня 12:00», «05.10 18:00»; конец дня — без времени. */
export function relativeDue(iso: string, now: Date): string {
  const d = new Date(iso);
  const ymd = mskToday(d);
  const today = mskToday(now);
  const day = ymd === today ? "сегодня" : ymd === addDays(today, -1) ? "вчера" : `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
  const time = hhmm(d);
  return time === "23:59" ? day : `${day} ${time}`;
}

function capped(lines: string[]): string[] {
  if (lines.length <= DIGEST_LIST_LIMIT) return lines;
  return [...lines.slice(0, DIGEST_LIST_LIMIT), `  · и ещё ${lines.length - DIGEST_LIST_LIMIT}`];
}

const at = (name: string | undefined) => (name ? `@${name}` : "без ника");

export interface SocialLine {
  platform: Platform;
  /** Свежий снимок; null — нет ни одного. */
  latest: Snapshot | null;
  dayAgo: Snapshot | null;
  weekAgo: Snapshot | null;
  /** Telegram: не удалось снять сейчас; Instagram не использует. */
  failed?: boolean;
  /** Telegram: канал не настроен. */
  notConfigured?: boolean;
}

function growth(latest: Snapshot, ref: Snapshot | null, label: string): string {
  if (!ref) return `нет данных за ${label}`;
  const diff = latest.followers - ref.followers;
  return `${diff >= 0 ? "+" : "-"}${formatNumber(Math.abs(diff))} за ${label}`;
}

export function socialText(line: SocialLine, now: Date): string {
  const name = line.platform === "telegram" ? "TG-канал" : "Instagram";
  if (line.platform === "telegram") {
    if (line.notConfigured) return `${name}: не настроен (NIKA_TG_CHANNEL)`;
    if (line.failed || !line.latest) return `${name}: не удалось получить`;
  } else {
    if (!line.latest) return `${name}: ещё ни разу не вносили`;
    if (!takenToday(line.latest, now)) return `${name}: не внесено сегодня (последнее ${formatNumber(line.latest.followers)}, ${ddmm(line.latest.taken_at)})`;
  }
  const l = line.latest!;
  return `${name}: ${formatNumber(l.followers)} (${growth(l, line.dayAgo, "сутки")}, ${growth(l, line.weekAgo, "неделю")})`;
}

export interface FounderDigestInput {
  slot: DigestSlot;
  now: Date;
  tasks: readonly AssignedTask[];
  team: readonly TeamMember[];
  founders: readonly number[];
  social: readonly SocialLine[];
}

export function founderDigestText(input: FounderDigestInput): string {
  const { slot, now, tasks, team, founders, social } = input;
  const names = new Map(team.filter((m) => m.username).map((m) => [m.chat_id, m.username!] as const));
  const inWindow = (iso: string) => {
    const t = Date.parse(iso);
    return t > slot.from.getTime() && t <= slot.at.getTime();
  };
  const done = tasks.filter((t) => t.status === "done" && inWindow(t.status_at))
    .sort((a, b) => Date.parse(a.status_at) - Date.parse(b.status_at));
  const declined = tasks.filter((t) => t.status === "declined" && inWindow(t.status_at))
    .sort((a, b) => Date.parse(a.status_at) - Date.parse(b.status_at));
  const overdue = tasks.filter((t) => (t.status === "open" || t.status === "taken") && t.due_at && Date.parse(t.due_at) <= now.getTime())
    .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!));

  const crew = team.filter((m) => !founders.includes(m.chat_id));
  const visited = crew.filter((m) => m.last_seen_at && inWindow(m.last_seen_at));
  const away = crew
    .map((m) => ({ m, days: m.last_seen_at ? Math.floor((now.getTime() - Date.parse(m.last_seen_at)) / DAY) : null }))
    .filter((x) => x.days === null || x.days >= AWAY_DAYS)
    .sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));
  const who = (m: TeamMember) => (m.username ? `@${m.username}` : m.display_name ?? String(m.chat_id));

  return [
    `Сводка ${slot.key} · ${dayMonth(slot.ymd)}`,
    "",
    "Задачи",
    `✅ Выполнено: ${done.length}`,
    ...capped(done.map((t) => `  · @${t.username} · ${t.what}${t.assigned_by !== t.assignee_id ? ` (от ${at(names.get(t.assigned_by))})` : ""}`)),
    `↩️ Отказались: ${declined.length}`,
    ...capped(declined.map((t) => `  · @${t.username} · ${t.what}`)),
    `⏰ Просрочено сейчас: ${overdue.length}`,
    ...capped(overdue.map((t) => `  · @${t.username} · ${t.what} · срок ${relativeDue(t.due_at!, now)}`)),
    "",
    "Команда",
    `Заходили: ${visited.length ? visited.map(who).join(", ") : "никто"}`,
    `Давно не было (${AWAY_DAYS}+ дня): ${away.length ? away.map(({ m, days }) => `${who(m)} · ${days === null ? "ни разу" : `${days} дн.`}`).join(", ") : "нет"}`,
    "",
    "Соцсети",
    ...social.map((s) => socialText(s, now)),
  ].join("\n");
}

export interface FounderDigestDeps {
  /** Все задачи команды: незакрытые и сменившие статус после since. */
  tasks: (since: Date) => Promise<AssignedTask[]>;
  team: () => Promise<TeamMember[]>;
  founders: () => number[];
  social: SocialStore;
  memberCount: (channel: string) => Promise<number>;
  send: (chatId: number, text: string, keyboard?: InlineKeyboardMarkup) => Promise<unknown>;
}

async function socialLine(store: SocialStore, platform: Platform, now: Date, extra: Partial<SocialLine> = {}): Promise<SocialLine> {
  const [latest, dayAgo, weekAgo] = await Promise.all([
    store.latest(platform),
    store.latestAtOrBefore(platform, new Date(now.getTime() - DAY)),
    store.latestAtOrBefore(platform, new Date(now.getTime() - 7 * DAY)),
  ]);
  return { platform, latest, dayAgo, weekAgo, ...extra };
}

/**
 * Отправить сводку текущего слота, если её ещё не было. Перед сводкой —
 * свежий снимок Telegram-канала; ошибка Telegram не роняет сводку.
 * Возвращает ключ отправленной сводки или null.
 */
export async function dispatchFounderDigest(deps: FounderDigestDeps, now: Date): Promise<string | null> {
  const slot = currentSlot(now);
  // Сначала занимаем слот: снимок канала и чтение базы — только для сводки,
  // которая действительно уйдёт, а не на каждом 15-минутном проходе.
  if (!(await deps.social.claim("founders", slot.key, slot.ymd))) return null;
  const channel = telegramChannel();
  let tgFailed = false;
  if (channel) {
    try {
      const followers = await deps.memberCount(channel);
      await deps.social.addSnapshot({ platform: "telegram", followers, source: "auto", entered_by: null }, now);
    } catch (err) {
      tgFailed = true;
      console.error("[founders] tg snapshot:", err instanceof Error ? err.message : String(err));
    }
  }
  const [tasks, team] = await Promise.all([deps.tasks(slot.from), deps.team()]);
  const social = [
    await socialLine(deps.social, "telegram", now, { failed: tgFailed, notConfigured: !channel }),
    await socialLine(deps.social, "instagram", now),
  ];
  const text = founderDigestText({ slot, now, tasks, team, founders: deps.founders(), social });
  for (const chatId of deps.founders()) await Promise.resolve(deps.send(chatId, text)).catch(() => {});
  return `${slot.key} ${slot.ymd}`;
}

/**
 * «Сводка сейчас» из раздела «Соцсети»: окно — с последней сводки по
 * расписанию до этой минуты. Без отметки дедупа и без записи снимка канала:
 * плановые сводки она не трогает.
 */
export async function buildFounderDigestNow(
  deps: Pick<FounderDigestDeps, "tasks" | "team" | "founders" | "social">,
  now: Date,
): Promise<string> {
  const last = currentSlot(now);
  const slot: DigestSlot = { key: hhmm(now), ymd: mskToday(now), at: now, from: last.at };
  const [tasks, team] = await Promise.all([deps.tasks(slot.from), deps.team()]);
  const channel = telegramChannel();
  const social = [
    await socialLine(deps.social, "telegram", now, { notConfigured: !channel }),
    await socialLine(deps.social, "instagram", now),
  ];
  return founderDigestText({ slot, now, tasks, team, founders: deps.founders(), social });
}
