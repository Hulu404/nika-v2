import { InlineKeyboard } from "grammy";
import { runWhenWhere, REMINDER_HOUR_MSK, dayBefore } from "../coffeerun/run";
import { formatPace } from "../coffeerun/pace";
import { DEFAULT_TZ } from "../telegram/schedule";
import type { RunStats, SignupView, SignupStatus } from "./stats";
import { runDateLabel, type RunKey, type TeamRun } from "./runs";
import type { Dynamics, RunAggregate } from "./history";
import type { TeamMember } from "./access";
import { isFounder } from "./config";
import type { AssignedTask } from "../databot/task-list";
import { CLUBS, clubByKey } from "./clubs";
import { coffeeRunTitle, groupByDay, itemClub, type ScheduleItem, type TeamEvent, type TeamEventKind } from "./events";

/**
 * Все тексты и клавиатуры командного бота — здесь, и здесь же ни одного
 * похода в базу. Разделение то же, что у poll-copy.ts: цифры считает stats.ts
 * и history.ts, слова подбирает copy.ts, и слова можно проверить тестами, не
 * поднимая ни Supabase, ни Telegram.
 *
 * Тон другой, чем у бота участников. Тот разговаривает с человеком, который
 * бежит; этот — с человеком, который в 9:20 стоит на споте с телефоном в руке
 * и ему нужны цифры, а не забота. Отсюда короткие строки, одинаковые значки
 * статусов и ни одного лишнего абзаца.
 */

// ── Время ────────────────────────────────────────────────────────────────────
// Всё показываем по Москве. Забеги московские, команда московская, и «10:03»
// в сводке не должно требовать пересчёта в голове — даже если сервер в UTC,
// а человек читает из другого часового пояса.

/** «14 сентября, 10:03» по МСК. Пустой ввод → «—». */
export function mskDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: DEFAULT_TZ,
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** «10:03» по МСК — когда день и так понятен из контекста. */
export function mskTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: DEFAULT_TZ,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

// ── Клавиатуры и callback_data ───────────────────────────────────────────────
// Формат данных короткий и плоский: `<вид>:<спот>:<дата>`. Ограничение
// Telegram — 64 байта, и в них надо поместиться вместе с датой.

export const TEAM_CALLBACK_RE = /^t(run|who|rem|con|all|his):.*$/;

type CallbackKind = "run" | "who" | "rem" | "con" | "all" | "his";

export function runCallback(kind: CallbackKind, run?: RunKey): string {
  return run ? `t${kind}:${run.spot}:${run.date}` : `t${kind}:`;
}

/** Разбор нажатия. null — данные не наши; run: null — забега больше не знаем. */
export function parseTeamCallback(
  data: string,
  runs: readonly TeamRun[],
): { kind: CallbackKind; run: TeamRun | null } | null {
  if (!TEAM_CALLBACK_RE.test(data)) return null;
  const [head, spot, date] = data.split(":");
  const kind = head.slice(1) as CallbackKind;
  if (!spot || !date) return { kind, run: null };
  return { kind, run: runs.find((r) => r.spot === spot && r.date === date) ?? null };
}

/** Кнопки под карточкой забега: всё, что про этот же забег. */
export function runCardKeyboard(run: TeamRun): InlineKeyboard {
  return new InlineKeyboard()
    .text("Список участников", runCallback("who", run))
    .row()
    .text("Напоминания", runCallback("rem", run))
    .text("Контакты", runCallback("con", run))
    .row()
    .text("Все забеги", runCallback("all"))
    .text("История", runCallback("his"));
}

/**
 * Сколько забегов показываем кнопками. Их набралось уже восемь и будет больше;
 * простыня кнопок до низа экрана — не список, а препятствие. Остальное живёт
 * в /history, где оно текстом и читается быстрее.
 */
const KEYBOARD_RUNS = 6;

export function runsKeyboard(runs: readonly TeamRun[]): InlineKeyboard | undefined {
  if (runs.length === 0) return undefined;
  const kb = new InlineKeyboard();
  for (const run of runs.slice(0, KEYBOARD_RUNS)) {
    kb.text(run.label, runCallback("run", run)).row();
  }
  if (runs.length > KEYBOARD_RUNS) kb.text("История целиком", runCallback("his")).row();
  return kb;
}

/** Кнопка «назад к забегу» под любым его подсписком. */
export function backToRunKeyboard(run: TeamRun): InlineKeyboard {
  return new InlineKeyboard()
    .text(`← ${run.label}`, runCallback("run", run))
    .row()
    .text("Все забеги", runCallback("all"));
}

// ── Сводки ───────────────────────────────────────────────────────────────────

const ICON: Record<SignupStatus, string> = {
  reminded: "✅",
  waiting: "⏳",
  unconfirmed: "⚠️",
};

/** Как человек подписан в списках: имя из заявки + ник для связи. */
export function personLabel(p: { name: string; tg_username: string | null }): string {
  return p.tg_username ? `${p.name} (@${p.tg_username})` : p.name;
}

/**
 * Сколько имён показываем в одном сообщении. У Telegram потолок 4096 символов,
 * строка участника — около 50, так что 60 помещаются с запасом на заголовок.
 * Остаток не теряем, а называем числом: «и ещё 12» честнее обрезанного списка.
 */
const LIST_LIMIT = 60;

function nameList(people: SignupView[], limit = LIST_LIMIT): string {
  if (people.length === 0) return "  —";
  const shown = people.slice(0, limit).map((p) => `  ${ICON[p.status]} ${personLabel(p)}`);
  if (people.length > limit) shown.push(`  … и ещё ${people.length - limit}`);
  return shown.join("\n");
}

/**
 * Одна строка забега в общем списке: название и три цифры.
 *
 * Берёт свод из архива, а не полную статистику забега: список и история
 * считаются одним запросом сразу по всем забегам, и ходить в базу ещё раз
 * ради трёх чисел на каждый забег незачем.
 */
export function runSummaryLine(run: TeamRun, agg: RunAggregate): string {
  return (
    `${run.label}${run.past ? " · прошёл" : ""}\n` +
    `  заявок ${agg.total} · подтвердили ${agg.confirmed} · напомнили ${agg.reminded}`
  );
}

