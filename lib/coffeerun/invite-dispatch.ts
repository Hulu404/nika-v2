import { tgAdmin } from "../telegram/supabase";
import { sendBotMessage } from "../telegram/send";
import { localParts, DEFAULT_TZ } from "../telegram/schedule";
import { inviteText, inviteKeyboard } from "../telegram/invite-copy";
import { runsDueForInvite, INVITE_HOUR_MSK, INVITE_WEEKDAY } from "./invite-schedule";
import { runBySpot, runByDate, type CoffeeRun } from "./run";

/**
 * Рассылка приглашений «открылась запись на новый забег».
 *
 * Кому: тем, кто уже бегал НА ЭТОМ СПОТЕ. Забеги разнесены по городу, и звать
 * человека из Лужников на Усачёву — способ получить отписку вместо участника.
 * Спот — единственный сегмент: темп, частота и прочее здесь не при чём.
 *
 * Двое вызывающих:
 *   • тикер в instrumentation.ts — сам, по понедельникам с 10:00 МСК;
 *   • команда /open у организатора — вручную, с предпросмотром.
 *
 * Дедуп — таблица coffee_run_invites, а НЕ память процесса (как у /moved и
 * /cancel). Разница принципиальная: те объявления уходят по кнопке и под
 * присмотром, а это уходит само, причём тикер делает первый проход сразу при
 * старте процесса — то есть на каждом деплое. Дедуп в памяти означал бы
 * повторную рассылку семи десяткам человек после понедельничного релиза.
 *
 * Отписку уважаем: чат, у которого в tg_bindings стоит tg_opt_in = false
 * (человек нажал /stop), пропускаем. Здесь это обязательно — в отличие от
 * переноса и отмены, на приглашение человек не подписывался, он просто когда-то
 * с нами бежал.
 */

/** Троттлинг под лимиты Telegram (~30 msg/sec суммарно) — шлём последовательно. */
const THROTTLE_MS = 1100;

/**
 * Порция за автоматический проход: держим ниже maxDuration=60s крон-роута.
 * Остаток заберёт следующий тик — они идут каждые 15 минут, так что сотня
 * человек разъезжается в пределах часа.
 */
export const MAX_SENDS_PER_TICK = 25;

/**
 * Порция за ручной проход. Рассылка из /open идёт в фоне, вебхук её не ждёт,
 * поэтому лимит выше — как у объявлений о переносе.
 */
export const MAX_SENDS_MANUAL = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Кого зовём: чат и имя из его последней заявки на этом споте. */
interface Candidate {
  chatId: number;
  name: string;
}

interface SignupRow {
  name: string;
  tg_chat_id: number;
  run_date: string;
  created_at: string;
}

export interface InviteAudience {
  /** Кому реально уйдёт (уже без отписавшихся, приглашённых и записавшихся). */
  due: Candidate[];
  /** Всего бегавших на споте — знаменатель для отчёта. */
  alumni: number;
  alreadyInvited: number;
  optedOut: number;
  registered: number;
}

export interface InviteDispatchOptions {
  /** Слаг спота — позвать на ближайший забег этого спота. */
  spot?: string | null;
  /** Точная дата забега (YYYY-MM-DD) — приоритетнее спота. */
  runDate?: string | null;
  /** Только посчитать, ничего не отправляя. */
  dryRun?: boolean;
  /** Сколько отправок максимум за проход. */
  limit?: number;
  now?: Date;
}

export interface InviteDispatchResult {
  ok: boolean;
  error?: string;
  dryRun?: boolean;
  skipped?: string;
  /** Забеги, попавшие в проход (спот + дата). */
  runs?: { spot: string; date: string }[];
  alumni?: number;
  alreadyInvited?: number;
  optedOut?: number;
  registered?: number;
  wouldSend?: number;
  sent?: number;
  blocked?: number;
  failed?: number;
  hasMore?: boolean;
  msk?: { date: string; weekday: number; hour: number };
}

/** Чаты, которые просили не писать (/stop). Множество маленькое — берём целиком. */
async function optedOutChats(): Promise<Set<number>> {
  const { data, error } = await tgAdmin()
    .from("tg_bindings")
    .select("chat_id")
    .eq("tg_opt_in", false);

  if (error) {
    // Молча разослать тем, кто просил не писать, нельзя — это хуже, чем не
    // разослать вовсе. Падаем, проход повторится следующим тиком.
    console.error("[coffeerun-invite] opt-out select:", error.message);
    throw new Error("DB error");
  }

  return new Set(((data as { chat_id: number }[] | null) ?? []).map((r) => r.chat_id));
}

/** Кому уже уходило приглашение на этот забег. */
async function invitedChats(run: CoffeeRun): Promise<Set<number>> {
  const { data, error } = await tgAdmin()
    .from("coffee_run_invites")
    .select("chat_id")
    .eq("spot", run.spot)
    .eq("run_date", run.date);

  if (error) {
    console.error("[coffeerun-invite] invited select:", error.message);
    throw new Error("DB error");
  }

  return new Set(((data as { chat_id: number }[] | null) ?? []).map((r) => r.chat_id));
}

/**
 * Аудитория приглашения.
 *
 * Из всех заявок этого спота собираем уникальные чаты (один человек бегал с
 * нами не раз — сообщение всё равно одно) и вычитаем три группы: уже
 * приглашённых на этот забег, уже записавшихся на него и попросивших не писать.
 *
 * Запись «уже записан» проверяем по самим заявкам, а не по приглашениям: человек
 * мог прийти с лендинга сам, и звать его туда, где он уже есть, глупо.
 */
