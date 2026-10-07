import { addDays } from "./time";
import type { ReportId, Section, Subject, Zone } from "./types";

/**
 * Матрица доступа бота данных — ЕДИНСТВЕННЫЙ источник правды (4.1 ТЗ).
 * Конвейер проверяет здесь зону после распознавания запроса и до базы;
 * экраны спрашивают zoneCan только чтобы решить, рисовать ли кнопку.
 * Всё, что не разрешено явно, запрещено: нет контекста — нет доступа.
 */

/**
 * Владельцы из DATABOT_OWNER_IDS. Env читаем на каждый вызов без кеша:
 * снятого владельца бот должен перестать слушать со следующего апдейта,
 * а не после перезапуска. Мусор в списке молча пропускаем — одна опечатка
 * не должна ни ронять бота, ни делать владельцем chat_id 0 или NaN.
 */
export function ownerIds(raw: string | undefined = process.env.DATABOT_OWNER_IDS): Set<number> {
  const ids = new Set<number>();
  for (const part of (raw ?? "").split(",")) {
    const s = part.trim();
    // Только цифры: «4.5», «-3», «1e3», «0x10» Number() бы проглотил.
    if (!/^\d+$/.test(s)) continue;
    const n = Number(s);
    if (Number.isSafeInteger(n) && n > 0) ids.add(n);
  }
  return ids;
}

export function isEnvOwner(chatId: number): boolean {
  return ownerIds().has(chatId);
}

/**
 * Окно списка участников: с 14 дней до забега до 3 дней после. Одно для
 * ивентов и совета (раздел 8 ТЗ, уточнение 2); если совету понадобятся
 * старые списки — меняется только эта константа.
 */
export const PEOPLE_WINDOW = { daysBefore: 14, daysAfter: 3 } as const;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** runDate ∈ [today−3; today+14] включительно; даты московские YYYY-MM-DD. */
export function peopleWindowOpen(runDate: string, today: string): boolean {
  // Кривая дата — закрыто: строковое сравнение ниже верно только для YYYY-MM-DD.
  if (!YMD.test(runDate) || !YMD.test(today)) return false;
  const from = addDays(today, -PEOPLE_WINDOW.daysAfter);
  const to = addDays(today, PEOPLE_WINDOW.daysBefore);
  return runDate >= from && runDate <= to;
}

/** То, что знает экран о конкретном запросе сверх зоны. */
export interface AccessContext {
  /** Дата забега (run.people, run.plan.set). */
  runDate?: string;
  /** Сегодня по Москве (mskToday) — передаётся снаружи, чтобы тесты не зависели от часов. */
  today?: string;
  /** Зоны статьи справочника (kb.article). */
  articleZones?: readonly Zone[];
  /** Над кем действие (tm.zone, tm.remove). */
  targetChatId?: number;
}

const ALL: readonly Zone[] = ["council", "events", "smm"];
const COUNCIL: readonly Zone[] = ["council"];
const COUNCIL_EVENTS: readonly Zone[] = ["council", "events"];

/**
 * Правило клетки: кто видит по зоне (или только владелец) и, при нужде,
 * проверка контекста поверх зоны. Декларативно, чтобы тест прошёл по каждой
 * клетке, а новый отчёт без правила не собрался (Record по ReportId).
 */
interface Rule {
  audience: readonly Zone[] | "owner";
  /** Вызывается только когда зона уже пропустила. */
  ctx?: (subject: Subject, ctx: AccessContext) => boolean;
}

/** Нельзя убрать или перевести владельца из env и самого себя (4.1 п. 5). */
const notProtectedTarget = (subject: Subject, ctx: AccessContext): boolean =>
  ctx.targetChatId === undefined ||
  (ctx.targetChatId !== subject.chatId && !isEnvOwner(ctx.targetChatId));