/** /runs — забеги, которые в работе. Первый экран для всех, кто открыл бота. */
export function runsOverviewText(items: Array<{ run: TeamRun; agg: RunAggregate }>): string {
  if (items.length === 0) {
    return (
      "Забегов в расписании нет.\n\n" +
      "Новый заводится записью в lib/coffeerun/run.ts — до этого ни лендинг, " +
      "ни бот про него не знают. Что было раньше — /history."
    );
  }
  return [
    "Забеги в работе:",
    "",
    ...items.map(({ run, agg }) => runSummaryLine(run, agg)),
    "",
    "Подробности — кнопкой ниже. Прошедшие забеги — /history.",
  ].join("\n");
}

// ── История и динамика ───────────────────────────────────────────────────────

/**
 * /history — все забеги, которые знает база, сгруппированные по споту.
 *
 * По споту, а не одной лентой по датам: набор в Лужниках и на Усачёвой живёт
 * своей жизнью, и перемешанный список читается как шум. Внутри спота — от
 * свежих к старым, потому что сравнивают обычно с прошлым разом.
 */
export function historyText(
  items: Array<{ run: TeamRun; agg: RunAggregate }>,
  spotLabel: (spot: string) => string,
): string {
  if (items.length === 0) return "В базе нет ни одной заявки — историю строить не из чего.";

  const bySpot = new Map<string, Array<{ run: TeamRun; agg: RunAggregate }>>();
  for (const item of items) {
    const list = bySpot.get(item.run.spot) ?? [];
    list.push(item);
    bySpot.set(item.run.spot, list);
  }

  const blocks: string[] = [];
  for (const [spot, list] of bySpot) {
    const lines = list.map(({ run, agg }) => {
      const share = agg.total ? Math.round((agg.confirmed / agg.total) * 100) : 0;
      const dateOnly = run.label.split(", ").at(-1) ?? run.date;
      return (
        `  ${dateOnly}${run.past ? "" : " (впереди)"} — ` +
        `${agg.total} заявок, подтвердили ${agg.confirmed} (${share}%)`
      );
    });
    const totals = list.reduce((n, i) => n + i.agg.total, 0);
    const head =
      `${spotLabel(spot)} — ${list.length} ${plural(list.length, "забег", "забега", "забегов")}, ` +
      `${totals} ${plural(totals, "заявка", "заявки", "заявок")}`;
    blocks.push([head, ...lines].join("\n"));
  }

  return ["История забегов:", "", blocks.join("\n\n")].join("\n");
}

/**
 * Блок динамики: «сейчас столько, а в прошлые разы на этот же момент было
 * столько».
 *
 * Сравнение идёт на ту же точку отсчёта, и это главное свойство блока. Сравнить
 * сегодняшние 10 с финальными 37 прошлого забега легко и приятно, но это не
 * сравнение: две трети заявок приходят в последние двое суток, и такой «отрыв»
 * пугает на ровном месте.
 */
export function dynamicsLines(dyn: Dynamics): string[] {
  const at = `За ${dyn.daysBefore} ${plural(dyn.daysBefore, "день", "дня", "дней")} до старта:`;
  const lines = [at, `  сейчас — ${dyn.now}`];

  for (const p of dyn.previous) {
    // Забег, который к этому моменту ещё не набирали, показываем — но не как
    // ноль. Ноль читается как «людей не было», а было «не звали».
    lines.push(
      p.opened
        ? `  ${runDateLabel(p.date)} — было ${p.atSameLead}, в итоге ${p.final}`
        : `  ${runDateLabel(p.date)} — записи ещё не открывали, в итоге ${p.final}`,
    );
  }

  if (dyn.typical === null) {
    // Сравнивать не с чем — так и говорим. Молчаливое отсутствие вердикта
    // читалось бы как «всё нормально».
    lines.push("  → сравнить не с чем: раньше к этому дню запись ещё не открывали");
    return lines;
  }

  const diff = dyn.now - dyn.typical;
  const verdict = diff > 1 ? `на ${diff} больше` : diff < -1 ? `на ${-diff} меньше` : "столько же";
  // Одно наблюдение — это «в прошлый раз», а не «обычно». Разница не
  // стилистическая: «обычно» превращает случайное число в норму.
  const base =
    dyn.comparable === 1
      ? `чем в прошлый сравнимый раз (тогда — ${dyn.typical})`
      : `чем обычно (к этому моменту — ${dyn.typical})`;
  lines.push(`  → ${verdict}, ${base}`);
  return lines;
}

/**
 * «5 дней» / «1 день» / «2 дня» — чтобы сводка не говорила «за 1 дней».
 * Мелочь, но читают эти строки каждый день, и каждый день спотыкаются.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Разбивка по темпам — списком групп, как их видит пейсер на старте. */
function paceLines(stats: RunStats): string[] {
  const filled = stats.byPace.filter((b) => b.count > 0);
  if (filled.length === 0) return ["  —"];
  return filled.map((b) =>
    b.pace ? `  ${formatPace(b.pace)} — ${b.count}` : `  без темпа — ${b.count}`,
  );
}

/** /run — карточка забега: когда, где, сколько людей и что с рассылками. */
export function runCardText(
  run: TeamRun,
  stats: RunStats,
  invites: number,
  dyn: Dynamics | null = null,
  now: Date = new Date(),
): string {
  const lines = [
    run.label,
    // Время и адрес знает только расписание. У прошедшего забега его уже нет —
    // и выдумывать «обычное» время не будем: сводка про то, что было.
    run.scheduled ? runWhenWhere(run.scheduled) : "Забег прошёл.",
  ];
  if (run.scheduled) lines.push(`Дистанция ${run.scheduled.distance}.`);

  lines.push(
    "",
    `Заявок: ${stats.total}` + (stats.last24h ? ` (+${stats.last24h} за сутки)` : ""),
    `Подтвердили в боте: ${stats.confirmed}`,
    `Напоминание ушло: ${stats.reminded}`,
    `Ждут напоминания: ${stats.waiting}`,
    `Не подтвердились: ${stats.unconfirmed}`,
    "",
    "По темпу:",
    ...paceLines(stats),
  );

  if (dyn) lines.push("", ...dynamicsLines(dyn));

  lines.push(
    "",
    `Последняя заявка: ${mskDateTime(stats.lastSignupAt)}`,
    `Приглашений разослано: ${invites}`,
  );

  // Почему ещё нет напоминаний — самый частый вопрос по забегу, который ещё не
  // наступил. Отвечаем до того, как его зададут.
  if (stats.reminded === 0) {
    lines.push("", reminderWindowNote(run, now));
  }
  if (stats.unconfirmed > 0) {
    lines.push(
      "",
      `⚠️ ${stats.unconfirmed} чел. оставили заявку, но не подтвердились в боте — ` +
        "до них не дойдёт ни напоминание, ни перенос, ни отмена. Список — «Контакты».",
    );
  }
  return lines.join("\n");
}

