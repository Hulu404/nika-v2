import { InlineKeyboard } from "grammy";
import { runWhenWhere, REMINDER_HOUR_MSK, dayBefore } from "../coffeerun/run";
import { formatPace } from "../coffeerun/pace";
import { DEFAULT_TZ } from "../telegram/schedule";
import type { RunStats, SignupView, SignupStatus } from "./stats";
import { runDateLabel, type RunKey, type TeamRun } from "./runs";
import type { Dynamics, RunAggregate } from "./history";
import type { TeamMember } from "./access";

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

export const TEAM_CALLBACK_RE = /^t(run|who|rem|con|all|day|his):.*$/;

type CallbackKind = "run" | "who" | "rem" | "con" | "all" | "day" | "his";

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

export interface TodayItem {
  run: TeamRun;
  stats: RunStats;
  when: "today" | "tomorrow" | "later";
}

/** /today — что происходит прямо сейчас: забеги рядом и статус рассылок. */
export function todayText(today: string, hourMsk: number, items: TodayItem[]): string {
  const head = `Сегодня ${today}, ${String(hourMsk).padStart(2, "0")}:00 МСК.`;
  const near = items.filter((i) => i.when !== "later");

  if (near.length === 0) {
    const next = items[0];
    return [
      head,
      "",
      "Сегодня и завтра забегов нет.",
      next
        ? `Ближайший: ${next.run.label}` +
          (next.run.scheduled ? ` — ${runWhenWhere(next.run.scheduled)}` : "")
        : "Расписание пустое.",
    ].join("\n");
  }

  const block = (i: TodayItem) => {
    const title = i.when === "today" ? "СЕГОДНЯ" : "ЗАВТРА";
    const lines = [`${title}: ${i.run.label}`];
    if (i.run.scheduled) {
      lines.push(
        `  сбор ${i.run.scheduled.gatherTime}, старт ${i.run.scheduled.startTime} — ${i.run.scheduled.address}`,
      );
    }
    lines.push(
      `  подтвердили ${i.stats.confirmed} из ${i.stats.total}, напомнили ${i.stats.reminded}`,
    );
    if (i.when === "tomorrow" && i.stats.reminded === 0 && hourMsk >= REMINDER_HOUR_MSK) {
      lines.push("  ⚠️ окно рассылки открыто, а напоминания ещё не ушли — проверь логи");
    }
    if (i.stats.unconfirmed > 0) {
      lines.push(`  ⚠️ ${i.stats.unconfirmed} чел. бот не достанет: не подтвердились`);
    }
    return lines.join("\n");
  };

  return [head, "", ...near.map(block)].join("\n");
}

// ── Команда ──────────────────────────────────────────────────────────────────

/** /team — состав. Видно всем внутри: кто ещё читает те же цифры. */
export function teamText(members: TeamMember[], meChatId: number): string {
  if (members.length === 0) return "В команде пока никого — странно, ведь ты как-то сюда попал.";
  const line = (m: TeamMember) => {
    const who = m.username ? `@${m.username}` : (m.display_name ?? String(m.chat_id));
    const role = m.role === "owner" ? " · владелец" : "";
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

export function helpText(role: TeamMember["role"]): string {
  const lines = [
    "Задачи команды и оперативка по забегам.",
    "",
    "/tasks — мои задачи со сроками",
    "/assigned — мои назначенные задачи",
  ];
  if (role === "owner") lines.push(
    "/assign — раздать список: что делать / срок / @ник",
    "/assign_status — общий список и выполненные задачи",
  );
  lines.push(
    "",
    "/today — что происходит сегодня и завтра",
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
  if (role === "owner") lines.push("/kick @ник — убрать человека из команды");
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
