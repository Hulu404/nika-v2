import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { MoodKey } from "@/types/app";
import {
  addPeriodMark,
  deleteDailyState,
  normalizeMoods,
  removePeriodMark,
  upsertDailyState,
} from "@/lib/rhythm";

type Client = SupabaseClient<Database>;

/**
 * Local-first очередь отметок раздела «Мой ритм».
 *
 * Идея: UI применяет отметку мгновенно (оптимистично) и кладёт операцию в
 * outbox в localStorage. Когда есть сеть — очередь сливается в Supabase. Экран
 * ещё не написан (следующие промты) — это готовый механизм, который он вызовет.
 *
 * Разрешение конфликта — «последняя запись за дату побеждает»: очередь хранится
 * как словарь по ключу даты, поэтому новая операция за тот же день затирает
 * прежнюю. При сливе тот же день ещё раз перезапишется в БД (upsert), так что
 * победит последняя по времени запись независимо от порядка доставки.
 */

const STORAGE_KEY = "nika-rhythm-outbox";

/** Операция состояния дня (upsert или удаление) — обе про один день. */
type DailyOp =
  | { kind: "daily_state"; date: string; moods: MoodKey[]; ran: boolean | null; note: string | null; updatedAt: number }
  | { kind: "daily_state_delete"; date: string; updatedAt: number };

/** Операция отметки месячных за день. */
type PeriodOp = { kind: "period_mark"; date: string; marked: boolean; updatedAt: number };

type OutboxEntry = DailyOp | PeriodOp;

/** Ключ дедупликации: одна активная операция на «сущность за дату». */
function keyOf(entry: OutboxEntry): string {
  return entry.kind === "period_mark" ? `period:${entry.date}` : `state:${entry.date}`;
}

type Outbox = Record<string, OutboxEntry>;

// ── Хранилище ──────────────────────────────────────────────────────────────────

function canUseStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function readOutbox(): Outbox {
  if (!canUseStorage()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Outbox) : {};
  } catch {
    return {};
  }
}

function writeOutbox(box: Outbox): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(box));
  } catch {
    /* переполнение/приватный режим — молча игнорируем, данные не критичны */
  }
}

/** Кладёт операцию в очередь, затирая прежнюю за тот же день (last-write-wins). */
function enqueue(entry: OutboxEntry): void {
  const box = readOutbox();
  box[keyOf(entry)] = entry;
  writeOutbox(box);
}

/** Сколько операций ждёт синхронизации. */
export function pendingCount(): number {
  return Object.keys(readOutbox()).length;
}

// ── Публичный API постановки в очередь ──────────────────────────────────────────

export function enqueueDailyState(input: {
  date: string;
  moods: readonly string[];
  ran?: boolean | null;
  note?: string | null;
}): void {
  enqueue({
    kind: "daily_state",
    date: input.date,
    moods: normalizeMoods(input.moods),
    ran: input.ran ?? null,
    note: input.note ?? null,
    updatedAt: Date.now(),
  });
}

export function enqueueDeleteDailyState(date: string): void {
  enqueue({ kind: "daily_state_delete", date, updatedAt: Date.now() });
}

export function enqueuePeriodMark(date: string, marked: boolean): void {
  enqueue({ kind: "period_mark", date, marked, updatedAt: Date.now() });
}

// ── Слив очереди ────────────────────────────────────────────────────────────────

async function applyEntry(supabase: Client, userId: string, entry: OutboxEntry): Promise<string | null> {
  switch (entry.kind) {
    case "daily_state":
      return upsertDailyState(supabase, {
        userId,
        date: entry.date,
        moods: entry.moods,
        ran: entry.ran,
        note: entry.note,
      });
    case "daily_state_delete":
      return deleteDailyState(supabase, userId, entry.date);
    case "period_mark":
      return entry.marked
        ? addPeriodMark(supabase, userId, entry.date)
        : removePeriodMark(supabase, userId, entry.date);
  }
}

/**
 * Сливает очередь в Supabase. Операции применяются в порядке появления
 * (по updatedAt); успешные удаляются из очереди, неуспешные остаются до
 * следующей попытки. Возвращает число доставленных операций.
 */
export async function flushOutbox(supabase: Client, userId: string): Promise<number> {
  if (!canUseStorage()) return 0;
  const box = readOutbox();
  const entries = Object.values(box).sort((a, b) => a.updatedAt - b.updatedAt);
  let delivered = 0;

  for (const entry of entries) {
    const err = await applyEntry(supabase, userId, entry);
    if (err) {
      console.error("[rhythm-outbox] flush failed:", err);
      continue; // оставляем в очереди, попробуем позже
    }
    // Удаляем только если за это время запись не перезаписали новее.
    const current = readOutbox();
    const key = keyOf(entry);
    if (current[key]?.updatedAt === entry.updatedAt) {
      delete current[key];
      writeOutbox(current);
    }
    delivered += 1;
  }
  return delivered;
}

/**
 * Подписывает слив очереди на возвращение сети. Один слив выполняется сразу
 * (если онлайн). Возвращает функцию отписки — UI вызовет её при размонтировании.
 */
export function startRhythmSync(supabase: Client, userId: string): () => void {
  if (typeof window === "undefined") return () => {};

  const flush = () => {
    if (navigator.onLine) void flushOutbox(supabase, userId);
  };

  flush();
  window.addEventListener("online", flush);
  return () => window.removeEventListener("online", flush);
}
