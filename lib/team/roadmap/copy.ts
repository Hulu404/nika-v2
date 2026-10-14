import { InlineKeyboard } from "grammy";
import type { AssignedTask } from "../../databot/task-list";
import { addDays } from "../../databot/time";
import { mskWeekday } from "../../databot/dates";
import { escapeHtmlTeam, type TaskScreen } from "../copy";
import { ROADMAP_GROUPS } from "../projects/rescan-seed";
import type { RoadmapItem, RoadmapStatus } from "./store";

/**
 * Тексты и клавиатуры плана развития — без походов в базу. Экран живёт в
 * одном сообщении: кнопки контрольных точек, групп, пунктов редактируют его.
 */

export const rmCb = {
  home: () => "rm:h",
  milestone: (id: number) => `rm:m:${id}`,
  group: (i: number) => `rm:g:${i}`,
  overdue: () => "rm:o",
  item: (id: number) => `rm:i:${id}`,
  status: (id: number, s: "w" | "d" | "b" | "p") => `rm:s:${id}:${s}`,
  owner: (id: number) => `rm:ow:${id}`,
  setOwner: (id: number, chat: number) => `rm:ow:${id}:${chat}`,
  due: (id: number) => `rm:due:${id}`,
  task: (id: number) => `rm:tk:${id}`,
  del: (id: number) => `rm:del:${id}`,
  delDo: (id: number) => `rm:DEL:${id}`,
  doneYes: (id: number) => `rm:yes:${id}`,
  doneNo: (id: number) => `rm:no:${id}`,
};

export const STATUS_ICON: Record<RoadmapStatus, string> = { planned: "○", in_progress: "▶️", done: "✅", blocked: "⛔", dropped: "✖️" };
export const STATUS_NAME: Record<RoadmapStatus, string> = { planned: "запланирован", in_progress: "в работе", done: "готово", blocked: "блокер", dropped: "отменён" };
const WD = ["", "пн", "вт", "ср", "чт", "пт", "сб", "вс"];

