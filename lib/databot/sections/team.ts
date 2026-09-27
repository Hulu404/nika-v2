import { can, isEnvOwner } from "../access";
import {
  isReportId,
  memberName,
  teamInviteForwardScreen,
  teamInviteOwnerScreen,
  teamInviteZoneScreen,
  teamListScreen,
  teamRemoveConfirmScreen,
  teamRemovedText,
  teamUsageScreen,
  teamZoneChangedText,
  teamZonePickScreen,
  type TeamMemberView,
} from "../copy";
import { inviteExpiresAt, inviteLink, newInviteToken } from "../invite";
import type { SectionHandler, SectionOutcome, SectionRequest } from "../section";
import { SERVICE_REPORTS, ZONES, type MemberRow, type ReportId, type Screen, type Zone } from "../types";

/**
 * Раздел «Команда» (4.1 ТЗ, флоу 2 и 5–6; 4.11 — «Кто пользуется»).
 *
 * Конвейер уже проверил доступ к intent.report — в том числе, что цель не
 * владелец из env и не сам смотрящий, — и валидность параметров. Здесь та же
 * матрица спрашивается ещё раз лишь для двух вещей: какие кнопки рисовать и
 * (дёшево, на всякий случай) не выполнять tm.zone/tm.remove над защищённой
 * целью, даже если конвейер когда-нибудь пропустит.
 *
 * Состав команды читается заново на каждом экране: после смены зоны или
 * «Убрать» список обязан быть актуальным, а не собранным до записи.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const TOP_REPORTS = 5;
const SERVICE = new Set<string>(SERVICE_REPORTS);

export const handleTeam: SectionHandler = async (req) => {
  const { intent } = req;
  switch (intent.action) {
    case "list":
      return screens(await listScreen(req));
    case "usage":
      return screens(await usageScreen(req));
    // Действие приходит и полным именем, и как в callback_data (d:tm:inv, d:tm:rm).
    case "invite":
    case "inv":
      return invite(req);
    case "zone":
      return zone(req);
    case "remove":
    case "rm":
      return remove(req);
    default:
      return { kind: "stale" };
  }
};

function screens(...list: Screen[]): SectionOutcome {
  return { kind: "screens", screens: list };
}

function isZone(value: string | undefined): value is Zone {
  return value !== undefined && (ZONES as readonly string[]).includes(value);
}

/** chat_id цели из params.target; мусор — null (экран устарел, а не авария). */
function targetId(req: SectionRequest): number | null {
  const raw = req.intent.params.target;
  if (!raw || !/^-?\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

function isOwnerRow(m: MemberRow): boolean {
  // is_owner в таблице — отражение env на последнем визите; env главнее.
  return m.is_owner || isEnvOwner(m.chat_id);
}

/** Владельцы → совет, ивенты, СММ → имя. */
function sortMembers(members: MemberRow[]): MemberRow[] {
  return [...members].sort((a, b) => {
    const ao = isOwnerRow(a) ? 0 : 1;
    const bo = isOwnerRow(b) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    const az = ZONES.indexOf(a.zone);
    const bz = ZONES.indexOf(b.zone);
    if (az !== bz) return az - bz;
    return memberName(a).localeCompare(memberName(b), "ru");
  });
}

async function weekAudit(req: SectionRequest): Promise<Array<{ chat_id: number; report: string }>> {
  return req.store.auditSince(new Date(req.now.getTime() - WEEK_MS));
}

/** Запросы за 7 дней по chat_id — все строки журнала, служебные тоже: это «сколько раз писал». */
function requestsByChat(rows: Array<{ chat_id: number }>): Map<number, number> {
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.chat_id, (counts.get(r.chat_id) ?? 0) + 1);
  return counts;
}

async function listScreen(req: SectionRequest, notice?: string) {
  const [members, audit] = await Promise.all([req.store.listMembers(), weekAudit(req)]);
  const counts = requestsByChat(audit);
  const { subject } = req;
  const views: TeamMemberView[] = sortMembers(members).map((m) => ({
    chatId: m.chat_id,
    name: memberName(m),
    username: m.username,
    zone: m.zone,
    isOwner: isOwnerRow(m),
    lastSeenAt: m.last_seen_at,
    requests7d: counts.get(m.chat_id) ?? 0,
    // Обе клетки: если хоть одна закрыта — не рисуем ряд целиком.
    manageable:
      can(subject, "tm.zone", { targetChatId: m.chat_id }) &&
      can(subject, "tm.remove", { targetChatId: m.chat_id }),
  }));
  return teamListScreen({ members: views, canInvite: can(subject, "tm.invite"), now: req.now, notice });
}

async function usageScreen(req: SectionRequest) {
  const [members, audit] = await Promise.all([req.store.listMembers(), weekAudit(req)]);
  const counts = requestsByChat(audit);
  const people = sortMembers(members)
    .map((m) => ({ name: memberName(m), requests: counts.get(m.chat_id) ?? 0 }))
    // sort стабильный: при равенстве остаётся порядок списка «Команда».
    .sort((a, b) => b.requests - a.requests);

  // Частые отчёты — без служебных (start, menu, stale…): они не про данные.
  const byReport = new Map<ReportId, number>();
  for (const r of audit) {
    if (SERVICE.has(r.report) || !isReportId(r.report)) continue;
    byReport.set(r.report, (byReport.get(r.report) ?? 0) + 1);
  }
  const top = [...byReport.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_REPORTS)
    .map(([report, count]) => ({ report, count }));
  return teamUsageScreen({ people, top, now: req.now });
}

async function invite(req: SectionRequest): Promise<SectionOutcome> {
  if (!can(req.subject, "tm.invite")) return { kind: "stale" };
  const zone = req.intent.params.zone;
  if (zone === undefined) return screens(teamInviteZoneScreen());
  if (!isZone(zone)) return { kind: "stale" };

  const token = newInviteToken();
  await req.store.createInvite(
    { token, zone, created_by: req.subject.chatId, expires_at: inviteExpiresAt(req.now) },
    req.now,
  );
  const link = inviteLink(req.botUsername, token);
  return screens(teamInviteOwnerScreen(zone, link), teamInviteForwardScreen(zone, link));
}

async function zone(req: SectionRequest): Promise<SectionOutcome> {
  const target = targetId(req);
  if (target === null || !can(req.subject, "tm.zone", { targetChatId: target })) return { kind: "stale" };
  const next = req.intent.params.zone;

  const member = await req.store.findActiveMember(target);
  if (!member) return { kind: "stale" };
  if (next === undefined) {
    return screens(teamZonePickScreen({ chatId: target, name: memberName(member), zone: member.zone }));
  }
  if (!isZone(next)) return { kind: "stale" };

  // Между выбором и записью человека могли убрать — setZone это увидит.
  if (!(await req.store.setZone(target, next))) return { kind: "stale" };
  const commandsOk = await setCommandsSafe(req, target, next);
  const notice = teamZoneChangedText(memberName(member), next, commandsOk);
  return screens(await listScreen(req, notice));
}

async function remove(req: SectionRequest): Promise<SectionOutcome> {
  const target = targetId(req);
  if (target === null || !can(req.subject, "tm.remove", { targetChatId: target })) return { kind: "stale" };

  const member = await req.store.findActiveMember(target);
  if (!member) return { kind: "stale" };
  if (req.intent.params.confirm !== "ok") {
    return screens(teamRemoveConfirmScreen({ chatId: target, name: memberName(member) }));
  }

  if (!(await req.store.removeMember(target, req.now))) return { kind: "stale" };
  // Незаконченная форма убранного не должна дожить до его следующего апдейта (раздел 9 ТЗ).
  await req.store.clearSession(target);
  // Доступ уже снят на уровне базы; меню команд — косметика, его сбой не отменяет «Убрала».
  await setCommandsSafe(req, target, null);
  return screens(await listScreen(req, teamRemovedText(memberName(member))));
}

/** setCommands бьёт в Telegram; сбой — в лог без chat_id, ответ не ломаем. */
async function setCommandsSafe(req: SectionRequest, chatId: number, zone: Zone | null): Promise<boolean> {
  try {
    await req.effects.setCommands(chatId, zone);
    return true;
  } catch (err) {
    console.error("[databot] setCommands:", err instanceof Error ? err.message : String(err));
    return false;
  }
}
