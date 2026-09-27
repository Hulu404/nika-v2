import { cb } from "./callback";
import { escapeHtml } from "./html";
import { formatMskTime } from "./format";
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
};

/** Описание команды раздела в меню Telegram. */
export const SECTION_COMMAND_DESCRIPTION: Record<Section, string> = {
  run: "Забеги: заявки и динамика",
  tr: "Соцсети и метки",
  pro: "Про и оплаты",
  prd: "Продукт",
  kb: "Справочник команды",
  tm: "Команда: кто в боте",
};

export const HELP_COMMAND_DESCRIPTION = "Что я умею";

/**
 * Меню команд по умолчанию — для всех, кто открыл бота. Разделы зоны ставятся
 * человеку отдельно, со scope chat.
 */
export const DATABOT_DEFAULT_COMMANDS = [{ command: "help", description: HELP_COMMAND_DESCRIPTION }] as const;

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