const dm = (ymd: string, today: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}${ymd.slice(0, 4) !== today.slice(0, 4) ? `.${ymd.slice(0, 4)}` : ""}`;
/** «пт 16.10». */
export const dayLabel = (ymd: string, today: string) => `${WD[mskWeekday(ymd)]} ${dm(ymd, today)}`;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

/** «через 2 дня», «завтра», «сегодня», «2 дня назад». */
export function inDays(ymd: string, today: string): string {
  const d = daysBetween(today, ymd);
  if (d === 0) return "сегодня";
  if (d === 1) return "завтра";
  if (d > 1) return `через ${d} ${plural(d, "день", "дня", "дней")}`;
  return `${-d} ${plural(-d, "день", "дня", "дней")} назад`;
}

const isOpen = (i: RoadmapItem) => i.status !== "done" && i.status !== "dropped";
export const isOverdue = (i: RoadmapItem, today: string) => i.kind === "item" && isOpen(i) && !!i.due_date && i.due_date < today;

/** Ближайшая невыполненная контрольная точка (с сегодняшнего дня). */
export function nearestMilestone(items: readonly RoadmapItem[], today: string): RoadmapItem | null {
  return items.filter((i) => i.kind === "milestone" && i.status !== "done" && i.due_date && i.due_date >= today)
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!))[0] ?? null;
}

export const conditionsOf = (items: readonly RoadmapItem[], milestoneId: number) =>
  items.filter((i) => i.milestone_id === milestoneId && i.status !== "dropped");

/** «Разработка · 14.10–27.10 · идёт», «Наблюдение 30 дней · до 07.01», однодневный — одна дата. */
function stageLine(s: RoadmapItem, today: string): string {
  const due = s.due_date ? dm(s.due_date, today) : "";
  const when = !s.due_date ? "" : !s.start_date ? `до ${due}` : s.start_date === s.due_date ? due : `${dm(s.start_date, today)}–${due}`;
  const running = s.status === "in_progress" || (s.status !== "done" && !!s.start_date && s.start_date <= today && (!s.due_date || today <= s.due_date));
  const icon = s.status === "done" ? "✅" : running ? "▶️" : "○";
  return `${icon} ${escapeHtmlTeam(s.title)}${when ? ` · ${when}` : ""}${running && s.start_date !== s.due_date ? " · идёт" : ""}`;
}

/** «Бэкенд 2/12 · Фронтенд 1/9 · …». */
export function progressLine(items: readonly RoadmapItem[]): string {
  return ROADMAP_GROUPS.filter((g) => g !== "Решения").map((g) => {
    const list = items.filter((i) => i.kind === "item" && i.group === g && i.status !== "dropped");
    return `${g} ${list.filter((i) => i.status === "done").length}/${list.length}`;
  }).join(" · ");
}

export function roadmapHome(projectLabel: string, items: readonly RoadmapItem[], today: string): TaskScreen {
  const lines = [`<b>${escapeHtmlTeam(projectLabel)} · План развития</b>`];
  const next = nearestMilestone(items, today);
  if (next) {
    const conds = conditionsOf(items, next.id);
    lines.push("", `⏳ Ближайшая точка: ${escapeHtmlTeam(next.code ?? "")} · ${dayLabel(next.due_date!, today)} · ${inDays(next.due_date!, today)}`,
      `${escapeHtmlTeam(next.title)}${conds.length ? ` · готово ${conds.filter((c) => c.status === "done").length} из ${conds.length}` : ""}`);
  }
  const stages = items.filter((i) => i.kind === "stage");
  if (stages.length) lines.push("", "Этапы", ...stages.map((s) => stageLine(s, today)));
  lines.push("", "Прогресс", progressLine(items));
  const overdue = items.filter((i) => isOverdue(i, today));
  if (overdue.length) lines.push(`⚠️ Просрочено: ${overdue.length}`);

  const kb = new InlineKeyboard();
  for (const m of items.filter((i) => i.kind === "milestone")) kb.text(m.code ?? m.title, rmCb.milestone(m.id));
  kb.row();
  ROADMAP_GROUPS.forEach((g, i) => {
    kb.text(g, rmCb.group(i));
    if (i === 2) kb.row();
  });
  if (overdue.length) kb.row().text("⚠️ Просрочено", rmCb.overdue());
  return { text: lines.join("\n"), keyboard: kb };
}

const ownerName = (i: RoadmapItem, names: ReadonlyMap<number, string>) => (i.owner_chat_id ? names.get(i.owner_chat_id) ?? "—" : "без ответственного");

/** «B4 · Очередь врача · до пт 23.10 · ▶️ · Вика». */
export function itemLine(i: RoadmapItem, names: ReadonlyMap<number, string>, today: string): string {
  const due = i.due_date ? ` · до ${dayLabel(i.due_date, today)}${isOverdue(i, today) ? " ⏰" : ""}` : "";
  return `${STATUS_ICON[i.status]} ${escapeHtmlTeam(i.code ? `${i.code} · ` : "")}${escapeHtmlTeam(i.title)}${due} · ${escapeHtmlTeam(ownerName(i, names))}`;
}

function listScreen(title: string, list: readonly RoadmapItem[], names: ReadonlyMap<number, string>, today: string, empty: string): TaskScreen {
  const kb = new InlineKeyboard();
  list.forEach((i, n) => {
    kb.text(i.code ?? String(n + 1), rmCb.item(i.id));
    if (n % 4 === 3) kb.row();
  });
  kb.row().text("← К плану", rmCb.home());
  return { text: [`<b>${escapeHtmlTeam(title)}</b>`, "", ...(list.length ? list.map((i) => itemLine(i, names, today)) : [empty])].join("\n"), keyboard: kb };
}

export function milestoneScreen(m: RoadmapItem, items: readonly RoadmapItem[], names: ReadonlyMap<number, string>, today: string): TaskScreen {
  const conds = conditionsOf(items, m.id);
  const screen = listScreen(`${m.code ?? ""} · ${m.title}`, conds, names, today, "Условий нет.");
  const head = [
    `<b>${escapeHtmlTeam(`${m.code ?? ""} · ${m.title}`)}</b>`,
    m.due_date ? `${dayLabel(m.due_date, today)} · ${inDays(m.due_date, today)}` : "",
    ...(m.details ? ["", escapeHtmlTeam(m.details)] : []),
    ...(conds.length ? ["", `Условия · готово ${conds.filter((c) => c.status === "done").length} из ${conds.length}`] : []),
  ].filter((l) => l !== "");
  return { text: [...head, ...conds.map((c) => itemLine(c, names, today))].join("\n"), keyboard: screen.keyboard };
}

export function groupScreen(group: string, items: readonly RoadmapItem[], names: ReadonlyMap<number, string>, today: string): TaskScreen {
  return listScreen(group, items.filter((i) => i.kind === "item" && i.group === group && i.status !== "dropped"), names, today, "В группе пока пусто.");
}

export function overdueScreen(items: readonly RoadmapItem[], names: ReadonlyMap<number, string>, today: string): TaskScreen {
  return listScreen("⚠️ Просрочено", items.filter((i) => isOverdue(i, today)), names, today, "Просрочек нет.");
}

const TASK_ICON: Record<string, string> = { open: "🆕", taken: "🔄", done: "✅", declined: "↩️", cancelled: "✖️" };

export function itemCard(i: RoadmapItem, names: ReadonlyMap<number, string>, tasks: readonly AssignedTask[], hidden: number, canEdit: boolean, admin: boolean, today: string): TaskScreen {
  const lines = [
    `<b>${escapeHtmlTeam(i.code ? `${i.code} · ${i.title}` : i.title)}</b>`,
    `${STATUS_ICON[i.status]} ${STATUS_NAME[i.status]}${i.group ? ` · ${escapeHtmlTeam(i.group)}` : ""}`,
    `📅 Срок: ${i.due_date ? `${dayLabel(i.due_date, today)}${isOverdue(i, today) ? " ⏰ просрочено" : ""}` : "не задан"}`,
    `👤 Ответственный: ${escapeHtmlTeam(ownerName(i, names))}`,
    ...(i.details ? ["", escapeHtmlTeam(i.details)] : []),
  ];
  if (tasks.length || hidden) {
    lines.push("", "Задачи", ...tasks.map((t) => `${TASK_ICON[t.status] ?? "·"} @${escapeHtmlTeam(t.username)} · ${escapeHtmlTeam(t.what)}`));
    if (hidden) lines.push(`и ещё ${hidden} у других участников`);
  }
  const kb = new InlineKeyboard();
  if (canEdit && i.kind !== "stage") {
    if (i.status !== "in_progress") kb.text("▶️ В работе", rmCb.status(i.id, "w"));
    if (i.status !== "done") kb.text("✅ Готово", rmCb.status(i.id, "d"));
    if (i.status !== "blocked") kb.text("⛔ Блокер", rmCb.status(i.id, "b"));
    kb.row().text("👤 Ответственный", rmCb.owner(i.id)).text("📅 Срок", rmCb.due(i.id)).row();
  }
  if (i.kind === "item") kb.text("📋 Сделать задачей", rmCb.task(i.id)).row();
  if (admin) kb.text("🗑 Удалить", rmCb.del(i.id)).row();
  kb.text("← К плану", rmCb.home());
  return { text: lines.join("\n"), keyboard: kb };
}

export function ownerPicker(i: RoadmapItem, team: ReadonlyArray<{ chat_id: number; label: string }>): TaskScreen {
  const kb = new InlineKeyboard();
  for (const m of team) kb.text(m.label, rmCb.setOwner(i.id, m.chat_id)).row();
  kb.text("← К пункту", rmCb.item(i.id));
  return { text: `Кто отвечает за ${escapeHtmlTeam(i.code ?? i.title)}?`, keyboard: kb };
}

/** Пункты со сроком на неделе [weekStart, weekStart+6]. */
export function weekItems(items: readonly RoadmapItem[], weekStart: string): RoadmapItem[] {
  const end = addDays(weekStart, 6);
  return items.filter((i) => i.kind === "item" && isOpen(i) && i.due_date && i.due_date >= weekStart && i.due_date <= end)
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!) || a.sort - b.sort);
}