/** Когда по этому забегу уходит напоминание — одной строкой. */
export function reminderWindowNote(run: TeamRun, now: Date = new Date()): string {
  const eve = dayBefore(run.date);
  const past =
    Date.parse(`${eve}T${String(REMINDER_HOUR_MSK).padStart(2, "0")}:00:00+03:00`) < now.getTime();
  return past
    ? `Окно рассылки (накануне, ${eve}, с ${REMINDER_HOUR_MSK}:00 МСК) уже прошло — ` +
        "если напоминаний нет, это повод посмотреть логи."
    : `Напоминания уйдут накануне, ${eve}, после ${REMINDER_HOUR_MSK}:00 МСК — ` +
        "рассылка идёт сама, раз в 15 минут проверяет окно.";
}

/** /who — поимённый список участников забега. */
export function rosterText(run: TeamRun, people: SignupView[]): string {
  if (people.length === 0) return `${run.label}\n\nЗаявок пока нет.`;
  const by = (s: SignupStatus) => people.filter((p) => p.status === s);
  return [
    `${run.label} — ${people.length} чел.`,
    "",
    `⚠️ Не подтвердились: ${by("unconfirmed").length}`,
    nameList(by("unconfirmed")),
    "",
    `⏳ Ждут напоминания: ${by("waiting").length}`,
    nameList(by("waiting")),
    "",
    `✅ Напоминание ушло: ${by("reminded").length}`,
    nameList(by("reminded")),
  ].join("\n");
}

/** /notif — кому ушло напоминание и во сколько, а кому не уйдёт и почему. */
export function remindersText(
  run: TeamRun,
  people: SignupView[],
  stats: RunStats,
  now: Date = new Date(),
): string {
  const reminded = people.filter((p) => p.status === "reminded");
  const waiting = people.filter((p) => p.status === "waiting");
  const unreachable = people.filter((p) => p.status === "unconfirmed");

  const lines = [
    `Напоминания — ${run.label}`,
    "",
    `Ушло: ${reminded.length}`,
    reminded.length === 0
      ? "  —"
      : reminded
          .slice(0, LIST_LIMIT)
          .map((p) => `  ✅ ${personLabel(p)} — ${mskTime(p.reminder_sent_at)}`)
          .join("\n") +
        (reminded.length > LIST_LIMIT ? `\n  … и ещё ${reminded.length - LIST_LIMIT}` : ""),
    "",
    `Ещё не ушло: ${waiting.length}`,
    nameList(waiting),
    "",
    `Не уйдёт — не подтвердились в боте: ${unreachable.length}`,
    nameList(unreachable),
  ];

  if (stats.lastReminderAt) {
    lines.push("", `Последнее ушло: ${mskDateTime(stats.lastReminderAt)}`);
  } else {
    lines.push("", reminderWindowNote(run, now));
  }
  return lines.join("\n");
}

/**
 * /contacts — телефоны и ники. Отдельной командой, а не строкой в общем
 * списке: это персональные данные участников, и открывать их надо намеренно,
 * а не задевать глазом, пролистывая сводку.
 */
export function contactsText(run: TeamRun, people: SignupView[]): string {
  if (people.length === 0) return `${run.label}\n\nЗаявок пока нет.`;
  const shown = people.slice(0, LIST_LIMIT);
  const lines = [
    `Контакты — ${run.label}`,
    "Персональные данные участников. Пересылать не надо.",
    "",
    ...shown.map((p) => `${ICON[p.status]} ${p.name} — ${p.contact}`),
  ];
  if (people.length > shown.length) {
    lines.push(`… и ещё ${people.length - shown.length}`);
  }
  return lines.join("\n");
}

// ── Команда ──────────────────────────────────────────────────────────────────

/** /team — состав. Видно всем внутри: кто ещё читает те же цифры. */
export function teamText(members: TeamMember[], meChatId: number): string {
  if (members.length === 0) return "В команде пока никого — странно, ведь ты как-то сюда попал.";
  const line = (m: TeamMember) => {
    const who = m.username ? `@${m.username}` : (m.display_name ?? String(m.chat_id));
    const role = isFounder(m.chat_id) ? " · фаундер" : "";
    const me = m.chat_id === meChatId ? " · это ты" : "";
    const seen = m.last_seen_at ? ` · был ${mskDateTime(m.last_seen_at)}` : " · ещё не заходил";
    // Отписку от сводок показываем: иначе «почему мне не пришло утром» будет
    // выясняться в переписке, а ответ всё это время лежит в одной строке.
    const muted = m.digest_opt_in ? "" : " · сводки выключены";
    return `• ${who}${role}${me}${muted}${seen}`;
  };
  return [`В команде ${members.length} чел.:`, "", ...members.map(line)].join("\n");
}

/** Первый экран для чужого: как войти. Ключ, разумеется, не называем. */
export const NOT_A_MEMBER_TEXT =
  "Это внутренний бот команды НИКИ — задачи и цифры по забегам.\n\n" +
  "Если ты из команды, пришли ключ одной строкой: /join твой-ключ\n" +
  "Если ты участник забега — тебе нужен основной бот, ссылка есть на странице кофе-рана.";

