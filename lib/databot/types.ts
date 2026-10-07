/**
 * Общие типы бота данных. Единый словарь для конвейера, матрицы доступа,
 * журнала и разделов: ID отчётов здесь те же, что в databot_audit.report
 * и в SQL-метриках (раздел 0.4 файла промтов).
 */

export const ZONES = ["council", "events", "smm"] as const;
export type Zone = (typeof ZONES)[number];

/** Разделы в порядке постоянной клавиатуры совета. */
export const SECTIONS = ["run", "tr", "pro", "prd", "kb", "tm"] as const;
export type Section = (typeof SECTIONS)[number];

export type Source = "button" | "command" | "text" | "llm";

/** Отчёты каталога. Каждый принадлежит ровно одному разделу (префикс). */
export const REPORTS = [
  "run.section",
  "run.card",
  "run.past",
  "run.table",
  "run.table.csv",
  "run.people",
  "run.plan.set",
  "tr.section",
  "tr.channels",
  "tr.codes",
  "tr.code",
  "tr.csv",
  "tr.issue",
  "tr.ig",
  "tr.owner",
  "tr.digest",
  "pro.summary",
  "prd.summary",
  "kb.list",
  "kb.article",
  "kb.edit",
  "tm.list",
  "tm.usage",
  "tm.invite",
  "tm.zone",
  "tm.remove",
] as const;
export type ReportId = (typeof REPORTS)[number];

/** Служебные значения report в журнале. */
export const SERVICE_REPORTS = [
  "start",
  "menu",
  "help",
  "clarify",
  "unknown",
  "no_member",
  "stale",
  "rate_limited",
] as const;
export type ServiceReport = (typeof SERVICE_REPORTS)[number];

export type AnyReport = ReportId | ServiceReport;

/** Строка databot_members. */
export interface MemberRow {
  chat_id: number;
  username: string | null;
  display_name: string | null;
  zone: Zone;
  is_owner: boolean;
  invited_by: number | null;
  joined_at: string;
  last_seen_at: string | null;
  is_active: boolean;
  removed_at: string | null;
}

/** Строка databot_invites. */
export interface InviteRow {
  token: string;
  zone: Zone;
  created_by: number;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by: number | null;
}

/**
 * Кто спрашивает — то, что видит матрица доступа. isOwner считается по env
 * DATABOT_OWNER_IDS на каждом апдейте, а не берётся из таблицы.
 */
export interface Subject {
  chatId: number;
  zone: Zone;
  isOwner: boolean;
}

/**
 * Разобранный запрос. params — только проверенные валидаторами значения;
 * в журнал из них попадают лишь ключи без персональных данных (audit.ts).
 */
export interface Intent {
  report: AnyReport;
  /** Раздел запроса; null у служебных (start, help, unknown…). */
  section: Section | null;
  /** Действие внутри раздела, как во второй части callback_data. */
  action: string;
  params: Record<string, string>;
  source: Source;
  /** Ответ на шаг формы — не вопрос текстом (0.4). */
  form?: boolean;
  /** Исходный текст — только у unknown, для словаря правил. */
  rawText?: string;
}

/** Строка журнала databot_audit для записи. */
export interface AuditEntry {
  chat_id: number;
  zone: Zone | null;
  report: AnyReport;
  params: Record<string, unknown>;
  source: Source | null;
  ok: boolean;
  error?: string | null;
  latency_ms?: number | null;
  raw_text?: string | null;
}

/** Кнопка инлайн-клавиатуры. data — готовый callback_data (callback.ts). */
export interface InlineButton {
  text: string;
  data: string;
}

/**
 * Один экран-сообщение. Текст — Telegram HTML: всё динамическое в нём уже
 * экранировано (html.ts). Постоянную клавиатуру экран не несёт — её ставит
 * конвейер там, где нет инлайн-кнопок.
 */
export interface Screen {
  text: string;
  buttons?: InlineButton[][];
  /**
   * Запретить пересылку (списки участников). Такой экран ВСЕГДА уходит новым
   * сообщением: у отредактированного сообщения protect_content не ставится.
   */
  protect?: boolean;
  /** Файл документом вместо текста (CSV). text — подпись к файлу. */
  document?: { filename: string; content: string };
}
