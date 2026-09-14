import { tgAdmin } from "../telegram/supabase";
import { COFFEE_RUN_PACES } from "../coffeerun/pace";
import type { RunKey } from "./runs";

/**
 * Цифры забега для команды: сколько записалось, сколько подтвердило участие в
 * боте, кому ушло напоминание и кто до него не дотянется.
 *
 * Читает ТОЛЬКО coffee_run_signups и coffee_run_invites — те же таблицы, из
 * которых живёт основной бот. Своего состояния здесь нет специально: команда
 * должна видеть ровно ту картину, по которой бот принимает решения, иначе
 * начнутся разговоры «у бота одно, в сводке другое».
 *
 * Выборка всегда по ПАРЕ (spot, run_date). Забеги на Усачёвой и в Лужниках
 * стоят в соседние дни и иногда в один — по одной дате они бы слиплись, и
 * пейсер поехал бы не туда, см. комментарий в миграции 031.
 *
 * Разбор строк вынесен в чистую summarizeSignups: считать людей по статусам —
 * ровно то место, где ошибка тихая и дорогая, поэтому оно проверяется тестами
 * без базы.
 */

/** Строка заявки в том виде, в каком её читает командный бот. */
export interface SignupRow {
  name: string;
  contact: string;
  pace: string | null;
  created_at: string;
  confirmed_at: string | null;
  reminder_sent_at: string | null;
  tg_username: string | null;
  tg_chat_id: number | null;
}

/**
 * Где человек в воронке забега. Порядок важен: он же порядок показа в списках,
 * от «всё хорошо» к «нужно что-то сделать».
 *
 *   reminded    — подтвердил и получил напоминание за сутки;
 *   waiting     — подтвердил, напоминание ещё не ушло (рано или не дошла очередь);
 *   unconfirmed — оставил заявку, но в боте не подтвердился: бот до него не
 *                 дотянется вообще ничем — ни напоминанием, ни переносом, ни
 *                 отменой. Это и есть главная строка сводки.
 */
export type SignupStatus = "reminded" | "waiting" | "unconfirmed";

export interface SignupView extends SignupRow {
  status: SignupStatus;
}

export interface PaceBucket {
  /** «6:30» или null — темп не выбирали (заявка со старой версии формы). */
  pace: string | null;
  count: number;
}

export interface RunStats {
  total: number;
  reminded: number;
  waiting: number;
  unconfirmed: number;
  /** Подтвердившие = те, до кого бот дотянется: reminded + waiting. */
  confirmed: number;
  /** По темпам, в порядке из lib/coffeerun/pace.ts; «без темпа» последним. */
  byPace: PaceBucket[];
  /** Заявок за последние сутки — видно, набирается забег или встал. */
  last24h: number;
  /** ISO последней заявки; null — заявок нет вовсе. */
  lastSignupAt: string | null;
  /** ISO последнего ушедшего напоминания; null — рассылка ещё не начиналась. */
  lastReminderAt: string | null;
}

/** Статус одной заявки. Единственное место, где он определяется. */
export function signupStatus(row: SignupRow): SignupStatus {
  if (row.reminder_sent_at) return "reminded";
  // Напоминание уходит только тем, у кого есть и подтверждение, и чат —
  // ровно такой фильтр стоит в lib/coffeerun/reminder-dispatch.ts. Заявка с
  // confirmed_at, но без tg_chat_id в рассылку не попадёт никогда, поэтому
  // честнее показать её как неподтверждённую, чем вечно «ждёт».
  if (row.confirmed_at && row.tg_chat_id) return "waiting";
  return "unconfirmed";
}

/** Заявки со статусом, отсортированные: сначала кого надо трогать руками. */
export function viewSignups(rows: SignupRow[]): SignupView[] {
  const order: Record<SignupStatus, number> = { unconfirmed: 0, waiting: 1, reminded: 2 };
  return rows
    .map((row) => ({ ...row, status: signupStatus(row) }))
    .sort(
      (a, b) =>
        order[a.status] - order[b.status] || a.created_at.localeCompare(b.created_at),
    );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Цифры забега из уже прочитанных строк. Чистая — без базы и без часов. */
export function summarizeSignups(rows: SignupRow[], now: Date = new Date()): RunStats {
  const views = viewSignups(rows);
  const count = (s: SignupStatus) => views.filter((v) => v.status === s).length;

  // Темпы в порядке из pace.ts (от быстрого к спокойному), «без темпа» —
  // последним. Порядок задан явно, а не сортировкой по количеству: пейсеры
  // читают эту разбивку как список своих групп, и он не должен прыгать.
  const byPace: PaceBucket[] = COFFEE_RUN_PACES.map((p) => ({
    pace: p.value,
    count: rows.filter((r) => r.pace === p.value).length,
  }));
  const noPace = rows.filter((r) => !r.pace).length;
  if (noPace > 0) byPace.push({ pace: null, count: noPace });

  const since = now.getTime() - DAY_MS;
  const maxIso = (values: (string | null)[]): string | null =>
    values.filter((v): v is string => !!v).sort().at(-1) ?? null;

  return {
    total: rows.length,
    reminded: count("reminded"),
    waiting: count("waiting"),
    unconfirmed: count("unconfirmed"),
    confirmed: count("reminded") + count("waiting"),
    byPace,
    last24h: rows.filter((r) => Date.parse(r.created_at) >= since).length,
    lastSignupAt: maxIso(rows.map((r) => r.created_at)),
    lastReminderAt: maxIso(rows.map((r) => r.reminder_sent_at)),
  };
}

/**
 * Заявки на конкретный забег. Ошибку базы НЕ проглатываем в пустой список:
 * «ноль записавшихся» и «база не ответила» — разные новости, и вторую команда
 * должна увидеть как аварию, а не как тихий ноль.
 */
export async function fetchRunSignups(run: RunKey): Promise<SignupRow[]> {
  const { data, error } = await tgAdmin()
    .from("coffee_run_signups")
    .select(
      "name, contact, pace, created_at, confirmed_at, reminder_sent_at, tg_username, tg_chat_id",
    )
    .eq("spot", run.spot)
    .eq("run_date", run.date)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`не смогла прочитать заявки: ${error.message}`);
  return (data ?? []) as SignupRow[];
}

/** Цифры забега одним вызовом — самый частый запрос бота. */
export async function fetchRunStats(run: RunKey, now: Date = new Date()): Promise<RunStats> {
  return summarizeSignups(await fetchRunSignups(run), now);
}

/**
 * Скольким уже ушло приглашение «открылась запись» на этот забег. Считаем по
 * coffee_run_invites — той же таблице, которой рассылка держит дедуп
 * (lib/coffeerun/invite-dispatch.ts). Ноль по будущему забегу в понедельник
 * днём значит, что тикер не отработал, — это ровно то, ради чего команда и
 * спрашивает.
 */
export async function fetchInviteCount(run: RunKey): Promise<number> {
  const { count, error } = await tgAdmin()
    .from("coffee_run_invites")
    .select("chat_id", { count: "exact", head: true })
    .eq("spot", run.spot)
    .eq("run_date", run.date);
  if (error) {
    console.error("[team-stats] fetchInviteCount:", error.message);
    return 0;
  }
  return count ?? 0;
}