export function helpText(founder = false): string {
  const lines = [
    "Задачи команды и оперативка по забегам.",
    "",
    "/tasks — задачи: мне, я поставил, выполненные",
    "/assign — поставить задачи: что делать / срок / @ник",
  ];
  lines.push(
    "",
    "/schedule — расписание на неделю, /event — добавить событие",
    "/runs — забеги в работе и цифры по каждому",
    "/run — карточка забега (/run luzhniki, /run 20.09)",
    "/history — все прошедшие забеги и как они набирались",
    "/who — поимённо: кто подтвердился, кто нет",
    "/notif — кому ушло напоминание и во сколько",
    "/contacts — телефоны и ники участников",
    "/faq — быстрые ответы на частые вопросы",
    "/digest — предпросмотр автоматических сводок",
    "/mute, /unmute — не слать / снова слать сводки",
    "/team — кто в команде",
  );
  if (founder) lines.push("/kick @ник — убрать человека из команды (только фаундеры)");
  lines.push(
    "/leave — выйти самому",
    "",
    "Без аргумента любая команда берёт ближайший забег. Прошедший тоже можно: " +
      "/who лужники 13.09.",
    "",
    "Рассылки участникам — не здесь: перенос, отмена и перекличка живут в " +
      "основном боте, потому что люди нажимали Start именно у него.",
  );
  return lines.join("\n");
}

// ── Задачи ───────────────────────────────────────────────────────────────────
// Всё в одном сообщении: /tasks присылает список, а переключатель вкладок,
// карточки и «← К списку» редактируют это же сообщение. Тексты в HTML (текст
// задачи экранируется), ни одного похода в базу: задачи и ники приходят
// аргументами.

export type TaskTab = "me" | "by" | "done";

/** callback_data задач «Пятницы». Свой префикс tk: — мимо кнопок забегов и бота данных. */
export const TASK_CALLBACK_RE = /^tk:([logsdxX]):([a-z0-9]+)(?::([a-z0-9]+))?(?::(\d+))?$/;

export const taskCb = {
  list: (tab: TaskTab, page = 0) => `tk:l:${tab}:${page}`,
  open: (id: number, tab: TaskTab, page = 0) => `tk:o:${id}:${tab}:${page}`,
  group: (id: number, page = 0) => `tk:g:${id}:${page}`,
  status: (action: "take" | "done" | "decline" | "reopen", id: number) => `tk:s:${action}:${id}`,
  due: (id: number) => `tk:d:${id}`,
  cancelAsk: (id: number) => `tk:x:${id}`,
  cancelDo: (id: number) => `tk:X:${id}`,
};

export type TaskCallback =
  | { kind: "list"; tab: TaskTab; page: number }
  | { kind: "open"; id: number; tab: TaskTab; page: number }
  | { kind: "group"; id: number; page: number }
  | { kind: "status"; action: "take" | "done" | "decline" | "reopen"; id: number }
  | { kind: "due"; id: number }
  | { kind: "cancelAsk"; id: number }
  | { kind: "cancelDo"; id: number };

const TABS: readonly TaskTab[] = ["me", "by", "done"];
const ACTIONS = ["take", "done", "decline", "reopen"] as const;

export function parseTaskCallback(data: string): TaskCallback | null {
  const m = TASK_CALLBACK_RE.exec(data);
  if (!m) return null;
  const [, op, a, b, c] = m;
  const num = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : 0);
  switch (op) {
    case "l": return TABS.includes(a as TaskTab) ? { kind: "list", tab: a as TaskTab, page: num(b) } : null;
    case "o": return num(a) && TABS.includes(b as TaskTab) ? { kind: "open", id: num(a), tab: b as TaskTab, page: num(c) } : null;
    case "g": return num(a) ? { kind: "group", id: num(a), page: num(b) } : null;
    case "s": return (ACTIONS as readonly string[]).includes(a) && num(b) ? { kind: "status", action: a as typeof ACTIONS[number], id: num(b) } : null;
    case "d": return num(a) ? { kind: "due", id: num(a) } : null;
    case "x": return num(a) ? { kind: "cancelAsk", id: num(a) } : null;
    case "X": return num(a) ? { kind: "cancelDo", id: num(a) } : null;
  }
  return null;
}

export interface TaskScreen {
  text: string;
  keyboard: InlineKeyboard;
}

/** Сколько строк на странице. Под каждой строкой «Мне» и «Я поставил» своя кнопка. */
export const TASKS_PAGE = 10;
export const DONE_PAGE = 20;

const WEEKDAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function mskParts(d: Date): { ymd: string; dd: string; mm: string; time: string; weekday: string } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { ymd, dd: get("day"), mm: get("month"), time: `${get("hour")}:${get("minute")}`, weekday: WEEKDAYS_SHORT[wd] ?? "" };
}

/**
 * Срок коротко: в ближайшую неделю — «пт 18:00», дальше или в прошлом —
 * «03.10 18:00». Срок «до конца дня» (23:59) без времени: «пт», «03.10».
 */
export function shortDue(iso: string, now: Date): string {
  const d = new Date(iso);
  const p = mskParts(d);
  const time = p.time === "23:59" ? "" : ` ${p.time}`;
  const ahead = d.getTime() - now.getTime();
  return ahead > 0 && ahead < 6 * 86_400_000 ? `${p.weekday}${time}` : `${p.dd}.${p.mm}${time}`;
}

/** «05.10 14:20» по Москве: когда отметили «Сделано». */
export function doneStamp(iso: string): string {
  const p = mskParts(new Date(iso));
  return `${p.dd}.${p.mm} ${p.time}`;
}

const dateOnly = (iso: string) => {
  const p = mskParts(new Date(iso));
  return `${p.dd}.${p.mm}`;
};

const at = (name: string | undefined, fallback: string) => (name ? `@${escapeHtmlTeam(name)}` : escapeHtmlTeam(fallback));

