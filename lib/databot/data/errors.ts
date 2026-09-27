/**
 * Ноль и авария — разные новости (принцип withData из lib/team/bot.ts).
 * Любой сбой базы в слое данных бросает DatabotDataError с кодом, а не
 * возвращает пустоту: «ноль заявок» и «база не ответила» человек должен
 * различать с первого взгляда.
 *
 * Коды совпадают с databot_audit.error (раздел 0.4 файла промтов).
 */
export type DataErrorCode = "db_timeout" | "db_error";

export class DatabotDataError extends Error {
  readonly code: DataErrorCode;

  constructor(code: DataErrorCode, message: string) {
    super(message);
    this.name = "DatabotDataError";
    this.code = code;
  }
}

/**
 * Таймаут или нет. supabase-js при срабатывании abortSignal не бросает, а
 * возвращает error с «AbortError» в message; Postgres при statement_timeout —
 * код 57014. Всё остальное — просто сбой базы.
 */
export function classifyDbError(err: unknown): DataErrorCode {
  if (err instanceof DatabotDataError) return err.code;
  const e = err as { name?: unknown; message?: unknown; code?: unknown } | null;
  const name = typeof e?.name === "string" ? e.name : "";
  const message = typeof e?.message === "string" ? e.message : String(err ?? "");
  if (name === "AbortError" || name === "TimeoutError") return "db_timeout";
  if (e?.code === "57014") return "db_timeout";
  if (/abort|timed? ?out|timeout/i.test(message)) return "db_timeout";
  return "db_error";
}

export type DataResult<T> = { ok: true; value: T } | { ok: false; error: DataErrorCode };

/**
 * Выполнить чтение данных и вернуть либо значение, либо код аварии — без
 * исключения наружу. Для обработчиков, которым нужно показать часть экрана,
 * даже если один из запросов упал. Конвейер ловит и брошенные ошибки сам.
 */
export async function withData<T>(work: () => Promise<T>): Promise<DataResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (err) {
    const code = classifyDbError(err);
    // chat_id и параметры в прод-лог не пишем — только код и текст сбоя.
    console.error(`[databot] data (${code}):`, err instanceof Error ? err.message : String(err));
    return { ok: false, error: code };
  }
}
