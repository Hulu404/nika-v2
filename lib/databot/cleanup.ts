import { tgAdmin } from "../telegram/supabase";
import { databotConfigured } from "./config";
import { mskHour, mskToday } from "./time";

/**
 * Ежедневная уборка бота данных (ТЗ, раздел 7). Своего расписания нет: её
 * зовёт существующий 15-минутный тикер из instrumentation.ts, а решает «пора
 * ли» cleanupDue — первый проход после 04:00 МСК. Четыре утра — чтобы уборка
 * не пересекалась с вечерней работой команды и утренними сводками.
 *
 * Все операции идемпотентны: повторный проход (деплой в 04:10, два процесса
 * на релизе) удаляет то, что уже удалено, то есть ничего. Поэтому отметка
 * «сегодня убрано» — экономия запросов, а не защита от двойного эффекта.
 */

/** Неиспользованное приглашение живёт 48 часов; через неделю строка уже не нужна даже для разбора. */
const INVITE_TTL_DAYS = 7;
/** raw_text — то, что человек написал боту, то есть потенциально ПДн (152-ФЗ, раздел 8). */
const RAW_TEXT_TTL_DAYS = 30;
/** Журнал нужен для «Команды» и разбора ошибок; полгода — с запасом на квартальный разбор. */
const AUDIT_TTL_DAYS = 180;
/** Шаг формы, брошенный на сутки, человек уже не продолжит. */
const SESSION_TTL_DAYS = 1;

/** С этого московского часа уборка считается «на сегодня». */
const CLEANUP_HOUR_MSK = 4;

/**
 * Отметка последнего прохода — в tg_sessions, а не в памяти процесса: тикер
 * делает первый проход на каждом деплое, и с памятью каждый релиз гонял бы
 * уборку заново. Своя таблица ради одной даты — перебор.
 *
 * Ключ намеренно НЕ вида data:… — сама уборка стирает ключи 'data:%' старше
 * суток, и отметка под таким префиксом стёрла бы сама себя. С префиксом
 * databot: она к тому же не пересекается с сессиями основного бота (ключ —
 * голый chat_id) и форм бота данных (data:<chat_id>).
 */
const MARK_KEY = "databot:cleanup";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Пора ли убирать: московский час ≥ 4 и сегодня (по Москве) ещё не убирали. */
export function cleanupDue(lastRunYmd: string | null, now: Date): boolean {
  return mskHour(now) >= CLEANUP_HOUR_MSK && lastRunYmd !== mskToday(now);
}

function ago(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

export async function runDatabotCleanup(
  now = new Date(),
): Promise<{ status: "absent" | "not_due" | "done"; detail?: string }> {
  // Без токена бота в этом окружении нет — и трогать его таблицы незачем:
  // миграции 037 здесь может и не быть.
  if (!databotConfigured()) return { status: "absent" };

  const db = tgAdmin();

  const { data: mark, error: markErr } = await db
    .from("tg_sessions")
    .select("value")
    .eq("key", MARK_KEY)
    .maybeSingle();
  // Не прочитали отметку — не убираем: лучше пропустить тик, чем на каждом
  // 15-минутном проходе молотить базу, пока она болеет.
  if (markErr) throw new Error(`databot cleanup: отметка не прочитана: ${markErr.message}`);

  const lastYmd =
    mark && typeof (mark.value as { ymd?: unknown } | null)?.ymd === "string"
      ? ((mark.value as { ymd: string }).ymd)
      : null;
  if (!cleanupDue(lastYmd, now)) return { status: "not_due" };

  // Каждая операция сама по себе: сбой одной не должен оставить несделанными
  // остальные — обнуление raw_text важнее, чем удаление старых приглашений.
  // Тип результата задан явно и узко: выводить его из цепочки PostgREST-
  // билдеров tsc не осиливает («type instantiation is excessively deep»).
  type OpResult = { error: { message: string } | null; count: number | null };
  const ops: Array<{ name: string; run: () => Promise<OpResult> }> = [
    {
      name: "приглашения",
      run: async (): Promise<OpResult> =>
        await db
          .from("databot_invites")
          .delete({ count: "exact" })
          .is("used_at", null)
          .lt("created_at", ago(now, INVITE_TTL_DAYS)),
    },
    {
      name: "raw_text",
      run: async (): Promise<OpResult> =>
        await db
          .from("databot_audit")
          .update({ raw_text: null }, { count: "exact" })
          .not("raw_text", "is", null)
          .lt("created_at", ago(now, RAW_TEXT_TTL_DAYS)),
    },
    {
      name: "журнал",
      run: async (): Promise<OpResult> =>
        await db
          .from("databot_audit")
          .delete({ count: "exact" })
          .lt("created_at", ago(now, AUDIT_TTL_DAYS)),
    },
    {
      name: "сессии",
      run: async (): Promise<OpResult> =>
        await db
          .from("tg_sessions")
          .delete({ count: "exact" })
          .like("key", "data:%")
          .lt("updated_at", ago(now, SESSION_TTL_DAYS)),
    },
  ];

  const parts: string[] = [];
  let failed = 0;
  for (const op of ops) {
    try {
      const { error, count } = await op.run();
      if (error) {
        failed++;
        console.error(`[databot] уборка: ${op.name} — ${error.message}`);
      } else {
        parts.push(`${op.name} ${count ?? 0}`);
      }
    } catch (err) {
      failed++;
      console.error(`[databot] уборка: ${op.name} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Отметку ставим, только если прошло всё: иначе упавшая операция ждала бы
  // до завтра, а так повторится на следующем тике.
  if (failed > 0) {
    throw new Error(`databot cleanup: не прошло операций ${failed} из ${ops.length}`);
  }

  const { error: saveErr } = await db
    .from("tg_sessions")
    .upsert({ key: MARK_KEY, value: { ymd: mskToday(now) }, updated_at: now.toISOString() }, { onConflict: "key" });
  if (saveErr) {
    // Уборка сделана; без отметки следующий тик просто повторит её вхолостую.
    console.error("[databot] уборка: отметка не сохранена —", saveErr.message);
  }

  return { status: "done", detail: parts.join(", ") };
}
