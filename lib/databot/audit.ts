import type { DatabotStore } from "./data/store";
import type { AnyReport, AuditEntry, Intent, Zone } from "./types";

/**
 * Журнал databot_audit (0.4 файла промтов, 4.11 ТЗ). Здесь — всё, что
 * решает, ЧТО попадает в журнал: конвейер только зовёт buildAuditEntry и
 * recordAudit, а не собирает строку сам, чтобы правило «никаких персональных
 * данных» держалось в одном месте.
 */

/**
 * Ключи params, которые можно хранить: спот, дата, период, код метки, slug
 * статьи, зона приглашения, страница списка и флаг шага формы. Список белый:
 * новый параметр (chat_id цели, токен, текст) в журнал не попадёт, пока его
 * не добавят сюда сознательно.
 */
export const AUDIT_PARAM_KEYS = ["spot", "date", "period", "code", "slug", "zone", "page", "form"] as const;

/** raw_text длиннее этого режем: словарю правил хватает, а журнал не пухнет. */
export const AUDIT_RAW_TEXT_MAX = 500;

export function auditParams(intent: Intent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of AUDIT_PARAM_KEYS) {
    const value = intent.params[key];
    if (value !== undefined) out[key] = value;
  }
  // Ответ на шаг формы — не вопрос текстом: метрика распознавания его не
  // считает, поэтому флаг ставим по intent, а не надеемся на params.
  if (intent.form) out.form = true;
  return out;
}

/**
 * Записать строку журнала. Текст вопроса храним только у unknown — по нему
 * пополняют словарь правил; у распознанных он лишний и может нести имена.
 * Сбой журнала ответ не ломает: store.writeAudit и так не должен бросать, но
 * ловим и здесь — упавший журнал хуже молча потерянной строки.
 */
export async function recordAudit(store: DatabotStore, entry: AuditEntry): Promise<void> {
  const raw = entry.report === "unknown" && entry.raw_text ? entry.raw_text.slice(0, AUDIT_RAW_TEXT_MAX) : null;
  try {
    await store.writeAudit({ ...entry, raw_text: raw });
  } catch (err) {
    // Без chat_id и текста: в прод-логах не должно быть, кто что спрашивал.
    console.error("[databot] audit:", err instanceof Error ? err.message : String(err));
  }
}

/** Сборка строки для конвейера: отчёт, источник и параметры — из разобранного запроса. */
export function buildAuditEntry(args: {
  chatId: number;
  zone: Zone | null;
  intent: Intent | null;
  /** Перекрывает intent.report: stale, rate_limited, no_member — когда разбора не было или он не важен. */
  report?: AnyReport;
  ok: boolean;
  error?: string | null;
  /** Date.now() в начале обработки апдейта. */
  startedAt: number;
  now?: number;
}): AuditEntry {
  const { intent } = args;
  const now = args.now ?? Date.now();
  return {
    chat_id: args.chatId,
    zone: args.zone,
    // Без разбора и без явного report — unknown: строка всё равно должна быть.
    report: args.report ?? intent?.report ?? "unknown",
    params: intent ? auditParams(intent) : {},
    source: intent?.source ?? null,
    ok: args.ok,
    error: args.error ?? null,
    latency_ms: Math.max(0, now - args.startedAt),
    raw_text: intent?.rawText ?? null,
  };
}