export async function inviteAudience(run: CoffeeRun): Promise<InviteAudience> {
  const { data, error } = await tgAdmin()
    .from("coffee_run_signups")
    .select("name, tg_chat_id, run_date, created_at")
    .eq("spot", run.spot)
    .not("tg_chat_id", "is", null)
    .not("confirmed_at", "is", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[coffeerun-invite] signups select:", error.message);
    throw new Error("DB error");
  }

  const rows = (data as SignupRow[] | null) ?? [];

  // Имя берём из самой свежей заявки чата — список отсортирован по убыванию,
  // поэтому первое вхождение и есть последнее по времени.
  const names = new Map<number, string>();
  const registered = new Set<number>();

  for (const row of rows) {
    if (!names.has(row.tg_chat_id)) names.set(row.tg_chat_id, row.name);
    if (row.run_date === run.date) registered.add(row.tg_chat_id);
  }

  const [invited, optedOut] = await Promise.all([invitedChats(run), optedOutChats()]);

  const due: Candidate[] = [];
  let skippedInvited = 0;
  let skippedOptedOut = 0;
  let skippedRegistered = 0;

  for (const [chatId, name] of names) {
    if (invited.has(chatId)) {
      skippedInvited++;
      continue;
    }
    if (registered.has(chatId)) {
      skippedRegistered++;
      continue;
    }
    if (optedOut.has(chatId)) {
      skippedOptedOut++;
      continue;
    }
    due.push({ chatId, name });
  }

  return {
    due,
    alumni: names.size,
    alreadyInvited: skippedInvited,
    optedOut: skippedOptedOut,
    registered: skippedRegistered,
  };
}

/** Какие забеги берём в проход: точная дата, спот или понедельничное окно. */
function targetRuns(opts: InviteDispatchOptions, now: Date): CoffeeRun[] {
  if (opts.runDate) {
    const run = runByDate(opts.runDate);
    return run ? [run] : [];
  }
  if (opts.spot) {
    const run = runBySpot(opts.spot, now);
    return run ? [run] : [];
  }
  const msk = localParts(DEFAULT_TZ, now);
  return runsDueForInvite(msk.weekday, msk.hour, now);
}

export async function dispatchCoffeeRunInvites(
  opts: InviteDispatchOptions = {},
): Promise<InviteDispatchResult> {
  const now = opts.now ?? new Date();
  const msk = localParts(DEFAULT_TZ, now);
  const base = { msk: { date: msk.ymd, weekday: msk.weekday, hour: msk.hour } };

  const runs = targetRuns(opts, now);

  if (runs.length === 0) {
    const why = opts.runDate
      ? `нет забега с датой ${opts.runDate}`
      : opts.spot
        ? `нет забега на споте ${opts.spot}`
        : msk.weekday !== INVITE_WEEKDAY
          ? "не понедельник"
          : msk.hour < INVITE_HOUR_MSK
            ? `рано: зовём с ${INVITE_HOUR_MSK}:00 МСК`
            : "звать не на что — будущих забегов нет";
    return { ok: true, sent: 0, skipped: why, ...base };
  }

  const limit = opts.limit ?? MAX_SENDS_PER_TICK;
  const admin = tgAdmin();

  let alumni = 0;
  let alreadyInvited = 0;
  let optedOut = 0;
  let registered = 0;
  let wouldSend = 0;
  let sent = 0;
  let blocked = 0;
  let failed = 0;
  let hasMore = false;
  // Бюджет общий на все забеги прохода: остаток заберёт следующий тик.
  let budget = limit;

  for (const run of runs) {
    const audience = await inviteAudience(run);
    alumni += audience.alumni;
    alreadyInvited += audience.alreadyInvited;
    optedOut += audience.optedOut;
    registered += audience.registered;

    if (budget <= 0) {
      if (audience.due.length > 0) hasMore = true;
      continue;
    }

    const due = audience.due.slice(0, budget);
    if (audience.due.length > due.length) hasMore = true;

    if (opts.dryRun) {
      wouldSend += due.length;
      budget -= due.length;
      continue;
    }

    const keyboard = inviteKeyboard(run);

    for (const person of due) {
      const res = await sendBotMessage(person.chatId, inviteText(person, run), keyboard);
      budget--;

      if (res.ok) sent++;
      else if (res.blocked) blocked++;
      else {
        // Транзиентная ошибка (429 и прочее): НЕ помечаем — заберём следующим
        // проходом. Лучше повтор попытки, чем молча потерянное приглашение.
        failed++;
        continue;
      }

      // Помечаем и доставленных, и заблокировавших бота: второй попытки не будет.
      // Порядок «сначала отправить, потом пометить» — как у напоминаний: падение
      // между шагами даёт в худшем случае повтор, а не тишину. on conflict
      // do nothing прячет гонку двух проходов (тикер + ручной /open).
      const { error: markErr } = await admin
        .from("coffee_run_invites")
        .upsert(
          { spot: run.spot, run_date: run.date, chat_id: person.chatId },
          { onConflict: "spot,run_date,chat_id", ignoreDuplicates: true },
        );
      if (markErr) console.error("[coffeerun-invite] mark:", markErr.message);

      await sleep(THROTTLE_MS);
    }
  }

  const runsInfo = runs.map((r) => ({ spot: r.spot, date: r.date }));

  if (opts.dryRun) {
    return {
      ok: true,
      dryRun: true,
      runs: runsInfo,
      alumni,
      alreadyInvited,
      optedOut,
      registered,
      wouldSend,
      hasMore,
      ...base,
    };
  }

  return {
    ok: true,
    runs: runsInfo,
    alumni,
    alreadyInvited,
    optedOut,
    registered,
    sent,
    blocked,
    failed,
    hasMore,
    ...base,
  };
}