export const ACCESS_MATRIX: Readonly<Record<ReportId, Rule>> = {
  "run.section": { audience: ALL },
  "run.card": { audience: ALL },
  "run.past": { audience: ALL },
  "run.table": { audience: ALL },
  "run.table.csv": { audience: ALL },
  // Персональные данные: без даты забега и «сегодня» не открываем вовсе.
  "run.people": {
    audience: COUNCIL_EVENTS,
    ctx: (_s, c) => c.runDate !== undefined && c.today !== undefined && peopleWindowOpen(c.runDate, c.today),
  },
  // План задают только будущим забегам; «сегодня» ещё будущее — утром план правят.
  // Без дат пропускаем: так рисуется кнопка на карточке, где дата уже проверена.
  "run.plan.set": {
    audience: COUNCIL_EVENTS,
    ctx: (_s, c) => c.runDate === undefined || c.today === undefined || c.runDate >= c.today,
  },
  // «Соцсети»: только фаундерам (владельцы из DATABOT_OWNER_IDS).
  "tr.section": { audience: "owner" },
  "tr.channels": { audience: "owner" },
  "tr.codes": { audience: "owner" },
  "tr.code": { audience: "owner" },
  "tr.csv": { audience: "owner" },
  "tr.issue": { audience: "owner" },
  "tr.ig": { audience: "owner" },
  "tr.owner": { audience: "owner" },
  "tr.digest": { audience: "owner" },
  "pro.summary": { audience: COUNCIL },
  "prd.summary": { audience: COUNCIL },
  "kb.list": { audience: ALL },
  // Совет читает всё; остальным — только статьи своей зоны. Не знаем зон статьи — не показываем.
  "kb.article": {
    audience: ALL,
    ctx: (s, c) => s.zone === "council" || (c.articleZones?.includes(s.zone) ?? false),
  },
  "kb.edit": { audience: COUNCIL },
  // Уточнение 5: совет смотрит состав и «Кто пользуется», управляет владелец.
  "tm.list": { audience: COUNCIL },
  "tm.usage": { audience: COUNCIL },
  "tm.invite": { audience: "owner" },
  "tm.zone": { audience: "owner", ctx: notProtectedTarget },
  "tm.remove": { audience: "owner", ctx: notProtectedTarget },
};

/** Раздел отчёта — префикс до первой точки (0.4: каждый отчёт ровно в одном разделе). */
export function sectionOfReport(report: ReportId): Section {
  return report.slice(0, report.indexOf(".")) as Section;
}

/**
 * Только зона и флаг владельца, без контекста — «показывать ли кнопку».
 * Владелец сверх владельческих клеток имеет права своей зоны (конвейер
 * и так даёт владельцам council), отдельного «владелец может всё» нет.
 */
export function zoneCan(subject: Subject, report: ReportId): boolean {
  const rule = ACCESS_MATRIX[report];
  if (!rule) return false;
  if (rule.audience === "owner") return subject.isOwner;
  return rule.audience.includes(subject.zone);
}

/** Полная проверка: зона, затем контекст клетки. */
export function can(subject: Subject, report: ReportId, ctx: AccessContext = {}): boolean {
  if (!zoneCan(subject, report)) return false;
  const check = ACCESS_MATRIX[report].ctx;
  return check ? check(subject, ctx) : true;
}

const SECTION_AUDIENCE: Readonly<Record<Section, readonly Zone[] | "owner">> = {
  run: ALL,
  tr: "owner",
  kb: ALL,
  pro: COUNCIL,
  prd: COUNCIL,
  tm: COUNCIL,
};

/** Виден ли раздел в клавиатуре и меню команд зоны. */
export function canOpenSection(subject: Subject, section: Section): boolean {
  const audience = SECTION_AUDIENCE[section];
  if (audience === "owner") return subject.isOwner;
  return audience?.includes(subject.zone) ?? false;
}

/** Кто видит отчёт — для текста отказа «Это видит совет…». */
export function audienceOf(report: ReportId): readonly Zone[] | "owner" {
  return ACCESS_MATRIX[report].audience;
}
