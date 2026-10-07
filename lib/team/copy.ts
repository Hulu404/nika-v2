import { InlineKeyboard } from "grammy";
import { REMINDER_HOUR_MSK, dayBefore, spotName } from "../coffeerun/run";
import { formatPace } from "../coffeerun/pace";
import { DEFAULT_TZ } from "../telegram/schedule";
import type { RunStats, SignupView, SignupStatus } from "./stats";
import { runDateLabel, type TeamRun } from "./runs";
import type { Dynamics, RunAggregate } from "./history";
import type { TeamMember } from "./access";
import { isFounder } from "./config";
import type { AssignedTask } from "../databot/task-list";
import { CLUBS, clubByKey } from "./clubs";
import { coffeeRunStart, coffeeRunTitle, groupByDay, itemClub, type ScheduleItem, type TeamEvent, type TeamEventKind } from "./events";

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

// ── История и динамика ───────────────────────────────────────────────────────

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
export function paceLines(stats: RunStats): string[] {
  const filled = stats.byPace.filter((b) => b.count > 0);
  if (filled.length === 0) return ["  —"];
  return filled.map((b) =>
    b.pace ? `  ${formatPace(b.pace)} — ${b.count}` : `  без темпа — ${b.count}`,
  );
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

/** «Рассылка» в экране кофе-рана: кому ушло напоминание и во сколько, а кому не уйдёт и почему. */
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
    "«Пятница» — бот команды НИКИ.",
    "",
    "/tasks — задачи: мне, я поставил, выполненные",
    "/assign — поставить задачу: что делать / срок / @ник",
    "/schedule — расписание на неделю, /event — добавить событие",
    "/events — ивенты клубов: цифры, участники, явка",
    "/team — кто в команде",
    "/faq — быстрые ответы на частые вопросы",
    "/mute — не присылать сводку, /unmute — снова присылать",
    "/help — что я умею",
    "",
    "Каждое утро в 8:00 МСК присылаю сводку дня, если на день что-то запланировано. " +
      "Через 3 часа после ивента клуба спрошу ответственного, сколько пришло.",
  ];
  if (founder) lines.push("", "/kick @ник — убрать человека из команды (только фаундеры)");
  lines.push(
    "/leave — выйти самому",
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

export type TaskTab = "me" | "by" | "done" | "all";

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

const TABS: readonly TaskTab[] = ["me", "by", "done", "all"];
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

/** Вкладки задач. «Вся команда» — только у фаундеров. */
function tabsRow(kb: InlineKeyboard, current: TaskTab, founder = false): void {
  const label: Record<TaskTab, string> = { me: "Мне", by: "Я поставил", done: "Выполненные", all: "Вся команда" };
  for (const tab of TABS.filter((t) => t !== "all")) kb.text(tab === current ? `• ${label[tab]}` : label[tab], taskCb.list(tab, 0));
  kb.row();
  if (founder) kb.text(current === "all" ? `• ${label.all}` : label.all, taskCb.list("all", 0)).row();
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
  founder = false,
): TaskScreen {
  const mine = tasks.filter((t) => t.assignee_id === me && TASK_ACTIVE(t)).sort(byUrgency(now));
  const kb = new InlineKeyboard();
  tabsRow(kb, "me", founder);
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

export function authoredScreen(tasks: readonly AssignedTask[], me: number, now: Date, page = 0, founder = false): TaskScreen {
  const groups = authoredGroups(tasks, me, now);
  const kb = new InlineKeyboard();
  tabsRow(kb, "by", founder);
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

/**
 * Плоский архив выполненного: и где я исполнитель, и где я автор, от новых к
 * старым. У фаундера — выполненное всей команды.
 */
export function doneScreen(tasks: readonly AssignedTask[], me: number, page = 0, founder = false): TaskScreen {
  const seen = new Set<number>();
  const done = tasks
    .filter((t) => t.status === "done" && (founder || t.assignee_id === me || t.assigned_by === me))
    .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
    .sort((a, b) => Date.parse(b.status_at) - Date.parse(a.status_at) || b.id - a.id);
  const kb = new InlineKeyboard();
  tabsRow(kb, "done", founder);
  if (!done.length) return { text: "<b>Задачи · Выполненные</b>\n\nВыполненных задач пока нет.", keyboard: kb };
  const start = Math.min(page, Math.max(0, Math.ceil(done.length / DONE_PAGE) - 1)) * DONE_PAGE;
  const lines = done
    .slice(start, start + DONE_PAGE)
    .map((t) => `✅ ${escapeHtmlTeam(cut(t.what, 120))} · @${escapeHtmlTeam(t.username)} · ${dateOnly(t.status_at)}`);
  pager(kb, "done", start / DONE_PAGE, done.length, DONE_PAGE);
  return { text: [`<b>Задачи · Выполненные</b> · ${done.length}`, "", ...lines].join("\n"), keyboard: kb };
}

/**
 * «Вся команда» (только фаундеры): все незакрытые задачи по исполнителям,
 * сначала просроченные. «Проверить текст · до 03.10 ⏰ · от @ali · 🔄».
 */
export function teamTasksScreen(
  tasks: readonly AssignedTask[],
  names: ReadonlyMap<number, string>,
  now: Date,
  page = 0,
): TaskScreen {
  const active = tasks.filter(TASK_ACTIVE);
  const kb = new InlineKeyboard();
  tabsRow(kb, "all", true);
  if (!active.length) return { text: "<b>Задачи · Вся команда</b>\n\nОткрытых задач в команде нет.", keyboard: kb };
  const byPerson = new Map<string, AssignedTask[]>();
  for (const t of active) byPerson.set(t.username, [...(byPerson.get(t.username) ?? []), t]);
  // Люди с просрочкой первыми, внутри — по срочности.
  const people = [...byPerson.entries()]
    .map(([u, list]) => [u, list.sort(byUrgency(now))] as const)
    .sort(([a, la], [b, lb]) => (TASK_OVERDUE(la[0], now) ? 0 : 1) - (TASK_OVERDUE(lb[0], now) ? 0 : 1) || a.localeCompare(b));
  const flat = people.flatMap(([, list]) => list);
  const start = Math.min(page, Math.max(0, Math.ceil(flat.length / TASKS_PAGE) - 1)) * TASKS_PAGE;
  const shown = new Set(flat.slice(start, start + TASKS_PAGE).map((t) => t.id));
  const lines = [`<b>Задачи · Вся команда</b> · ${active.length}`];
  let n = 0;
  for (const [username, list] of people) {
    const visible = list.filter((t) => shown.has(t.id));
    if (!visible.length) continue;
    lines.push("", `<b>@${escapeHtmlTeam(username)}</b>`);
    for (const t of visible) {
      n++;
      const due = t.due_at ? ` · до ${shortDue(t.due_at, now)}${TASK_OVERDUE(t, now) ? " ⏰" : ""}` : "";
      lines.push(`${start + n}. ${escapeHtmlTeam(cut(t.what, 120))}${due} · от ${at(names.get(t.assigned_by), "команды")} · ${STATUS_ICON[t.status]}`);
    }
  }
  let i = 0;
  for (const [username, list] of people) for (const t of list) {
    if (!shown.has(t.id)) continue;
    i++;
    kb.text(`${start + i}. @${cut(username, 12)} · ${cut(t.what, 22)}`, taskCb.open(t.id, "all", start / TASKS_PAGE)).row();
  }
  pager(kb, "all", start / TASKS_PAGE, flat.length, TASKS_PAGE);
  return { text: lines.join("\n"), keyboard: kb };
}

export function tasksScreen(
  tab: TaskTab,
  tasks: readonly AssignedTask[],
  me: number,
  names: ReadonlyMap<number, string>,
  now: Date,
  page = 0,
  founder = false,
): TaskScreen {
  if (tab === "all" && founder) return teamTasksScreen(tasks, names, now, page);
  if (tab === "by") return authoredScreen(tasks, me, now, page, founder);
  if (tab === "done") return doneScreen(tasks, me, page, founder);
  return myTasksScreen(tasks, me, names, now, page, founder);
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
  founder = false,
): TaskScreen {
  const lines = [
    `<b>${escapeHtmlTeam(cut(t.what, 600))}</b>`,
    dueLineTeam(t, now),
    t.assignee_id !== me ? `Исполнитель: @${escapeHtmlTeam(t.username)}` : null,
    t.assigned_by === me ? (t.assignee_id === me ? "Поставил сам себе" : "Поставил ты") : `От: ${at(names.get(t.assigned_by), "команды")}`,
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
  if ((t.assigned_by === me || founder) && TASK_ACTIVE(t)) kb.text("Изменить срок", taskCb.due(t.id)).text("Отменить", taskCb.cancelAsk(t.id)).row();
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

// ── Ивенты ───────────────────────────────────────────────────────────────────
// Один раздел /events вместо /runs, /run, /who, /notif, /contacts, /history.
// Список предстоящих ивентов всех клубов (team_events + кофе-раны), экран
// ивента, участники и рассылка кофе-рана, прошедшие по 10 на страницу.

export const IVENT_CALLBACK_RE = /^ie:([a-z]+)(?::([a-z0-9_-]+))?(?::([a-z0-9_-]+))?$/;

export const iventCb = {
  list: () => "ie:l",
  past: (page: number) => `ie:p:${page}`,
  run: (spot: string, date: string) => `ie:r:${spot}:${date}`,
  event: (id: number) => `ie:e:${id}`,
  people: (spot: string, date: string) => `ie:u:${spot}:${date}`,
  mail: (spot: string, date: string) => `ie:m:${spot}:${date}`,
  claim: (id: number) => `ie:me:${id}`,
  attendRun: (spot: string, date: string) => `ie:ar:${spot}:${date}`,
  attendEvent: (id: number) => `ie:ae:${id}`,
};

export type IventItem =
  | { kind: "run"; run: TeamRun; startsAt: string; agg: RunAggregate | null; fact?: number | null }
  | { kind: "event"; event: TeamEvent; fact?: number | null };

export const PAST_PAGE = 10;

/** «вс 11.10» по Москве. */
function shortDay(iso: string): string {
  const p = mskParts(new Date(iso));
  return `${p.weekday} ${p.dd}.${p.mm}`;
}

/** Кофе-ран по ключу (спот, дата): «Кофе-ран Усачёва», даже если его уже нет в расписании. */
export function runTitle(run: TeamRun): string {
  return coffeeRunTitle({ spotName: run.scheduled?.spotName ?? spotName(run.spot) });
}

function iventTitle(item: IventItem): string {
  return item.kind === "run" ? runTitle(item.run) : item.event.title;
}

function iventIcon(item: IventItem): string {
  return clubByKey(item.kind === "run" ? "run" : item.event.club)?.icon ?? "📌";
}

const iventStarts = (item: IventItem) => (item.kind === "run" ? item.startsAt : item.event.starts_at);

/** «🏃 Кофе-ран Усачёва · вс 11.10 · 23 заявки, 18 подтв.» или «📚 Книжный клуб · ср 15.10 · отв. @masha». */
export function iventLine(item: IventItem, names: ReadonlyMap<number, string>): string {
  const head = `${iventIcon(item)} ${escapeHtmlTeam(iventTitle(item))} · ${shortDay(iventStarts(item))}`;
  if (item.kind === "run") {
    const a = item.agg;
    return a ? `${head} · ${a.total} ${plural(a.total, "заявка", "заявки", "заявок")}, ${a.confirmed} подтв.` : `${head} · заявок пока нет`;
  }
  const resp = item.event.responsible_chat_id;
  return resp ? `${head} · отв. ${at(names.get(resp), "без ника")}` : head;
}

function openIvent(item: IventItem): string {
  return item.kind === "run" ? iventCb.run(item.run.spot, item.run.date) : iventCb.event(item.event.id);
}

/** /events: предстоящие ивенты всех клубов, каждая строка — кнопка. */
export function iventsScreen(items: readonly IventItem[], names: ReadonlyMap<number, string>): TaskScreen {
  const kb = new InlineKeyboard();
  if (!items.length) {
    return {
      text: "<b>Ивенты</b>\n\nБлижайших ивентов нет.",
      keyboard: kb.text("Прошедшие", iventCb.past(0)).text("Добавить событие", eventCb.add()),
    };
  }
  for (const it of items) kb.text(`${iventIcon(it)} ${cut(iventTitle(it), 26)} · ${shortDay(iventStarts(it))}`, openIvent(it)).row();
  kb.text("Прошедшие", iventCb.past(0));
  return { text: ["<b>Ивенты</b> · ближайшие", "", ...items.map((it) => iventLine(it, names))].join("\n"), keyboard: kb };
}

/** «Пришло: 17 из 23 заявок» / «Пришло: 12» / «Явка не внесена». */
export function factLine(fact: number | null | undefined, total?: number): string {
  if (fact === null || fact === undefined) return "Явка не внесена";
  return total ? `Пришло: ${fact} из ${total} ${plural(total, "заявки", "заявок", "заявок")}` : `Пришло: ${fact}`;
}

/** Прошедшие ивенты, по 10 на страницу: «Кофе-ран Лужники · 20.09 · заявок 31, пришло 22». */
export function pastIventsScreen(items: readonly IventItem[], page: number): TaskScreen {
  const kb = new InlineKeyboard();
  if (!items.length) return { text: "<b>Прошедшие ивенты</b>\n\nПока ни одного.", keyboard: kb.text("← К ивентам", iventCb.list()) };
  const pages = Math.max(1, Math.ceil(items.length / PAST_PAGE));
  const p = Math.min(Math.max(page, 0), pages - 1);
  const shown = items.slice(p * PAST_PAGE, (p + 1) * PAST_PAGE);
  const lines = shown.map((it) => {
    const day = dateOnly(iventStarts(it));
    const fact = it.fact === null || it.fact === undefined ? "явка не внесена" : `пришло ${it.fact}`;
    if (it.kind === "run") return `${escapeHtmlTeam(iventTitle(it))} · ${day} · заявок ${it.agg?.total ?? 0}, ${fact}`;
    return `${escapeHtmlTeam(iventTitle(it))} · ${day} · ${fact}`;
  });
  for (const it of shown) kb.text(`${cut(iventTitle(it), 30)} · ${dateOnly(iventStarts(it))}`, openIvent(it)).row();
  if (p > 0) kb.text("← Новее", iventCb.past(p - 1));
  if (p < pages - 1) kb.text("Ещё", iventCb.past(p + 1));
  if (p > 0 || p < pages - 1) kb.row();
  kb.text("← К ивентам", iventCb.list());
  return { text: ["<b>Прошедшие ивенты</b>", "", ...lines].join("\n"), keyboard: kb };
}

/** Динамика набора одной строкой: «За 3 дня до старта: 15, в прошлый сравнимый раз 12». */
export function dynamicsOneLine(dyn: Dynamics): string {
  const head = `За ${dyn.daysBefore} ${plural(dyn.daysBefore, "день", "дня", "дней")} до старта: ${dyn.now}`;
  if (dyn.typical === null) return `${head}, сравнить не с чем`;
  return dyn.comparable === 1 ? `${head}, в прошлый сравнимый раз ${dyn.typical}` : `${head}, обычно к этому дню ${dyn.typical}`;
}

/** Экран кофе-рана: шапка, 2–3 строки цифр, динамика одной строкой; у прошедшего — явка. */
export function coffeeRunScreen(
  run: TeamRun,
  stats: RunStats,
  dyn: Dynamics | null,
  fact: number | null | undefined,
  attendable = false,
  canFix = false,
): TaskScreen {
  const s = run.scheduled;
  const lines = [
    `<b>${escapeHtmlTeam(runTitle(run))}</b>`,
    "🏃 Беговой клуб",
    s ? `${eventWhen(coffeeRunStart(s))} (сбор ${s.gatherTime})` : `${dayHeader(run.date)}`,
    s ? `Место: ${escapeHtmlTeam(s.address)}` : null,
    run.past ? factLine(fact, stats.total) : null,
    "",
    `Заявок ${stats.total} · подтвердились ${stats.confirmed}`,
    `⚠️ Не подтвердились ${stats.unconfirmed} · напоминание ушло ${stats.reminded}`,
    dyn && !run.past ? dynamicsOneLine(dyn) : null,
  ].filter((l): l is string => l !== null);
  const kb = new InlineKeyboard()
    .text("Участники", iventCb.people(run.spot, run.date))
    .text("Рассылка", iventCb.mail(run.spot, run.date)).row();
  if (attendable && run.past && (fact === null || fact === undefined)) kb.text("Внести явку", iventCb.attendRun(run.spot, run.date)).row();
  else if (attendable && canFix && fact !== null && fact !== undefined) kb.text("Исправить явку", iventCb.attendRun(run.spot, run.date)).row();
  kb.text("← К ивентам", iventCb.list());
  return { text: lines.join("\n"), keyboard: kb };
}

/** Экран ивента клуба без записи через сайт: шапка, ответственный, явка у прошедшего. */
export function clubEventScreen(
  ev: TeamEvent,
  names: ReadonlyMap<number, string>,
  opts: { past: boolean; fact?: number | null; canManage: boolean; attendable?: boolean; canFix?: boolean },
): TaskScreen {
  const club = clubByKey(ev.club);
  const lines = [
    `<b>${escapeHtmlTeam(ev.title)}</b>`,
    club ? `${club.icon} ${escapeHtmlTeam(club.name)}` : null,
    eventWhen(ev.starts_at),
    ev.place ? `Место: ${escapeHtmlTeam(ev.place)}` : null,
    `Ответственный: ${ev.responsible_chat_id ? at(names.get(ev.responsible_chat_id), "без ника") : "не назначен"}`,
    opts.past ? factLine(opts.fact) : null,
  ].filter((l): l is string => l !== null);
  const kb = new InlineKeyboard();
  if (!ev.responsible_chat_id) kb.text("Я ответственный", iventCb.claim(ev.id)).row();
  if (opts.attendable && opts.past && (opts.fact === null || opts.fact === undefined)) kb.text("Внести явку", iventCb.attendEvent(ev.id)).row();
  else if (opts.attendable && opts.canFix && opts.fact !== null && opts.fact !== undefined) kb.text("Исправить явку", iventCb.attendEvent(ev.id)).row();
  if (!opts.past && opts.canManage) kb.text("Изменить время", eventCb.time(ev.id)).text("Отменить", eventCb.cancelAsk(ev.id)).row();
  kb.text("← К ивентам", iventCb.list());
  return { text: lines.join("\n"), keyboard: kb };
}

/**
 * «Участники» кофе-рана: один список вместо прежних /who и /contacts — имя,
 * статус, телефон или ник. Персональные данные: открываются только кнопкой.
 */
export function participantsText(run: TeamRun, people: readonly SignupView[]): string {
  if (!people.length) return `<b>Участники · ${escapeHtmlTeam(runTitle(run))}</b>\n\nЗаявок пока нет.`;
  const order: SignupStatus[] = ["unconfirmed", "waiting", "reminded"];
  const sorted = [...people].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  const shown = sorted.slice(0, LIST_LIMIT).map((p) => {
    const nick = p.tg_username && !p.contact.includes(p.tg_username) ? ` · @${escapeHtmlTeam(p.tg_username)}` : "";
    return `${ICON[p.status]} ${escapeHtmlTeam(p.name)} — ${escapeHtmlTeam(p.contact)}${nick}`;
  });
  if (sorted.length > LIST_LIMIT) shown.push(`… и ещё ${sorted.length - LIST_LIMIT}`);
  return [
    `<b>Участники · ${escapeHtmlTeam(runTitle(run))}</b> · ${people.length}`,
    "⚠️ не подтвердился · ⏳ ждёт напоминания · ✅ напомнили",
    "Персональные данные участников, пересылать не надо.",
    "",
    ...shown,
  ].join("\n");
}

export const backToRunKeyboard = (run: TeamRun) => new InlineKeyboard().text("← К ивенту", iventCb.run(run.spot, run.date));
