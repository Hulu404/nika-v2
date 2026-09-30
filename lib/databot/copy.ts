import { cb } from "./callback";
import { escapeHtml } from "./html";
import { WORDS, countWord, formatDayDate, formatDdMm, formatMskTime } from "./format";
import { mskDayMonth, mskTime } from "./time";
import { REPORTS, ZONES, type InlineButton, type ReportId, type Screen, type Section, type Zone } from "./types";

/**
 * Тексты и меню бота данных. Как lib/team/copy.ts: только строки и чистые
 * функции, к базе не обращается — поэтому покрывается тестами без моков.
 *
 * Все строки — Telegram HTML (parse_mode HTML на каждом ответе). Любое
 * динамическое значение проходит через escapeHtml.
 *
 * Голос: от первого лица в женском роде, коротко. Термины по глоссарию v3.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Доступ, лимит, аварии
// ─────────────────────────────────────────────────────────────────────────────

/** Единственное, что видит человек без доступа, — на любой апдейт в личке. */
export const STRANGER_TEXT = "Это внутренний бот команды НИКИ. Доступ по приглашению.";

export const RATE_LIMIT_TEXT = "Слишком часто, подожди минуту";

/** База не ответила: это не «ноль» и не «чужой». Принцип withData. */
export const DB_DOWN_TEXT = "Не получилось достать данные, база не ответила. Попробуй через минуту";

export const STALE_TEXT = "Этот экран устарел";

export const NOT_READY_TEXT = "Этот раздел ещё собираю";

export const UNKNOWN_TEXT = "Не поняла вопрос. Вот что я умею:";

export const CANCEL_TEXT = "Отменила.";

/** Владелец из DATABOT_OWNER_IDS: его нельзя убрать или перевести в другую зону через бота. */
export const OWNER_PROTECTED_TEXT = "Владельца из настроек бота нельзя убрать или перевести в другую зону.";