/** HTML-экранирование для текстов задач: свой текст человека не должен ломать разметку. */
export function escapeHtmlTeam(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cut(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

const TASK_ACTIVE = (t: AssignedTask) => t.status === "open" || t.status === "taken";
const TASK_OVERDUE = (t: AssignedTask, now: Date) => TASK_ACTIVE(t) && !!t.due_at && Date.parse(t.due_at) <= now.getTime();

/** Сначала просроченные, затем по сроку, без срока в конце. */
function byUrgency(now: Date) {
  return (a: AssignedTask, b: AssignedTask) => {
    const oa = TASK_OVERDUE(a, now) ? 0 : 1;
    const ob = TASK_OVERDUE(b, now) ? 0 : 1;
    const da = a.due_at ? Date.parse(a.due_at) : Infinity;
    const db = b.due_at ? Date.parse(b.due_at) : Infinity;
    return oa - ob || da - db || a.id - b.id;
  };
}

/** Строка исходного списка: одна задача на нескольких исполнителей — одна «группа». */
export const groupKey = (t: Pick<AssignedTask, "source_chat_id" | "source_message_id" | "line">) =>
  `${t.source_chat_id}:${t.source_message_id}:${t.line}`;

function tabsRow(kb: InlineKeyboard, current: TaskTab): void {
  const label: Record<TaskTab, string> = { me: "Мне", by: "Я поставил", done: "Выполненные" };
  for (const tab of TABS) kb.text(tab === current ? `• ${label[tab]}` : label[tab], taskCb.list(tab, 0));
  kb.row();
}

function pager(kb: InlineKeyboard, tab: TaskTab, page: number, total: number, size: number): void {
  const more = (page + 1) * size < total;
  if (page > 0) kb.text("← Назад", taskCb.list(tab, page - 1));
  if (more) kb.text("Ещё", taskCb.list(tab, page + 1));
  if (page > 0 || more) kb.row();
}

/** Мои незакрытые задачи, где я исполнитель. */
export function myTasksScreen(
  tasks: readonly AssignedTask[],
  me: number,
  names: ReadonlyMap<number, string>,
  now: Date,
  page = 0,
): TaskScreen {
  const mine = tasks.filter((t) => t.assignee_id === me && TASK_ACTIVE(t)).sort(byUrgency(now));
  const kb = new InlineKeyboard();
  tabsRow(kb, "me");
  if (!mine.length) return { text: "<b>Задачи · Мне</b>\n\nОткрытых задач нет.", keyboard: kb };
  const start = Math.min(page, Math.max(0, Math.ceil(mine.length / TASKS_PAGE) - 1)) * TASKS_PAGE;
  const shown = mine.slice(start, start + TASKS_PAGE);
  const lines = shown.map((t, i) => {
    const n = start + i + 1;
    const overdue = TASK_OVERDUE(t, now) ? "⏰ " : "";
    const due = t.due_at ? ` · до ${shortDue(t.due_at, now)}` : "";
    const from = t.assigned_by === me ? "" : ` · от ${at(names.get(t.assigned_by), "команды")}`;
    return `${n}. ${overdue}${escapeHtmlTeam(cut(t.what, 140))}${due}${from}`;
  });
  shown.forEach((t, i) => kb.text(`${start + i + 1}. ${cut(t.what, 32)}`, taskCb.open(t.id, "me", start / TASKS_PAGE)).row());
  pager(kb, "me", start / TASKS_PAGE, mine.length, TASKS_PAGE);
  return { text: [`<b>Задачи · Мне</b> · ${mine.length}`, "", ...lines].join("\n"), keyboard: kb };
}

const STATUS_ICON: Record<AssignedTask["status"], string> = {
  open: "🆕", taken: "🔄", done: "✅", declined: "↩️", cancelled: "✖️",
};

/** Статус одного исполнителя в строке автора: «@bob ✅ 05.10 14:20». */
function assigneeStatus(t: AssignedTask): string {
  const stamp = t.status === "done" ? ` ${doneStamp(t.status_at)}` : "";
  return `@${escapeHtmlTeam(t.username)} ${STATUS_ICON[t.status]}${stamp}`;
}

/** Задачи, где я автор, ещё не закрытые хотя бы у одного исполнителя. */
export function authoredGroups(tasks: readonly AssignedTask[], me: number, now: Date): AssignedTask[][] {
  const groups = new Map<string, AssignedTask[]>();
  for (const t of tasks.filter((x) => x.assigned_by === me)) {
    const k = groupKey(t);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.values()]
    .filter((g) => g.some(TASK_ACTIVE))
    .map((g) => g.sort((a, b) => a.id - b.id))
    .sort((a, b) => byUrgency(now)(a[0], b[0]));
}

export function authoredScreen(tasks: readonly AssignedTask[], me: number, now: Date, page = 0): TaskScreen {
  const groups = authoredGroups(tasks, me, now);
  const kb = new InlineKeyboard();
  tabsRow(kb, "by");
  if (!groups.length) return { text: "<b>Задачи · Я поставил</b>\n\nНезакрытых задач, которые ты поставил, нет.", keyboard: kb };
  const start = Math.min(page, Math.max(0, Math.ceil(groups.length / TASKS_PAGE) - 1)) * TASKS_PAGE;
  const shown = groups.slice(start, start + TASKS_PAGE);
  const lines = shown.map((g, i) => {
    const first = g[0];
    const overdue = g.some((t) => TASK_OVERDUE(t, now)) ? "⏰ " : "";
    const due = first.due_at ? ` · до ${shortDue(first.due_at, now)}` : "";
    return `${start + i + 1}. ${overdue}${escapeHtmlTeam(cut(first.what, 120))}${due} · ${g.map(assigneeStatus).join(", ")}`;
  });
  shown.forEach((g, i) => kb.text(`${start + i + 1}. ${cut(g[0].what, 32)}`, taskCb.group(g[0].id, start / TASKS_PAGE)).row());
  pager(kb, "by", start / TASKS_PAGE, groups.length, TASKS_PAGE);
  return { text: [`<b>Задачи · Я поставил</b> · ${groups.length}`, "", ...lines].join("\n"), keyboard: kb };
}

/** Плоский архив выполненного: и где я исполнитель, и где я автор, от новых к старым. */
export function doneScreen(tasks: readonly AssignedTask[], me: number, page = 0): TaskScreen {
  const seen = new Set<number>();
  const done = tasks
    .filter((t) => t.status === "done" && (t.assignee_id === me || t.assigned_by === me))
    .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
    .sort((a, b) => Date.parse(b.status_at) - Date.parse(a.status_at) || b.id - a.id);
  const kb = new InlineKeyboard();
  tabsRow(kb, "done");
  if (!done.length) return { text: "<b>Задачи · Выполненные</b>\n\nВыполненных задач пока нет.", keyboard: kb };
  const start = Math.min(page, Math.max(0, Math.ceil(done.length / DONE_PAGE) - 1)) * DONE_PAGE;
  const lines = done
    .slice(start, start + DONE_PAGE)
    .map((t) => `✅ ${escapeHtmlTeam(cut(t.what, 120))} · @${escapeHtmlTeam(t.username)} · ${dateOnly(t.status_at)}`);
  pager(kb, "done", start / DONE_PAGE, done.length, DONE_PAGE);
  return { text: [`<b>Задачи · Выполненные</b> · ${done.length}`, "", ...lines].join("\n"), keyboard: kb };
}

export function tasksScreen(
  tab: TaskTab,
  tasks: readonly AssignedTask[],
  me: number,
  names: ReadonlyMap<number, string>,
  now: Date,
  page = 0,
): TaskScreen {
  if (tab === "by") return authoredScreen(tasks, me, now, page);
  if (tab === "done") return doneScreen(tasks, me, page);
  return myTasksScreen(tasks, me, names, now, page);
}

const STATUS_WORD: Record<AssignedTask["status"], string> = {
  open: "🆕 новая", taken: "🔄 в работе", done: "✅ сделано", declined: "↩️ не сможет", cancelled: "✖️ отменена",
};

function dueLineTeam(t: AssignedTask, now: Date): string | null {
  if (!t.due_at) return null;
  return `Срок: ${shortDue(t.due_at, now)}${TASK_OVERDUE(t, now) ? " · ⏰ просрочена" : ""}`;
}

/** Карточка задачи у исполнителя: статусные кнопки и «← К списку». */
export function myTaskCard(
  t: AssignedTask,
  me: number,
  names: ReadonlyMap<number, string>,
  teammates: readonly string[],
  now: Date,
  back: { tab: TaskTab; page: number } = { tab: "me", page: 0 },
): TaskScreen {
  const lines = [
    `<b>${escapeHtmlTeam(cut(t.what, 600))}</b>`,
    dueLineTeam(t, now),
    t.assigned_by === me ? "Поставил сам себе" : `От: ${at(names.get(t.assigned_by), "команды")}`,
    teammates.length ? `Вместе с тобой: ${teammates.map((n) => `@${escapeHtmlTeam(n)}`).join(", ")}` : null,
    `Статус: ${STATUS_WORD[t.status]}`,
  ].filter((l): l is string => l !== null);
  const kb = new InlineKeyboard();
  if (t.assignee_id === me) {
    if (t.status === "open") kb.text("Взял в работу", taskCb.status("take", t.id)).text("Сделано", taskCb.status("done", t.id)).row().text("Не смогу", taskCb.status("decline", t.id)).row();
    if (t.status === "taken") kb.text("Сделано", taskCb.status("done", t.id)).text("Не смогу", taskCb.status("decline", t.id)).row();
    if (t.status === "done") kb.text("Вернуть в работу", taskCb.status("reopen", t.id)).row();
    if (t.status === "declined") kb.text("Всё-таки возьму", taskCb.status("reopen", t.id)).row();
  }
  if (t.assigned_by === me && TASK_ACTIVE(t)) kb.text("Изменить срок", taskCb.due(t.id)).text("Отменить", taskCb.cancelAsk(t.id)).row();
  kb.text("← К списку", taskCb.list(back.tab, back.page));
  return { text: lines.join("\n"), keyboard: kb };
}

/** Карточка задачи у автора: статус каждого исполнителя, срок и отмена. */
export function authorTaskCard(group: readonly AssignedTask[], now: Date, page = 0): TaskScreen {
  const first = group[0];
  const lines = [
    `<b>${escapeHtmlTeam(cut(first.what, 600))}</b>`,
    dueLineTeam(group.find(TASK_ACTIVE) ?? first, now),
    "",
    ...group.map((t) => `${assigneeStatus(t)}${t.status === "done" ? "" : ` ${STATUS_WORD[t.status].split(" ").slice(1).join(" ")}`}`),
  ].filter((l): l is string => l !== null);
  const kb = new InlineKeyboard();
  if (group.some(TASK_ACTIVE)) kb.text("Изменить срок", taskCb.due(first.id)).text("Отменить", taskCb.cancelAsk(first.id)).row();
  kb.text("← К списку", taskCb.list("by", page));
  return { text: lines.join("\n"), keyboard: kb };
}

export function cancelConfirmScreen(group: readonly AssignedTask[]): TaskScreen {
  const first = group[0];
  const who = group.filter(TASK_ACTIVE).map((t) => `@${escapeHtmlTeam(t.username)}`).join(", ");
  return {
    text: `Отменить задачу «${escapeHtmlTeam(cut(first.what, 200))}»?\nИсполнители (${who}) получат сообщение об отмене.`,
    keyboard: new InlineKeyboard().text("Да, отменить", taskCb.cancelDo(first.id)).text("Нет", taskCb.group(first.id, 0)),
  };
}

export const TASK_DUE_PROMPT =
  "Пришли новый срок одним сообщением: «пт 18:00», «03.10», «завтра 12:00» или «18:00». " +
  "Снять срок: «нет». Отмена: /cancel.";

export const TASK_UPLOAD_PROMPT = [
  "Пришли список задач одним сообщением. Одна строка — одно дело: что делать / срок / @ник + @ник.",
  "<code>Подготовить макет / пт 18:00 / @alice + @bob",
  "Проверить текст / 03.10 / @bob</code>",
  "Каждому исполнителю создаётся своя задача, себе тоже можно. Отмена: /cancel.",
].join("\n");

/**
 * Одно сообщение исполнителю на один /assign: все его новые задачи из этого
 * списка. Совместные помечены «вместе с @ник».
 */
export function newTasksText(
  tasks: readonly AssignedTask[],
  authorName: string | undefined,
  teammates: ReadonlyMap<number, readonly string[]>,
  now: Date,
): string {
  const head = tasks.length === 1 ? "Новая задача" : `Новые задачи: ${tasks.length}`;
  const from = authorName ? ` от @${escapeHtmlTeam(authorName)}` : "";
  const lines = tasks.map((t, i) => {
    const due = t.due_at ? ` · до ${shortDue(t.due_at, now)}` : "";
    const mates = teammates.get(t.id) ?? [];
    const together = mates.length ? ` · вместе с ${mates.map((n) => `@${escapeHtmlTeam(n)}`).join(", ")}` : "";
    return `${i + 1}. ${escapeHtmlTeam(cut(t.what, 300))}${due}${together}`;
  });
  return [`<b>${head}${from}</b>`, "", ...lines].join("\n");
}

export const openMyTasksKeyboard = () => new InlineKeyboard().text("Открыть мои задачи", taskCb.list("me", 0));

/** Автору: исполнитель нажал «Сделано», «Не смогу» или вернул задачу в работу. */
export function authorNoticeText(t: AssignedTask, previous: AssignedTask["status"]): string | null {
  if (previous === t.status) return null;
  const who = `@${escapeHtmlTeam(t.username)}`;
  const what = `«${escapeHtmlTeam(cut(t.what, 200))}»`;
  if (t.status === "done") return `✅ ${who}: сделано, ${what}`;
  if (t.status === "declined") return `↩️ ${who}: не сможет, ${what}\nОтменить или поставить другому можно в /tasks → «Я поставил».`;
  if (t.status === "taken" && previous !== "open") return `🔄 ${who}: снова в работе, ${what}`;
  return null;
}

/** Исполнителю: автор поменял срок или отменил задачу. */
export function assigneeChangeText(t: AssignedTask, change: "due" | "cancel", now: Date): string {
  const what = `«${escapeHtmlTeam(cut(t.what, 300))}»`;
  if (change === "cancel") return `✖️ Задача отменена: ${what}`;
  return t.due_at ? `🗓 Новый срок задачи ${what}: ${shortDue(t.due_at, now)}` : `🗓 У задачи ${what} больше нет срока`;
}

/** Отчёт автору после /assign: что сохранено и кому не дошло. */
export function assignReportText(tasks: readonly AssignedTask[], now: Date): string {
  const groups = new Map<string, AssignedTask[]>();
  for (const t of tasks) groups.set(groupKey(t), [...(groups.get(groupKey(t)) ?? []), t]);
  const sent = tasks.filter((t) => t.delivery_state === "sent").length;
  const lines = [...groups.values()].map((g) => {
    const due = g[0].due_at ? ` · до ${shortDue(g[0].due_at, now)}` : "";
    return `• ${escapeHtmlTeam(cut(g[0].what, 160))}${due} · ${g.map((t) => `@${escapeHtmlTeam(t.username)}${t.delivery_state === "sent" ? "" : " 📭"}`).join(" + ")}`;
  });
  const undelivered = tasks.filter((t) => t.delivery_state !== "sent");
  return [
    `Сохранено задач: ${tasks.length}. Доставлено: ${sent}.`,
    ...lines,
    undelivered.length
      ? `\n📭 Не дошло: ${undelivered.map((t) => `@${escapeHtmlTeam(t.username)}`).join(", ")}. ` +
        `Человеку нужно открыть бота, потом /assign_retry ${undelivered.map((t) => t.id).join(" ")}.`
      : "",
    "Следить за статусом: /tasks → «Я поставил».",
  ].filter(Boolean).join("\n");
}

// ── Расписание ───────────────────────────────────────────────────────────────
// Ближайшие 7 дней одним сообщением, по дням. Навигация редактирует то же
// сообщение. Кофе-раны из COFFEE_RUNS — как ивент «Бегового клуба», только
// для чтения.

export const EVENT_CALLBACK_RE = /^ev:([a-zA-Z]+)(?::([a-z0-9_-]+))?(?::([a-z0-9_-]+))?$/;

export const eventCb = {
  week: (offset: number) => `ev:w:${offset}`,
  open: (id: number, offset = 0) => `ev:o:${id}:${offset}`,
  run: (spot: string, date: string) => `ev:r:${spot}:${date}`,
  add: () => "ev:add",
  kind: (kind: "club" | "meeting" | "other") => `ev:k:${kind}`,
  club: (key: string) => `ev:c:${key}`,
  notify: (on: boolean) => `ev:n:${on ? 1 : 0}`,
  drop: () => "ev:drop",
  time: (id: number) => `ev:t:${id}`,
  cancelAsk: (id: number) => `ev:x:${id}`,
  cancelDo: (id: number, notify: boolean) => `ev:X:${id}:${notify ? 1 : 0}`,
};

const WEEKDAY_CAP = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

/** «Пн 13.10» из YYYY-MM-DD. */
export function dayHeader(ymd: string): string {
  const wd = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return `${WEEKDAY_CAP[wd]} ${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
}

/** «Вт 07.10, 19:00» по Москве. */
export function eventWhen(iso: string): string {
  const p = mskParts(new Date(iso));
  return `${dayHeader(p.ymd)}, ${p.time}`;
}

function itemTitle(item: ScheduleItem): string {
  return item.source === "coffeerun" ? coffeeRunTitle(item.run) : item.event.title;
}

/** Строка расписания: «19:00 Планёрка · Zoom», «10:00 🏃 Кофе-ран Усачёва · Беговой клуб». */
export function scheduleLine(item: ScheduleItem): string {
  const time = mskParts(new Date(item.startsAt)).time;
  const club = clubByKey(itemClub(item));
  const isClub = item.source === "coffeerun" || item.event.kind === "club_event";
  const title = escapeHtmlTeam(itemTitle(item));
  if (isClub) return `${time} ${club?.icon ?? "📌"} ${title}${club ? ` · ${escapeHtmlTeam(club.name)}` : ""}`;
  const place = item.source === "event" && item.event.place ? ` · ${escapeHtmlTeam(item.event.place)}` : "";
  return `${time} ${title}${place}`;
}

export function scheduleScreen(items: readonly ScheduleItem[], days: readonly string[], offset: number): TaskScreen {
  const head = `<b>Расписание</b> · ${dayHeader(days[0])} – ${dayHeader(days[days.length - 1])}`;
  const kb = new InlineKeyboard();
  const groups = groupByDay(items);
  const lines: string[] = [head, ""];
  if (!groups.length) {
    lines.push(offset === 0 ? "На этой неделе ничего не запланировано." : "На следующей неделе ничего не запланировано.");
  }
  for (const g of groups) {
    lines.push(`<b>${dayHeader(g.ymd)}</b>`, ...g.items.map(scheduleLine), "");
    for (const it of g.items) {
      const label = `${dayHeader(g.ymd).slice(0, 2)} ${mskParts(new Date(it.startsAt)).time} ${cut(itemTitle(it), 28)}`;
      kb.text(label, it.source === "coffeerun" ? eventCb.run(it.run.spot, it.run.date) : eventCb.open(it.event.id, offset)).row();
    }
  }
  kb.text(offset === 0 ? "Следующая неделя" : "Эта неделя", eventCb.week(offset === 0 ? 1 : 0))
    .text("Добавить событие", eventCb.add());
  return { text: lines.join("\n").trimEnd(), keyboard: kb };
}

const KIND_LABEL: Record<TeamEventKind, string> = { club_event: "Ивент клуба", meeting: "Планёрка", other: "Другое" };

/** Карточка планёрки или прочего события: кто, где, когда; управление — автору, ответственному, фаундерам. */
export function eventCard(ev: TeamEvent, names: ReadonlyMap<number, string>, canManage: boolean, offset = 0): TaskScreen {
  const club = clubByKey(ev.club);
  const lines = [
    `<b>${escapeHtmlTeam(ev.title)}</b>`,
    `${KIND_LABEL[ev.kind]}${club ? ` · ${escapeHtmlTeam(club.name)}` : ""}`,
    eventWhen(ev.starts_at),
    ev.place ? `Место: ${escapeHtmlTeam(ev.place)}` : null,
    `Ответственный: ${ev.responsible_chat_id ? at(names.get(ev.responsible_chat_id), "без ника") : "не назначен"}`,
    `Добавил в расписание: ${at(names.get(ev.created_by), "участник команды")}`,
    ev.cancelled_at ? "❌ Отменено" : null,
  ].filter((l): l is string => l !== null);
  const kb = new InlineKeyboard();
  if (canManage && !ev.cancelled_at) kb.text("Изменить время", eventCb.time(ev.id)).text("Отменить", eventCb.cancelAsk(ev.id)).row();
  kb.text("← К расписанию", eventCb.week(offset));
  return { text: lines.join("\n"), keyboard: kb };
}

/** Черновик события: что уже разобрано из строки /event. */
export function eventDraftText(d: { title: string; startsAt: string; place: string | null }, responsibleName: string | null): string {
  return [
    `<b>${escapeHtmlTeam(d.title)}</b>`,
    eventWhen(d.startsAt),
    d.place ? `Место: ${escapeHtmlTeam(d.place)}` : null,
    responsibleName ? `Ответственный: @${escapeHtmlTeam(responsibleName)}` : null,
  ].filter((l): l is string => l !== null).join("\n");
}

export const eventKindKeyboard = () =>
  new InlineKeyboard().text("Ивент клуба", eventCb.kind("club")).text("Планёрка", eventCb.kind("meeting")).text("Другое", eventCb.kind("other"))
    .row().text("Не добавлять", eventCb.drop());

export function eventClubKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const c of CLUBS) kb.text(`${c.icon} ${c.name}`, eventCb.club(c.key)).row();
  return kb.text("Не добавлять", eventCb.drop());
}

export const eventNotifyKeyboard = () =>
  new InlineKeyboard().text("Сообщить команде", eventCb.notify(true)).text("Без рассылки", eventCb.notify(false));

export function eventAnnounceText(ev: TeamEvent, names: ReadonlyMap<number, string>): string {
  const club = clubByKey(ev.club);
  return [
    `📅 <b>В расписании: ${escapeHtmlTeam(ev.title)}</b>`,
    `${eventWhen(ev.starts_at)}${ev.place ? ` · ${escapeHtmlTeam(ev.place)}` : ""}`,
    club ? `${club.icon} ${escapeHtmlTeam(club.name)}` : KIND_LABEL[ev.kind],
    ev.responsible_chat_id ? `Ответственный: ${at(names.get(ev.responsible_chat_id), "без ника")}` : null,
    "Всё расписание: /schedule",
  ].filter((l): l is string => l !== null).join("\n");
}

export function eventCancelledText(ev: TeamEvent): string {
  return `❌ <b>Отменено: ${escapeHtmlTeam(ev.title)}</b>\n${eventWhen(ev.starts_at)}${ev.place ? ` · ${escapeHtmlTeam(ev.place)}` : ""}`;
}

export function eventCancelAskScreen(ev: TeamEvent): TaskScreen {
  return {
    text: `Отменить «${escapeHtmlTeam(ev.title)}», ${eventWhen(ev.starts_at)}?\nСообщить команде об отмене?`,
    keyboard: new InlineKeyboard()
      .text("Отменить и сообщить", eventCb.cancelDo(ev.id, true)).row()
      .text("Отменить без рассылки", eventCb.cancelDo(ev.id, false)).row()
      .text("Назад", eventCb.open(ev.id, 0)),
  };
}

export const EVENT_ADD_HINT = [
  "Пришли событие одной строкой: название / дата время / место / @ответственный.",
  "Место и ответственный необязательны, время обязательно.",
  "<code>Планёрка / вт 19:00 / Zoom</code>",
  "<code>Книжный клуб / 15.10 19:30 / Surf Coffee / @masha</code>",
  "Отмена: /cancel.",
].join("\n");

export const EVENT_TIME_PROMPT = "Пришли новое время: «пт 19:00», «завтра 12:00», «03.10 18:00». Отмена: /cancel.";