/** Приглашение просрочено или уже использовано. Имя — того, кто приглашал. */
export function inviteExpiredText(inviterName: string | null): string {
  const who = inviterName ? escapeHtml(inviterName) : "владельца бота";
  return `Ссылка устарела, попроси новую у ${who}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Зоны и разделы
// ─────────────────────────────────────────────────────────────────────────────

export const ZONE_LABEL: Record<Zone, string> = {
  council: "Совет",
  events: "Ивенты",
  smm: "СММ",
};

/** Кнопки постоянной клавиатуры — они же названия разделов в текстах. */
export const SECTION_LABEL: Record<Section, string> = {
  run: "Забеги",
  tr: "Соцсети",
  pro: "Про и оплаты",
  prd: "Продукт",
  kb: "Справочник",
  tm: "Команда",
  tsk: "Мои задачи",
};

/** Описание команды раздела в меню Telegram. */
export const SECTION_COMMAND_DESCRIPTION: Record<Section, string> = {
  run: "Забеги: заявки и динамика",
  tr: "Соцсети и метки",
  pro: "Про и оплаты",
  prd: "Продукт",
  kb: "Справочник команды",
  tm: "Команда: кто в боте",
  tsk: "Мои задачи и общий пул",
};

export const HELP_COMMAND_DESCRIPTION = "Что я умею";

/**
 * Меню команд по умолчанию — для всех, кто открыл бота. Разделы зоны ставятся
 * человеку отдельно, со scope chat.
 */
export const DATABOT_DEFAULT_COMMANDS = [
  { command: "help", description: HELP_COMMAND_DESCRIPTION },
  { command: "assigned", description: "Назначенные мне задачи" },
  { command: "assign", description: "Загрузить список задач (владелец)" },
] as const;

/** Раздел по тексту кнопки постоянной клавиатуры. */
export function sectionByLabel(text: string): Section | null {
  const t = text.trim();
  for (const [section, label] of Object.entries(SECTION_LABEL) as [Section, string][]) {
    if (label === t) return section;
  }
  return null;
}

function sectionList(sections: readonly Section[]): string {
  return sections.map((s) => SECTION_LABEL[s]).join(", ");
}

/** Кто видит раздел — для отказа. «owner» — только владелец. */
export type Audience = readonly Zone[] | "owner";

function audienceText(audience: Audience): string {
  if (audience === "owner") return "Это может только владелец бота";
  const names = audience.map((z) => ZONE_LABEL[z].toLowerCase());
  if (names.length === 1) return `Это видит ${names[0]}`;
  return `Это видят ${names.slice(0, -1).join(", ")} и ${names[names.length - 1]}`;
}

/** Отказ по зоне: «Это видит совет. Тебе доступны: …». */
export function forbiddenText(audience: Audience, available: readonly Section[]): string {
  const head = audienceText(audience);
  if (available.length === 0) return `${head}. Твои разделы ещё собираю.`;
  return `${head}. Тебе доступны: ${sectionList(available)}.`;
}

/** Отказ по данным: статья справочника не для этой зоны. */
export function itemForbiddenText(available: readonly Section[]): string {
  if (available.length === 0) return "Это закрыто для твоей зоны.";
  return `Это закрыто для твоей зоны. Тебе доступны: ${sectionList(available)}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Вход, меню, помощь
// ─────────────────────────────────────────────────────────────────────────────

function sectionsLine(available: readonly Section[]): string {
  if (available.length === 0) return "Разделы для тебя ещё собираю — появятся в меню, как будут готовы.";
  return `Разделы: ${sectionList(available)}. Кнопки внизу.`;
}

/** Первый вход — по приглашению или владелец. */
export function welcomeText(zone: Zone, available: readonly Section[]): string {
  return [
    "Привет! Я бот данных команды НИКИ: отвечаю цифрами из базы.",
    `Твоя зона — ${ZONE_LABEL[zone]}.`,
    sectionsLine(available),
  ].join("\n");
}

/** /start уже вошедшего и «Назад» в меню. */
export function menuText(zone: Zone, available: readonly Section[]): string {
  return [`Зона — ${ZONE_LABEL[zone]}.`, sectionsLine(available)].join("\n");
}

export function helpText(zone: Zone, available: readonly Section[], commands: readonly string[]): string {
  const lines = ["Я отвечаю цифрами из базы, только своим и только в личке.", `Твоя зона — ${ZONE_LABEL[zone]}.`];
  lines.push(sectionsLine(available));
  if (commands.length) lines.push(`Команды: ${commands.map((c) => `/${c}`).join(" ")}`);
  lines.push("/cancel — отменить начатое.");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Каркас ответа (ТЗ 4.10)
// ─────────────────────────────────────────────────────────────────────────────
// Первая строка — сам ответ (цифра, объект, дата или период). Дальше не больше
// восьми строк подробностей, каждая — отдельный пункт, чтобы читалось с
// телефона. Если у раздела есть слепые зоны — одна строка о них. Последняя
// строка — «Данные на 14:32 МСК». Длинное сообщение делится на страницы.

export const MAX_DETAIL_LINES = 8;
/** Лимит Telegram на текст сообщения. */
export const MAX_MESSAGE_CHARS = 4096;

export const MORE_BUTTON = "Ещё";

const NL = "\n";

/** «Данные на 14:32 МСК» — последняя строка каждого ответа с цифрами. */
export function dataAtLine(at: Date): string {
  return `Данные на ${formatMskTime(at)}`;
}

/**
 * Сравнение всегда подписано, с чем сравниваем: «214 (неделей раньше 168)».
 * Прошлое значение null — сравнивать не с чем, подписи нет.
 */
export function withComparison(current: string, previous: string | null, label: string): string {
  return previous === null ? current : `${current} (${label} ${previous})`;
}

export interface Answer {
  /** Первая строка — сам ответ. Уже HTML: динамику экранирует вызывающий. */
  headline: string;
  /** Подробности, не больше восьми строк. */
  details?: readonly string[];
  /** Слепая зона раздела — одной строкой, если есть. */
  blindSpot?: string | null;
  /** Когда посчитаны данные. */
  at: Date;
}

/**
 * Текст ответа по каркасу. Больше восьми строк подробностей — ошибка в коде
 * раздела (бросаем): резать молча значило бы терять цифры незаметно. Длинные
 * списки идут не сюда, а в paginate.
 */
export function answerText(a: Answer): string {
  const details = a.details ?? [];
  if (details.length > MAX_DETAIL_LINES) {
    throw new Error(`ответ: ${details.length} строк подробностей, можно не больше ${MAX_DETAIL_LINES}`);
  }
  const lines = [a.headline, ...details];
  if (a.blindSpot) lines.push(a.blindSpot);
  lines.push(dataAtLine(a.at));
  return lines.join(NL);
}

/**
 * Деление длинного текста на страницы не длиннее max символов — по строкам,
 * чтобы не рвать пункт посередине. Строка длиннее max режется по символам:
 * лучше некрасиво, чем Telegram откажет в отправке. header повторяется на
 * каждой странице (например, «Персональные данные участников. Не пересылать»).
 */
export function paginate(lines: readonly string[], opts: { max?: number; header?: string } = {}): string[] {
  const max = opts.max ?? MAX_MESSAGE_CHARS;
  const header = opts.header ?? "";
  const budget = max - (header ? header.length + 1 : 0);
  if (budget <= 0) throw new Error("paginate: заголовок длиннее страницы");

  const pieces: string[] = [];
  for (const line of lines) {
    if (line.length <= budget) pieces.push(line);
    else for (let i = 0; i < line.length; i += budget) pieces.push(line.slice(i, i + budget));
  }

  const pages: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const piece of pieces) {
    const add = (current.length ? 1 : 0) + piece.length;
    if (current.length && size + add > budget) {
      pages.push(current.join(NL));
      current = [];
      size = 0;
    }
    size += (current.length ? 1 : 0) + piece.length;
    current.push(piece);
  }
  if (current.length || pages.length === 0) pages.push(current.join(NL));
  return header ? pages.map((p) => header + NL + p) : pages;
}

/**
 * Одна страница с кнопкой «Ещё», если дальше есть что показать. moreData —
 * callback_data следующей страницы: раздел пересчитывает ответ и отдаёт
 * нужную страницу, состояния между нажатиями бот не держит.
 */
export function pageScreen(
  pages: readonly string[],
  page: number,
  moreData: (nextPage: number) => string,
  extraButtons: InlineButton[][] = [],
): Screen {
  const index = Math.min(Math.max(page, 0), Math.max(pages.length - 1, 0));
  const buttons: InlineButton[][] = [];
  if (index < pages.length - 1) buttons.push([{ text: MORE_BUTTON, data: moreData(index + 1) }]);
  buttons.push(...extraButtons);
  return { text: pages[index] ?? "", buttons: buttons.length ? buttons : undefined };
}

// ─────────────────────────────────────────────────────────────────────────────
// Команда
// ─────────────────────────────────────────────────────────────────────────────

/** Название отчёта в «Кто пользуется». Record по ReportId: новый отчёт без подписи не соберётся. */
export const REPORT_LABEL: Record<ReportId, string> = {
  "run.section": "Экран «Забеги»",
  "run.card": "Карточка забега",
  "run.past": "Прошедшие забеги",
  "run.table": "Таблица забегов",
  "run.table.csv": "CSV забегов",
  "run.people": "Список участников",
  "run.plan.set": "План явки",
  "tr.section": "Экран «Соцсети»",
  "tr.channels": "Переходы по каналам",
  "tr.codes": "Переходы по меткам",
  "tr.code": "Карточка метки",
  "tr.csv": "CSV по меткам",
  "tr.issue": "Выдать метку",
  "pro.summary": "Про и оплаты",
  "prd.summary": "Продукт",
  "kb.list": "Справочник",
  "kb.article": "Статья справочника",
  "kb.edit": "Правка справочника",
  "tm.list": "Состав команды",
  "tm.usage": "Кто пользуется",
  "tm.invite": "Приглашение",
  "tm.zone": "Смена зоны",
  "tm.remove": "Убрать из команды",
  "tsk.list": "Мои задачи",
  "tsk.take": "Взять задачу",
  "tsk.done": "Завершить задачу",
};

/** ReportId ли строка из журнала (там же служебные значения и, в теории, старые ID). */
export function isReportId(value: string): value is ReportId {
  return (REPORTS as readonly string[]).includes(value);
}

/** Имя человека как есть (не экранировано): имя из Telegram, иначе @ник, иначе «без имени». */
export function memberName(m: { display_name: string | null; username: string | null }): string {
  const name = m.display_name?.trim();
  if (name) return name;
  if (m.username) return `@${m.username}`;
  return "без имени";
}

/**
 * Имя в тексте кнопки. Кнопка — не HTML, экранировать не надо, но длинное имя
 * растягивает ряд из двух кнопок, и Telegram режет обе подписи.
 */
export const BUTTON_NAME_MAX = 16;

export function buttonName(name: string): string {
  const chars = [...name]; // по кодовым точкам — эмодзи в имени не режем пополам
  return chars.length <= BUTTON_NAME_MAX ? name : `${chars.slice(0, BUTTON_NAME_MAX - 1).join("")}…`;
}

/** Строка списка «Команда» — всё уже посчитано в team.ts, здесь только вёрстка. */
export interface TeamMemberView {
  chatId: number;
  /** Сырое имя (memberName); экранирует экран. */
  name: string;
  username: string | null;
  zone: Zone;
  isOwner: boolean;
  lastSeenAt: string | null;
  requests7d: number;
  /** Рисовать ли «Зона» и «Убрать»: владельцу из env и самому смотрящему — нет. */
  manageable: boolean;
}

const BACK = "Назад";

function dataAt(now: Date): string {
  return dataAtLine(now);
}

function visitText(iso: string | null): string {
  return iso ? `визит ${mskDayMonth(iso)} ${mskTime(iso)}` : "визитов не было";
}

function memberLines(m: TeamMemberView): string {
  const head = [`<b>${escapeHtml(m.name)}</b>`];
  // Ник отдельно, только если имя — не он сам.
  if (m.username && m.name !== `@${m.username}`) head.push(`@${escapeHtml(m.username)}`);
  const tags = [ZONE_LABEL[m.zone]];
  if (m.isOwner) tags.push("владелец");
  return `${head.join(" ")} · ${tags.join(" · ")}\n${visitText(m.lastSeenAt)} · запросов за 7 дней: ${m.requests7d}`;
}

/**
 * Экран «Команда». Кнопки управления рисуются только там, где можно (решает
 * team.ts через матрицу), — здесь лишь раскладка. Список людей не пересылается.
 */
export function teamListScreen(args: {
  members: readonly TeamMemberView[];
  canInvite: boolean;
  now: Date;
  /** Строка сверху: «Готово: …», «Убрала …». Уже HTML. */
  notice?: string;
}): Screen {
  const parts: string[] = [];
  if (args.notice) parts.push(args.notice);
  parts.push(`<b>Команда</b> · в боте ${args.members.length}`);
  if (args.members.length === 0) parts.push("Пока никого нет.");
  for (const m of args.members) parts.push(memberLines(m));
  parts.push(dataAt(args.now));

  const buttons: InlineButton[][] = [];
  const top: InlineButton[] = [{ text: "Кто пользуется", data: cb("tm", "usage") }];
  if (args.canInvite) top.push({ text: "Пригласить", data: cb("tm", "inv") });
  buttons.push(top);
  for (const m of args.members) {
    if (!m.manageable) continue;
    const short = buttonName(m.name);
    buttons.push([
      { text: `Зона: ${short}`, data: cb("tm", "zone", m.chatId) },
      { text: `Убрать: ${short}`, data: cb("tm", "rm", m.chatId) },
    ]);
  }
  buttons.push([{ text: BACK, data: cb("tm", "home") }]);
  return { text: parts.join("\n\n"), buttons, protect: true };
}

/** «Кто пользуется»: люди по убыванию запросов и пять самых частых отчётов. */
export function teamUsageScreen(args: {
  people: ReadonlyArray<{ name: string; requests: number }>;
  top: ReadonlyArray<{ report: ReportId; count: number }>;
  now: Date;
}): Screen {
  const lines = ["<b>Кто пользуется</b> · запросы за 7 дней"];
  for (const p of args.people) lines.push(`${escapeHtml(p.name)} — ${p.requests}`);
  lines.push("");
  if (args.top.length === 0) {
    lines.push("Отчётов за 7 дней не было");
  } else {
    lines.push("Чаще всего:");
    for (const t of args.top) lines.push(`${REPORT_LABEL[t.report]} — ${t.count}`);
  }
  lines.push(dataAt(args.now));
  return {
    text: lines.join("\n"),
    buttons: [[{ text: BACK, data: cb("tm", "list") }]],
    protect: true,
  };
}

export function teamInviteZoneScreen(): Screen {
  return {
    text: "Кого зовём? Выбери зону",
    buttons: [
      ZONES.map((z) => ({ text: ZONE_LABEL[z], data: cb("tm", "inv", z) })),
      [{ text: BACK, data: cb("tm", "list") }],
    ],
  };
}

/** Владельцу: ссылка и условия. Текст для новичка — следующим сообщением. */
export function teamInviteOwnerScreen(zone: Zone, link: string): Screen {
  return {
    text: [
      `Приглашение в зону <b>${ZONE_LABEL[zone]}</b> готово:`,
      escapeHtml(link),
      "Срабатывает один раз, живёт 48 часов. Текст для пересылки — следующим сообщением.",
    ].join("\n"),
    buttons: [[{ text: BACK, data: cb("tm", "list") }]],
  };
}

/**
 * Готовый текст новичку. Без кнопок: его пересылают или копируют целиком.
 * Пишет владелец от себя, поэтому без рода и без «я — бот».
 */
export function teamInviteForwardScreen(zone: Zone, link: string): Screen {
  return {
    text: [
      "Привет! Зову тебя в бот данных команды НИКИ: он отвечает цифрами из базы — забеги, соцсети и метки, справочник команды.",
      `Твоя зона — ${ZONE_LABEL[zone]}.`,
      `Открой ссылку и нажми Start: ${escapeHtml(link)}`,
      "Ссылка одноразовая, работает 48 часов.",
    ].join("\n"),
  };
}

export function teamZonePickScreen(target: { chatId: number; name: string; zone: Zone }): Screen {
  return {
    text: `Зона <b>${escapeHtml(target.name)}</b> сейчас — ${ZONE_LABEL[target.zone]}. Какую ставим?`,
    buttons: [
      ZONES.map((z) => ({
        text: z === target.zone ? `✓ ${ZONE_LABEL[z]}` : ZONE_LABEL[z],
        data: cb("tm", "zone", target.chatId, z),
      })),
      [{ text: BACK, data: cb("tm", "list") }],
    ],
  };
}

/** commandsOk = false — зону сменила, а меню команд Telegram не принял. */
export function teamZoneChangedText(name: string, zone: Zone, commandsOk: boolean): string {
  const head = `Готово: <b>${escapeHtml(name)}</b> теперь в зоне ${ZONE_LABEL[zone]}.`;
  return commandsOk
    ? `${head} Меню команд уже новое, клавиатура обновится со следующим ответом бота.`
    : `${head} Меню команд обновить не получилось — смени зону ещё раз чуть позже.`;
}

export function teamRemoveConfirmScreen(target: { chatId: number; name: string }): Screen {
  return {
    text: `Убрать <b>${escapeHtml(target.name)}</b>? Доступ пропадёт сразу.`,
    buttons: [
      [
        { text: "Убрать", data: cb("tm", "rm", target.chatId, "ok") },
        { text: "Отмена", data: cb("tm", "list") },
      ],
    ],
  };
}

export function teamRemovedText(name: string): string {
  return `Убрала <b>${escapeHtml(name)}</b>.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Забеги
// ─────────────────────────────────────────────────────────────────────────────
// Цифры приходят уже посчитанными функциями lib/team и SQL-функциями 037 —
// здесь только вёрстка, поэтому карточка проверяется тестом без базы.

/** Точка в предложном падеже — для «по двум прошлым забегам в Лужниках». */
const SPOT_WHERE: Record<string, string> = {
  luzhniki: "в Лужниках",
  usachevo: "на Усачёва",
};

export function spotWhere(spot: string, name: string): string {
  return SPOT_WHERE[spot] ?? `на точке «${name}»`;
}

/** Кнопка забега: «Surf Coffee® Лужники · сб 03.10». */
export function runButtonText(spotName: string, date: string): string {
  return `${spotName} · ${formatDayDate(date)}`;
}

export interface RunRef {
  spot: string;
  date: string;
  spotName: string;
}

const RUNS_BACK: InlineButton = { text: BACK, data: cb("run", "list") };

/** Экран раздела: до четырёх ближайших забегов, прошедшие, таблица. */
export function runsSectionScreen(upcoming: readonly RunRef[]): Screen {
  const text =
    upcoming.length === 0
      ? "<b>Забеги</b>\nБлижайших забегов в расписании нет. Новый появится здесь, как только его добавят в расписание."
      : "<b>Забеги</b>\nБлижайшие — кнопками ниже.";
  const buttons: InlineButton[][] = upcoming.map((r) => [
    { text: runButtonText(r.spotName, r.date), data: cb("run", "card", r.spot, r.date) },
  ]);
  buttons.push([
    { text: "Прошедшие", data: cb("run", "past") },
    { text: "Все забеги таблицей", data: cb("run", "table") },
  ]);
  buttons.push([{ text: BACK, data: cb("run", "home") }]);
  return { text, buttons };
}

/** Список забегов кнопками: прошедшие вообще или одной точки. */
export function runsListScreen(title: string, runs: readonly RunRef[], empty: string): Screen {
  const buttons: InlineButton[][] = runs.map((r) => [
    { text: runButtonText(r.spotName, r.date), data: cb("run", "card", r.spot, r.date) },
  ]);
  buttons.push([RUNS_BACK]);
  return { text: runs.length ? `<b>${escapeHtml(title)}</b>` : escapeHtml(empty), buttons };
}

/** На дату два забега и больше — «Уточни:» и кнопки спотов. */
export function runsClarifyScreen(runs: readonly RunRef[]): Screen {
  return {
    text: "Уточни:",
    buttons: [
      ...runs.map((r) => [{ text: runButtonText(r.spotName, r.date), data: cb("run", "card", r.spot, r.date) }]),
      [RUNS_BACK],
    ],
  };
}

/** На дату забегов нет — «На 04.10 забегов нет. Ближайшие:». */
export function runsNoneOnDateScreen(date: string, upcoming: readonly RunRef[]): Screen {
  const text = upcoming.length
    ? `На ${formatDdMm(date)} забегов нет. Ближайшие:`
    : `На ${formatDdMm(date)} забегов нет. Ближайших в расписании тоже нет.`;
  return {
    text,
    buttons: [
      ...upcoming.map((r) => [{ text: runButtonText(r.spotName, r.date), data: cb("run", "card", r.spot, r.date) }]),
      [RUNS_BACK],
    ],
  };
}

export const RUN_ATTENDANCE_UNKNOWN = "Явку база не знает: сколько людей дошло, смотрим в строке цифр ведущей";
export const RUN_PLAN_UNSET = "План явки не задан";
export const RUN_TOPUP_LINE = "Ниже 60 % плана: по регламенту включаем добор";
/** Порог добора по регламенту точки и окно «за 1–3 дня до старта». */
export const RUN_TOPUP_PERCENT = 60;
export const RUN_TOPUP_DAYS = { min: 1, max: 3 } as const;

export interface RunCardModel {
  spot: string;
  date: string;
  spotName: string;
  past: boolean;
  /** Из расписания; у прошедшего забега вне расписания — null. */
  schedule: { gatherTime: string; startTime: string; address: string } | null;
  total: number;
  confirmed: number;
  reminded: number;
  /** Показывать ли напоминания: окно рассылки уже наступило. */
  reminderWindowOpen: boolean;
  last24h: number;
  newPeople: number;
  returningPeople: number;
  /** В порядке lib/coffeerun/pace.ts, «без темпа» — последним (null). */
  byPace: ReadonlyArray<{ pace: string | null; count: number }>;
  /** Код метки или "none" → заявок. */
  byLink: Readonly<Record<string, number>>;
  plan: number | null;
  /** Московских дней до старта; null — забег прошёл. */
  daysBefore: number | null;
  /** Строка динамики формулировками lib/team; null — сравнивать не с чем. */
  dynamics: string | null;
  /** Строка прогноза из forecast.ts; null — строки нет. */
  forecast: string | null;
  canPeople: boolean;
  canPlan: boolean;
  at: Date;
}

function paceLine(byPace: RunCardModel["byPace"]): string | null {
  if (!byPace.some((b) => b.count > 0)) return null;
  return `Темп: ${byPace.map((b) => `${b.pace ?? "без темпа"} — ${b.count}`).join(", ")}`;
}

/** Строка меток — только если хоть одна заявка пришла по метке. */
function linkLine(byLink: RunCardModel["byLink"]): string | null {
  const coded = Object.entries(byLink).filter(([code]) => code !== "none");
  if (coded.length === 0) return null;
  coded.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const parts = coded.map(([code, n]) => `${escapeHtml(code)} — ${n}`);
  if (byLink.none) parts.push(`без метки — ${byLink.none}`);
  return `По меткам: ${parts.join(", ")}`;
}

/** Процент заявок от плана — целым, как в примере «92 % от плана». */
export function planPercent(total: number, plan: number): number {
  return Math.round((total / plan) * 100);
}

/** Добор по регламенту: до старта 1–3 дня и заявок меньше 60 % плана. */
export function needsTopUp(m: Pick<RunCardModel, "total" | "plan" | "daysBefore">): boolean {
  if (m.plan === null || m.daysBefore === null) return false;
  if (m.daysBefore < RUN_TOPUP_DAYS.min || m.daysBefore > RUN_TOPUP_DAYS.max) return false;
  return planPercent(m.total, m.plan) < RUN_TOPUP_PERCENT;
}

/**
 * Карточка забега по 4.4, порядок строк как в примере 4.10. Шапка (название,
 * а у будущего — ещё сбор, старт и адрес) идёт первой строкой ответа; дальше
 * не больше восьми строк подробностей.
 */
export function runCardScreen(m: RunCardModel): Screen {
  const title = `Кофе-ран · ${escapeHtml(m.spotName)} · ${formatDayDate(m.date)}`;
  const headline =
    !m.past && m.schedule
      ? `${title}\nСбор ${escapeHtml(m.schedule.gatherTime)}, старт ${escapeHtml(m.schedule.startTime)} · ${escapeHtml(m.schedule.address)}`
      : title;

  const details: string[] = [];
  if (m.total === 0) {
    details.push(m.past ? "Итог: заявок не было" : "Заявок пока нет");
  } else {
    const parts = [`${m.past ? "Итог: заявок" : "Заявок"} ${m.total}`, `подтвердили в боте ${m.confirmed}`];
    if (m.reminderWindowOpen) parts.push(`напоминание ушло ${m.reminded}`);
    if (!m.past) parts.push(`за сутки +${m.last24h}`);
    details.push(parts.join(", "));
    details.push(`Новых среди заявок ${m.newPeople}, записывались раньше ${m.returningPeople}`);
    const pace = paceLine(m.byPace);
    if (pace) details.push(pace);
    const links = linkLine(m.byLink);
    if (links) details.push(links);
  }

  if (m.plan !== null) {
    details.push(`План явки ${m.plan}, заявок ${planPercent(m.total, m.plan)} % от плана`);
    if (!m.past && needsTopUp(m)) details.push(RUN_TOPUP_LINE);
  } else if (!m.past) {
    details.push(RUN_PLAN_UNSET);
  }

  if (!m.past) {
    if (m.dynamics) details.push(escapeHtml(m.dynamics));
    if (m.forecast) details.push(escapeHtml(m.forecast));
  }

  const text = answerText({
    headline,
    details,
    blindSpot: m.past ? RUN_ATTENDANCE_UNKNOWN : null,
    at: m.at,
  });

  const buttons: InlineButton[][] = [];
  const row: InlineButton[] = [];
  if (m.canPeople) row.push({ text: "Список участников", data: cb("run", "people", m.spot, m.date, 1) });
  if (m.canPlan && !m.past) row.push({ text: "План явки", data: cb("run", "plan", m.spot, m.date) });
  if (row.length) buttons.push(row);
  buttons.push([
    { text: "Прошлые забеги этой точки", data: cb("run", "spot", m.spot) },
    { text: "Все забеги", data: cb("run", "list") },
  ]);
  return { text, buttons };
}

// ── Список участников ────────────────────────────────────────────────────────
// Самый строгий режим приватности во всём боте: имя, @ник, темп и «впервые» —
// больше ничего; каждая часть — новым сообщением с protect_content.

export const PEOPLE_HEADER = "Персональные данные участников. Не пересылать";
export const PEOPLE_WINDOW_TEXT = "Список открыт с 14 дней до забега до 3 дней после него";
export const PEOPLE_PAGE_SIZE = 30;

/** Значки и смысл — как в lib/team/copy.ts; порядок групп — как в viewSignups. */
export const PEOPLE_ICON = { unconfirmed: "⚠️", waiting: "⏳", reminded: "✅" } as const;
export const PEOPLE_GROUP = {
  unconfirmed: "не подтвердил участие",
  waiting: "ждёт напоминания",
  reminded: "напоминание ушло",
} as const;
export type PeopleStatus = keyof typeof PEOPLE_ICON;

export interface PeopleRow {
  status: PeopleStatus;
  name: string;
  nick: string | null;
  pace: string | null;
  isNew: boolean;
}

function personLine(p: PeopleRow): string {
  const parts = [`${PEOPLE_ICON[p.status]} ${escapeHtml(p.name)}`];
  if (p.nick) parts[0] += ` @${escapeHtml(p.nick)}`;
  if (p.pace) parts.push(escapeHtml(p.pace));
  if (p.isNew) parts.push("впервые");
  return parts.join(" · ");
}

/**
 * Одна страница списка (page с 1). rows уже в порядке групп и времени заявки.
 * Шапка приватности — на каждой странице: страницу могут открыть отдельно.
 */
export function peoplePageScreen(args: {
  spot: string;
  date: string;
  spotName: string;
  rows: readonly PeopleRow[];
  page: number;
}): Screen {
  const pages = Math.max(1, Math.ceil(args.rows.length / PEOPLE_PAGE_SIZE));
  const page = Math.min(Math.max(1, args.page), pages);
  const slice = args.rows.slice((page - 1) * PEOPLE_PAGE_SIZE, page * PEOPLE_PAGE_SIZE);

  const counts = { unconfirmed: 0, waiting: 0, reminded: 0 };
  for (const r of args.rows) counts[r.status]++;

  const lines = [
    `<b>${PEOPLE_HEADER}</b>`,
    `Кофе-ран · ${escapeHtml(args.spotName)} · ${formatDayDate(args.date)} · ${countWord(args.rows.length, WORDS.signup)}` +
      (pages > 1 ? ` · часть ${page} из ${pages}` : ""),
  ];
  if (args.rows.length === 0) {
    lines.push("Заявок пока нет.");
  } else {
    if (page === 1) {
      lines.push(
        (Object.keys(PEOPLE_ICON) as PeopleStatus[])
          .map((s) => `${PEOPLE_ICON[s]} ${PEOPLE_GROUP[s]} — ${counts[s]}`)
          .join("\n"),
      );
    }
    lines.push(slice.map(personLine).join("\n"));
  }

  const buttons: InlineButton[][] = [];
  if (page < pages) buttons.push([{ text: MORE_BUTTON, data: cb("run", "people", args.spot, args.date, page + 1) }]);
  buttons.push([{ text: "К забегу", data: cb("run", "card", args.spot, args.date) }]);
  return { text: lines.join("\n\n"), buttons, protect: true };
}

// ── План явки ────────────────────────────────────────────────────────────────

export const PLAN_MIN = 5;
export const PLAN_MAX = 200;
export const PLAN_ASK = `Сколько человек считаем полной точкой? Пришли число от ${PLAN_MIN} до ${PLAN_MAX}. Отмена — /cancel`;
export const PLAN_RETRY = `Нужно целое число от ${PLAN_MIN} до ${PLAN_MAX}. Пришли ещё раз или /cancel`;
export const PLAN_PAST_TEXT = "План явки задаётся только будущим забегам";
export const FORM_EXPIRED_TEXT = "Форма устарела. Открой её заново кнопкой";

export function planSavedText(target: number): string {
  return `Записала план явки: ${target}.`;
}

// ── Все забеги таблицей и CSV ────────────────────────────────────────────────

/** Короткое имя точки для узкой строки таблицы. */
const SPOT_SHORT: Record<string, string> = { luzhniki: "Лужники", usachevo: "Усачёва" };

export function spotShort(spot: string, fallback: string): string {
  return SPOT_SHORT[spot] ?? fallback;
}

export interface RunsTableLine {
  spot: string;
  spotName: string;
  runDate: string;
  total: number;
  confirmed: number;
  reminded: number;
  newPeople: number;
}

/** «сб 03.10 · Лужники · заявок 23 · подтв. 17 · новых 15» — узко, для телефона. */
export function runsTableLine(r: RunsTableLine): string {
  return (
    `${formatDayDate(r.runDate)} · ${escapeHtml(spotShort(r.spot, r.spotName))} · ` +
    `заявок ${r.total} · подтв. ${r.confirmed} · новых ${r.newPeople}`
  );
}

export function runsTablePages(rows: readonly RunsTableLine[], at: Date): string[] {
  const header = "<b>Все забеги</b> · свежие сверху";
  const lines = rows.length ? rows.map(runsTableLine) : ["Забегов в базе пока нет."];
  // Строка времени — последней на каждой странице, как у любого ответа с цифрами.
  const footer = dataAtLine(at);
  return paginate(lines, { header, max: MAX_MESSAGE_CHARS - footer.length - 1 }).map((p) => p + NL + footer);
}

export function runsTableScreen(rows: readonly RunsTableLine[], page: number, at: Date): Screen {
  const pages = runsTablePages(rows, at);
  return pageScreen(pages, page - 1, (next) => cb("run", "table", next + 1), [
    [
      { text: "CSV", data: cb("run", "csv") },
      { text: BACK, data: cb("run", "list") },
    ],
  ]);
}

const CSV_SEP = ";";
const BOM = "﻿";

function csvCell(value: string | number): string {
  const s = String(value);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV «Все забеги»: только агрегаты, ни одного имени. UTF-8 с BOM, чтобы Excel
 * открыл кириллицу; разделитель «;» — русский Excel ждёт именно его.
 */
export function runsCsv(rows: readonly RunsTableLine[]): string {
  const head = ["Дата", "Точка", "Заявок", "Подтвердили", "Напоминание ушло", "Новых"];
  const body = rows.map((r) =>
    [
      `${r.runDate.slice(8, 10)}.${r.runDate.slice(5, 7)}.${r.runDate.slice(0, 4)}`,
      spotShort(r.spot, r.spotName),
      r.total,
      r.confirmed,
      r.reminded,
      r.newPeople,
    ]
      .map(csvCell)
      .join(CSV_SEP),
  );
  return BOM + [head.join(CSV_SEP), ...body].join("\r\n") + "\r\n";
}

/** Имя по правилу команды «дата_что»: 2026-09-27_забеги.csv. */
export function runsCsvFilename(today: string): string {
  return `${today}_забеги.csv`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Справочник
// ─────────────────────────────────────────────────────────────────────────────
// Тексты статей в репозитории не живут (он публичный) — здесь только рамка:
// список, подпись «обновлено 27.09, Али», шаги правки и живые статьи.

export const KB_TITLE_MAX = 80;
export const KB_BODY_MAX = 3500;

export const KB_EDIT_ASK = `Пришли новый текст одним сообщением, до ${KB_BODY_MAX} знаков. Отмена — /cancel`;
export const KB_NEW_TITLE_ASK = `Пришли заголовок новой статьи одним сообщением, до ${KB_TITLE_MAX} знаков. Отмена — /cancel`;
export const KB_NEW_BODY_ASK = `Теперь текст статьи одним сообщением, до ${KB_BODY_MAX} знаков. Отмена — /cancel`;
export const KB_PREVIEW_INTRO = "Так статью увидят все:";
export const KB_ZONES_ASK = "Кому видна статья? Нажми зоны и «Сохранить».";
export const KB_CHANGED_TEXT = "Статью успели изменить или удалить — открой её заново";
export const KB_EMPTY_TEXT = "Пусто. Пришли текст статьи одним сообщением или /cancel";

export function kbTooLongText(length: number, max: number): string {
  return `Слишком длинно: ${length} знаков, можно до ${max}. Пришли покороче или /cancel`;
}

export function kbTitleBadText(): string {
  return `Заголовок — от 2 до ${KB_TITLE_MAX} знаков. Пришли ещё раз или /cancel`;
}

export function kbSavedText(title: string): string {
  return `Сохранила «${escapeHtml(title)}».`;
}

export function kbRestoredText(title: string): string {
  return `Вернула прошлую версию «${escapeHtml(title)}». Вернуть обратно — той же кнопкой.`;
}

export function kbDeletedText(title: string): string {
  return `Удалила «${escapeHtml(title)}».`;
}

/** «обновлено 27.09, Али»; автора нет — только дата. */
export function kbSignature(updatedAt: string, authorName: string | null): string {
  return authorName ? `обновлено ${mskDayMonth(updatedAt)}, ${escapeHtml(authorName)}` : `обновлено ${mskDayMonth(updatedAt)}`;
}

/**
 * Текст статьи — ровно так её видят все (и так же в предпросмотре).
 * body уже санитизирован; title — обычный текст, экранируется.
 */
export function kbArticleText(title: string, body: string, signature: string | null): string {
  const parts = [`<b>${escapeHtml(title)}</b>`, body];
  if (signature) parts.push(`<i>${signature}</i>`);
  return parts.join("\n\n");
}

export function kbListScreen(items: ReadonlyArray<{ slug: string; title: string }>, canEdit: boolean): Screen {
  const buttons: InlineButton[][] = items.map((a) => [{ text: a.title, data: cb("kb", "art", a.slug) }]);
  if (canEdit) buttons.push([{ text: "Новая статья", data: cb("kb", "new") }]);
  buttons.push([{ text: BACK, data: cb("kb", "home") }]);
  return { text: items.length ? "<b>Справочник</b>" : "<b>Справочник</b>\nСтатей пока нет.", buttons };
}

export function kbArticleScreen(args: {
  slug: string;
  title: string;
  body: string;
  signature: string | null;
  canEdit: boolean;
  hasPrev: boolean;
}): Screen {
  const buttons: InlineButton[][] = [];
  if (args.canEdit) {
    const row: InlineButton[] = [{ text: "Заменить текст", data: cb("kb", "edit", args.slug) }];
    if (args.hasPrev) row.push({ text: "Вернуть прошлую версию", data: cb("kb", "restore", args.slug) });
    buttons.push(row);
    buttons.push([{ text: "Удалить", data: cb("kb", "del", args.slug) }]);
  }
  buttons.push([{ text: "К списку", data: cb("kb", "list") }]);
  return { text: kbArticleText(args.title, args.body, args.signature), buttons };
}

/** Предпросмотр — тот же текст, что увидят все, и кнопки «Сохранить» / «Отмена». */
export function kbPreviewScreens(title: string, body: string, saveData: string): Screen[] {
  return [
    { text: KB_PREVIEW_INTRO },
    {
      text: kbArticleText(title, body, null),
      buttons: [[{ text: "Сохранить", data: saveData }, { text: "Отмена", data: cb("kb", "cancel") }]],
    },
  ];
}

export function kbZonesScreen(selected: readonly Zone[]): Screen {
  return {
    text: KB_ZONES_ASK,
    buttons: [
      ZONES.map((z) => ({ text: `${selected.includes(z) ? "✓ " : ""}${ZONE_LABEL[z]}`, data: cb("kb", "z", z) })),
      [
        { text: "Сохранить", data: cb("kb", "zsave") },
        { text: "Отмена", data: cb("kb", "cancel") },
      ],
    ],
  };
}

export function kbDeleteConfirmScreen(slug: string, title: string): Screen {
  return {
    text: `Удалить «${escapeHtml(title)}»? Вернуть её будет нельзя.`,
    buttons: [[
      { text: "Удалить", data: cb("kb", "del", slug, "ok") },
      { text: "Отмена", data: cb("kb", "art", slug) },
    ]],
  };
}

/** Живая статья «Расписание кофе-ранов»: ближайшие со сбором и адресом, потом недавние. */
export function kbScheduleBody(
  upcoming: ReadonlyArray<{ date: string; spotName: string; when: string | null }>,
  recent: ReadonlyArray<{ date: string; spotName: string }>,
): string {
  const lines: string[] = [];
  if (upcoming.length === 0) lines.push("Ближайших забегов в расписании нет.");
  for (const r of upcoming) {
    lines.push(`${formatDayDate(r.date)} · ${escapeHtml(r.spotName)}${r.when ? `\n${escapeHtml(r.when)}` : ""}`);
  }
  if (recent.length) {
    lines.push("", "Недавно прошли:");
    for (const r of recent) lines.push(`${formatDayDate(r.date)} · ${escapeHtml(r.spotName)}`);
  }
  return lines.join("\n");
}

const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  telegram: "Telegram",
  vk: "ВКонтакте",
  offline: "Офлайн",
  partner: "Партнёры",
  other: "Другое",
};

/** Живая статья «Метки и ссылки»: активные метки по каналам с короткими ссылками. */
export function kbLinksBody(codes: ReadonlyArray<{ code: string; label: string; channel: string | null }>, origin: string): string {
  if (codes.length === 0) return "Активных меток пока нет.";
  const byChannel = new Map<string, typeof codes[number][]>();
  for (const c of codes) {
    const key = c.channel ?? "other";
    byChannel.set(key, [...(byChannel.get(key) ?? []), c]);
  }
  const order = ["instagram", "telegram", "vk", "offline", "partner", "other"];
  const blocks: string[] = [];
  for (const channel of [...byChannel.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
    const lines = byChannel.get(channel)!.map(
      (c) => `<code>${escapeHtml(c.code)}</code> — ${escapeHtml(c.label)}\n${escapeHtml(`${origin}/s/${c.code}`)}`,
    );
    blocks.push([`<b>${CHANNEL_LABEL[channel] ?? escapeHtml(channel)}</b>`, ...lines].join("\n"));
  }
  blocks.push("Ставь короткую ссылку вместо прямой, иначе переход не посчитается.");
  return blocks.join("\n\n");
}

/** Живая статья «Кто в боте»: участники по зонам — имя и ник. */
export function kbMembersBody(members: ReadonlyArray<{ name: string; username: string | null; zone: Zone }>): string {
  const blocks: string[] = [];
  for (const zone of ZONES) {
    const list = members.filter((m) => m.zone === zone);
    if (list.length === 0) continue;
    const lines = list.map((m) => {
      const nick = m.username && m.name !== `@${m.username}` ? ` @${escapeHtml(m.username)}` : "";
      return `${escapeHtml(m.name)}${nick}`;
    });
    blocks.push([`<b>${ZONE_LABEL[zone]}</b>`, ...lines].join("\n"));
  }
  return blocks.length ? blocks.join("\n\n") : "В боте пока никого нет.";
}
