import { InlineKeyboard } from "grammy";
import type { ClubSurvey } from "../clubs/survey-config";
import type { SurveyResponseRow, SurveyResultRow } from "../clubs/survey-store";
import {
  WEEKDAY_ORDER,
  timeGroups,
  type OutKind,
  type ParticipantAction,
} from "../clubs/survey-flow";
import { groupTime, type DayGroup, type GroupTime, type SurveySummary, type SummaryRow } from "../clubs/survey-slots";
import { broadcastReportText } from "./broadcast-copy";

/**
 * Опрос клуба в боте мероприятий: тексты, кнопки, callback_data.
 *
 * Тексты участнику — ДОСЛОВНО из docs/club-survey.md («Тексты участнику»),
 * подстановки только из конфига опроса и ответов. Править их можно только
 * вместе со спецификацией и с согласия владельца текстов; тест-страж
 * глоссария проходит по каждому (club-survey-copy.test.ts).
 *
 * Служебные реплики организатору — в стиле остальных служебных реплик бота
 * (broadcast-copy, invite-copy), глоссарий участника на них не распространяется.
 */

// ── Подписи кнопок участника ──────────────────────────────────────────────────

export const BUTTONS = {
  interested: "Интересно",
  skip: "Пока пропущу",
  consent: "Даю согласие",
  watchChat: "Посмотрю итог в чате",
  come: "Приду",
  later: "Присоединюсь позже",
  done: "Готово",
  skipDays: "Пропустить",
  anyTime: "Подойдёт любое время",
  edit: "Изменить ответ",
  continue: "Продолжить",
  willCome: "Буду",
  plansChanged: "Планы поменялись",
  skipThisTime: "В этот раз пропущу",
} as const;

/** Префикс отмеченного переключателя. */
export const CHECK = "✓ ";

/** Короткие дни недели по JS getDay: Вс=0…Сб=6. */
export const WEEKDAY_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"] as const;

// ── callback_data ─────────────────────────────────────────────────────────────

/** Действия организатора под предпросмотрами. */
export type AdminAction =
  | { type: "send"; go: boolean }
  | { type: "test" }
  | { type: "approve" }
  | { type: "rework" }
  | { type: "result_send"; resultId: number }
  | { type: "result_cancel" };

export type SurveyCallbackAction = ParticipantAction | AdminAction;

const ADMIN_ACTION_TYPES: ReadonlySet<string> = new Set<AdminAction["type"]>([
  "send",
  "test",
  "approve",
  "rework",
  "result_send",
  "result_cancel",
]);

/** Кнопка организатора — её разбирает club-survey-admin, а не сценарий участника. */
export function isAdminAction(action: SurveyCallbackAction): action is AdminAction {
  return ADMIN_ACTION_TYPES.has(action.type);
}

/**
 * `cs_<ключ опроса>_<действие>[_<аргумент>]`, только ASCII. Самая длинная —
 * `cs_<ключ до 12>_rg_<id до 10 цифр>`: 29 байт из 64.
 */
export const CLUB_SURVEY_CALLBACK_RE =
  /^cs_([a-z0-9]{1,12})_(iy|in|cy|cn|ay|al|dok|wok|wsk|ta|ed|go|sg|sn|st|ap|rw|rx|d_\d|w_[0-6]|r[yng]_\d{1,10})$/;

const SIMPLE_CODES: ReadonlyArray<[string, SurveyCallbackAction]> = [
  ["iy", { type: "interest", yes: true }],
  ["in", { type: "interest", yes: false }],
  ["cy", { type: "consent", yes: true }],
  ["cn", { type: "consent", yes: false }],
  ["ay", { type: "attend", come: true }],
  ["al", { type: "attend", come: false }],
  ["dok", { type: "days_done" }],
  ["wok", { type: "weekdays_done" }],
  ["wsk", { type: "weekdays_skip" }],
  ["ta", { type: "any_time" }],
  ["ed", { type: "edit" }],
  ["go", { type: "continue" }],
  ["sg", { type: "send", go: true }],
  ["sn", { type: "send", go: false }],
  ["st", { type: "test" }],
  ["ap", { type: "approve" }],
  ["rw", { type: "rework" }],
  ["rx", { type: "result_cancel" }],
];

function actionCode(action: SurveyCallbackAction): string {
  switch (action.type) {
    case "day":
      return `d_${action.index}`;
    case "weekday":
      return `w_${action.day}`;
    case "result":
      return `${action.yes ? "ry" : "rn"}_${action.resultId}`;
    case "result_send":
      return `rg_${action.resultId}`;
    default: {
      const found = SIMPLE_CODES.find(([, a]) => JSON.stringify(a) === JSON.stringify(action));
      if (!found) throw new Error(`unknown survey action ${action.type}`);
      return found[0];
    }
  }
}

export function buildSurveyCallback(key: string, action: SurveyCallbackAction): string {
  return `cs_${key}_${actionCode(action)}`;
}

export function parseSurveyCallback(data: string): { key: string; action: SurveyCallbackAction } | null {
  const m = CLUB_SURVEY_CALLBACK_RE.exec(data);
  if (!m) return null;
  const [, key, code] = m;

  const simple = SIMPLE_CODES.find(([c]) => c === code);
  if (simple) return { key, action: simple[1] };

  const [kind, arg] = code.split("_");
  const n = Number(arg);
  if (kind === "d") return { key, action: { type: "day", index: n } };
  if (kind === "w") return { key, action: { type: "weekday", day: n } };
  if (kind === "ry" || kind === "rn") return { key, action: { type: "result", resultId: n, yes: kind === "ry" } };
  if (kind === "rg") return { key, action: { type: "result_send", resultId: n } };
  return null;
}

// ── Подстановки ───────────────────────────────────────────────────────────────

/** «чт 29.10», «чт 29.10 и сб 31.10», «ср 28.10, чт 29.10 и сб 31.10». */
export function joinRu(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} и ${items[items.length - 1]}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Точка в конце места или «что взять» задвоила бы точку в тексте. */
function tidy(s: string): string {
  return s.trim().replace(/[.\s]+$/, "");
}

function dayLabel(survey: ClubSurvey, date: string): string {
  return survey.days.find((d) => d.date === date)?.label ?? date;
}

/** Выбранные дни строки: «чт 29.10 и сб 31.10». */
export function chosenDaysPhrase(survey: ClubSurvey, row: Pick<SurveyResponseRow, "days">): string {
  return joinRu(row.days.map((d) => dayLabel(survey, d).toLowerCase()));
}

/** Дни группы для вопросов 5б и 5в: «чт, пт». */
export function groupDaysList(
  survey: ClubSurvey,
  row: Pick<SurveyResponseRow, "attend" | "days" | "weekdays">,
  group: DayGroup,
): string {
  if (row.attend === "later") {
    return WEEKDAY_ORDER.filter((d) => row.weekdays.includes(d))
      .filter((d) => (group === "we") === (d === 0 || d === 6))
      .map((d) => WEEKDAY_SHORT[d].toLowerCase())
      .join(", ");
  }
  return row.days
    .filter((date) => {
      const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
      return (group === "we") === (wd === 0 || wd === 6);
    })
    .map((date) => dayLabel(survey, date).split(" ")[0].toLowerCase())
    .join(", ");
}

function timePhrase(t: GroupTime): string {
  if (t.kind === "range") return `с ${t.from} до ${t.to}`;
  if (t.kind === "any") return "в любое время";
  if (t.kind === "raw") return `время: «${t.raw}»`;
  return "";
}

/** Время для текста 6: один промежуток или «в будни …, в выходные …». */
export function chosenTimePhrase(row: SurveyResponseRow): string {
  const groups = timeGroups(row);
  if (groups.length === 1) return timePhrase(groupTime(row, groups[0]));
  return [`в будни ${timePhrase(groupTime(row, "wd"))}`, `в выходные ${timePhrase(groupTime(row, "we"))}`].join(", ");
}

const WEEKDAY_ACCUSATIVE = [
  "в воскресенье",
  "в понедельник",
  "во вторник",
  "в среду",
  "в четверг",
  "в пятницу",
  "в субботу",
];
const MONTH_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

/** «в четверг, 29 октября» — для текстов 8 и 9. */
export function meetDayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAY_ACCUSATIVE[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH_GENITIVE[d.getUTCMonth()]}`;
}

// ── Тексты участнику (дословно из спецификации) ───────────────────────────────

export const TEXT = {
  interest:
    "Привет! Это команда NIKA. Мы бегали вместе на кофе-ранах, а теперь зовём на коврик: открываем клуб йоги.\n\n" +
    "Здесь можно замедлиться. Спокойное занятие с нашим инструктором, рядом знакомые лица с пробежек. " +
    "Подойдёт для любого уровня.\n\n" +
    "Тебе интересно?",
  skipped:
    "Спасибо за ответ! Если передумаешь, нажми кнопку ниже. " +
    "Анонсы кофе-ранов и других клубов NIKA выходят в чате.",
  consent: (url: string) =>
    "Здорово! Чтобы сохранить твои ответы и прислать дату, время и место, нужно твоё согласие " +
    `на обработку персональных данных и сообщения от NIKA: ${url}`,
  declined: (s: ClubSurvey) => `Договорились! Итог опубликуем в чате кофе-ранов ${s.resultLabel}.`,
  attend: (s: ClubSurvey) =>
    `Первая встреча пройдёт на неделе ${s.weekLabel}. Получится прийти в один из этих дней?`,
  days: "Отметь все дни, которые подходят, и нажми «Готово».",
  daysEmpty: "Отметь хотя бы один день. Если эта неделя занята, нажми «Присоединюсь позже».",
  time: "Во сколько тебе удобно? Напиши, с какого и до какого часа. Например: с 19 до 21 или с 18:30 до 21:00.",
  timeWeekdays: (days: string) =>
    `Во сколько удобно в будни (${days})? Напиши, с какого и до какого часа. Например: с 19 до 21.`,
  timeWeekend: (days: string) => `А в выходные (${days})? Например: с 11 до 14.`,
  timeRetry: "Напиши, пожалуйста, начало и конец. Например: с 19 до 21.",
  timeShort: "Нужен промежуток хотя бы в час, чтобы занятие поместилось. Например: с 19 до 21.",
  timeSaved: "Спасибо, сохранили твой ответ. Идём дальше.",
  done: (s: ClubSurvey, days: string, time: string) =>
    `Записали: ${days}, ${time}. ${capitalize(s.resultLabel)}, пришлём дату, время и место.\n\n` +
    "Приходи один, уйдёшь с компанией.",
  later:
    "Поняли! Клуб будет встречаться регулярно. Подскажи, какие дни недели тебе обычно удобны, " +
    "и подберём время следующих встреч.",
  laterDone: "Спасибо! Позовём на следующие встречи, а детали первой тоже пришлём: вдруг планы поменяются.",
  reminder: (s: ClubSurvey) =>
    `Осталось выбрать день и время для клуба йоги, это займёт минуту. Голосуем ${s.voteDeadlineLabel}.`,
  resultMatch: (r: Pick<SurveyResultRow, "meet_date" | "meet_time" | "place" | "bring">) =>
    `Встречаемся ${meetDayLabel(r.meet_date)}, в ${r.meet_time}. Место: ${tidy(r.place)}.` +
    (r.bring ? ` С собой: ${tidy(r.bring)}.` : "") +
    " Будешь?",
  resultNoMatch: (r: Pick<SurveyResultRow, "meet_date" | "meet_time" | "place">) =>
    `Первая встреча клуба йоги: ${meetDayLabel(r.meet_date)}, в ${r.meet_time}, ${tidy(r.place)}. ` +
    "Если получится, приходи! Следующие встречи поставим с учётом твоих ответов.",
  resultYes: "Ждём тебя! Накануне напомним.",
  resultNo: "Поняли, спасибо! Позовём на следующую встречу.",
  eve: (r: Pick<SurveyResultRow, "meet_time" | "place">) =>
    `Завтра в ${r.meet_time} встречаемся на йоге: ${tidy(r.place)}. До встречи!`,
} as const;

// ── Клавиатуры участника ──────────────────────────────────────────────────────

const cb = buildSurveyCallback;

function single(key: string, label: string, action: ParticipantAction): InlineKeyboard {
  return new InlineKeyboard().text(label, cb(key, action));
}

export function daysKeyboard(survey: ClubSurvey, chosen: readonly string[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  survey.days.forEach((day, index) => {
    if (index > 0 && index % 3 === 0) kb.row();
    const label = chosen.includes(day.date) ? `${CHECK}${day.label}` : day.label;
    kb.text(label, cb(survey.key, { type: "day", index }));
  });
  return kb.row().text(BUTTONS.done, cb(survey.key, { type: "days_done" }));
}

export function weekdaysKeyboard(survey: ClubSurvey, chosen: readonly number[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  WEEKDAY_ORDER.forEach((day, i) => {
    if (i === 4) kb.row();
    const label = chosen.includes(day) ? `${CHECK}${WEEKDAY_SHORT[day]}` : WEEKDAY_SHORT[day];
    kb.text(label, cb(survey.key, { type: "weekday", day }));
  });
  return kb
    .row()
    .text(BUTTONS.done, cb(survey.key, { type: "weekdays_done" }))
    .text(BUTTONS.skipDays, cb(survey.key, { type: "weekdays_skip" }));
}

export function editKeyboard(key: string): InlineKeyboard {
  return single(key, BUTTONS.edit, { type: "edit" });
}

export function reminderKeyboard(key: string): InlineKeyboard {
  return single(key, BUTTONS.continue, { type: "continue" });
}

export function resultKeyboard(key: string, resultId: number, variant: "match" | "nomatch"): InlineKeyboard {
  const [yes, no] =
    variant === "match" ? [BUTTONS.willCome, BUTTONS.plansChanged] : [BUTTONS.come, BUTTONS.skipThisTime];
  return new InlineKeyboard()
    .text(yes, cb(key, { type: "result", resultId, yes: true }))
    .text(no, cb(key, { type: "result", resultId, yes: false }));
}

export interface SurveyMessage {
  text: string;
  keyboard?: InlineKeyboard;
}

/** Текст вопроса о времени по time_q строки: 5, 5б или 5в. */
function timeQuestionText(survey: ClubSurvey, row: SurveyResponseRow): string {
  if (row.time_q === "wd") return TEXT.timeWeekdays(groupDaysList(survey, row, "wd"));
  if (row.time_q === "we") return TEXT.timeWeekend(groupDaysList(survey, row, "we"));
  return TEXT.time;
}

/**
 * Сообщение участнику по виду из survey-flow. Строка — ПОСЛЕ патча шага.
 * Для result_repeat и fallback текста здесь нет: их собирает хендлер.
 */
export function participantMessage(
  kind: OutKind,
  survey: ClubSurvey,
  row: SurveyResponseRow,
  consentUrl: string,
): SurveyMessage | null {
  const key = survey.key;
  switch (kind) {
    case "interest":
      return startMessage(survey);
    case "skipped":
      return { text: TEXT.skipped, keyboard: editKeyboard(key) };
    case "consent":
      return {
        text: TEXT.consent(consentUrl),
        keyboard: new InlineKeyboard()
          .text(BUTTONS.consent, cb(key, { type: "consent", yes: true }))
          .row()
          .text(BUTTONS.watchChat, cb(key, { type: "consent", yes: false })),
      };
    case "declined":
      return { text: TEXT.declined(survey) };
    case "attend":
      return {
        text: TEXT.attend(survey),
        keyboard: new InlineKeyboard()
          .text(BUTTONS.come, cb(key, { type: "attend", come: true }))
          .text(BUTTONS.later, cb(key, { type: "attend", come: false })),
      };
    case "days":
      return { text: TEXT.days, keyboard: daysKeyboard(survey, row.days) };
    case "days_empty":
      return { text: TEXT.daysEmpty, keyboard: single(key, BUTTONS.later, { type: "attend", come: false }) };
    case "later":
      return { text: TEXT.later, keyboard: weekdaysKeyboard(survey, row.weekdays) };
    case "time":
      return { text: timeQuestionText(survey, row), keyboard: single(key, BUTTONS.anyTime, { type: "any_time" }) };
    case "time_retry":
      return { text: TEXT.timeRetry };
    case "time_short":
      return { text: TEXT.timeShort };
    case "time_saved":
      return { text: TEXT.timeSaved };
    case "done":
      return {
        text: TEXT.done(survey, chosenDaysPhrase(survey, row), chosenTimePhrase(row)),
        keyboard: editKeyboard(key),
      };
    case "later_done":
      return { text: TEXT.laterDone, keyboard: editKeyboard(key) };
    case "result_yes":
      return { text: TEXT.resultYes };
    case "result_no":
      return { text: TEXT.resultNo };
    default:
      return null;
  }
}

/** Стартовое сообщение рассылки /surveysend — текст 1 с кнопками. */
export function startMessage(survey: ClubSurvey): SurveyMessage {
  return {
    text: TEXT.interest,
    keyboard: new InlineKeyboard()
      .text(BUTTONS.interested, cb(survey.key, { type: "interest", yes: true }))
      .text(BUTTONS.skip, cb(survey.key, { type: "interest", yes: false })),
  };
}

/** Напоминание незавершившим — текст 7 и [Продолжить]. */
export function reminderMessage(survey: ClubSurvey): SurveyMessage {
  return { text: TEXT.reminder(survey), keyboard: reminderKeyboard(survey.key) };
}

/** Итог человеку: текст 8 («совпал») или 9 («не совпал») с кнопками. */
export function resultMessage(survey: ClubSurvey, result: SurveyResultRow, variant: "match" | "nomatch"): SurveyMessage {
  return {
    text: variant === "match" ? TEXT.resultMatch(result) : TEXT.resultNoMatch(result),
    keyboard: resultKeyboard(survey.key, result.id, variant),
  };
}

// ── Организатору ──────────────────────────────────────────────────────────────

function personLabel(row: Pick<SummaryRow, "name" | "username">): string {
  if (row.name && row.username) return `${row.name} (@${row.username})`;
  if (row.username) return `@${row.username}`;
  return row.name ?? "участник";
}

function adminGroupTime(t: GroupTime): string {
  if (t.kind === "range") return `${t.from}–${t.to}`;
  if (t.kind === "any") return "любое время";
  if (t.kind === "raw") return `«${t.raw}» (текстом)`;
  return "—";
}

/** «будни 19:00–21:00, выходные любое время» — для ленты и сводки. */
function adminTimes(row: SurveyResponseRow | SummaryRow): string {
  const groups = timeGroups(row);
  return groups
    .map((g) => `${g === "wd" ? "будни" : "выходные"} ${adminGroupTime(groupTime(row, g))}`)
    .join(", ");
}

function adminDays(survey: ClubSurvey, row: SurveyResponseRow | SummaryRow): string {
  if (row.attend === "later") {
    return WEEKDAY_ORDER.filter((d) => row.weekdays.includes(d))
      .map((d) => WEEKDAY_SHORT[d].toLowerCase())
      .join(", ");
  }
  return row.days.map((d) => dayLabel(survey, d).toLowerCase()).join(", ");
}

/** Строка ленты, когда человек закончил опрос. */
export function surveyFeedLine(
  survey: ClubSurvey,
  row: SurveyResponseRow,
  totals: { coming: number; later: number },
): string {
  const who = personLabel(row);
  const tail = `Итого: придут ${totals.coming}, позже ${totals.later}.`;
  if (row.step === "later_done") {
    const days = adminDays(survey, row);
    const detail = days ? `: ${days}; ${adminTimes(row)}` : " (дни не выбрал)";
    return `${who} — присоединится позже${detail}. ${tail}`;
  }
  return `${who} — придёт: ${adminDays(survey, row)}; ${adminTimes(row)}. ${tail}`;
}

/** Строка ленты, когда человек ответил на итог. */
export function resultAnswerFeedLine(row: SurveyResponseRow, yes: boolean, totalYes: number): string {
  return `${personLabel(row)} — на итог: ${yes ? "придёт" : "не придёт"}. Всего идут: ${totalYes}.`;
}

/** Сводка /survey. */
export function surveySummaryText(survey: ClubSurvey, s: SurveySummary, link: string | null): string {
  const lines = [
    `Опрос «${survey.key}», неделя ${survey.weekLabel}.`,
    "",
    `Спросили: ${s.asked} (рассылкой ${s.byBroadcast}, по ссылке ${s.byLink}).`,
    `Интересно: ${s.interested}. Пропустят: ${s.skipped}. Без согласия: ${s.declined}.`,
    `Придут: ${s.coming}. Присоединятся позже: ${s.later}. В процессе: ${s.inProgress}. ` +
      `Молчат: ${s.silent}.` +
      (s.blocked ? ` Заблокировали бота: ${s.blocked}.` : ""),
    "",
    "По дням (из тех, кто придёт):",
    ...s.perDay.map((d) => `${dayLabel(survey, d.date).toLowerCase()} — ${d.count}`),
  ];

  lines.push("", "Лучшие слоты:");
  if (s.slots.length === 0) lines.push("пока нет — нужен хотя бы один ответ с промежутком");
  s.slots.forEach((slot, i) =>
    lines.push(`${i + 1}. ${dayLabel(survey, slot.date).toLowerCase()}, ${slot.start} — ${slot.count} чел.`),
  );

  if (s.comingList.length) {
    lines.push("", `Придут (${s.comingList.length}):`);
    lines.push(
      ...capList(s.comingList.map((row) => `• ${personLabel(row)}: ${adminDays(survey, row)}; ${adminTimes(row)}`)),
    );
  }

  if (s.rawAnswers.length) {
    lines.push("", `Ответы о времени текстом (${s.rawAnswers.length}):`);
    lines.push(
      ...capList(
        s.rawAnswers.map((a) => `• ${personLabel(a.row)}, ${a.group === "wd" ? "будни" : "выходные"}: «${clip(a.raw)}»`),
      ),
    );
  }

  lines.push("", link ? `Ссылка для поста в чат: ${link}` : "Ссылку для поста не собрать: не задан NEXT_PUBLIC_TELEGRAM_BOT_USERNAME.");
  return fitTelegram(lines.join("\n"));
}

/** Сколько строк списка показываем в сводке — как nameList в poll-copy. */
export const SUMMARY_LIST_LIMIT = 40;

/** Telegram режет сообщения длиннее 4096 символов — держим запас. */
const TELEGRAM_TEXT_MAX = 4000;

function capList(items: string[], limit = SUMMARY_LIST_LIMIT): string[] {
  if (items.length <= limit) return items;
  return [...items.slice(0, limit), `… и ещё ${items.length - limit}`];
}

/** Ответ текстом в сводке — до 80 символов: длинный абзац забил бы весь список. */
function clip(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function fitTelegram(text: string): string {
  if (text.length <= TELEGRAM_TEXT_MAX) return text;
  return `${text.slice(0, TELEGRAM_TEXT_MAX - 40)}\n… сводка обрезана: не влезла в сообщение`;
}

/** Предпросмотр /surveysend: числа и дословный текст. */
export function surveySendPreviewText(
  counts: { wouldSend: number; alumni: number; optedOut: number; alreadyAsked: number; hasMore: boolean },
  firstMessage: string,
): string {
  const lines = [
    `Стартовое сообщение опроса уйдёт ${counts.wouldSend} чел. — из ${counts.alumni}, кто хоть раз подтверждал участие в забеге.`,
  ];
  const skipped: string[] = [];
  if (counts.alreadyAsked) skipped.push(`уже спрошены (в том числе по ссылке): ${counts.alreadyAsked}`);
  if (counts.optedOut) skipped.push(`просили не писать: ${counts.optedOut}`);
  if (skipped.length) lines.push(`Пропускаю — ${skipped.join("; ")}.`);
  if (counts.hasMore) lines.push("Это первая порция: остальным — кнопкой «Дослать остальным» под отчётом.");
  lines.push("", "Текст:", "", firstMessage, "", "Отозвать его после отправки нельзя. Отправляем?");
  return lines.join("\n");
}

export function surveySendConfirmKeyboard(key: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Тест — прислать мне", cb(key, { type: "test" }))
    .row()
    .text("Разослать всем", cb(key, { type: "send", go: true }))
    .row()
    .text("Отмена", cb(key, { type: "send", go: false }));
}

export function surveySendRetryKeyboard(key: string): InlineKeyboard {
  return new InlineKeyboard().text("Дослать остальным", cb(key, { type: "send", go: true }));
}

// ── Тестовый прогон стартовой рассылки ────────────────────────────────────────

export const SURVEY_TEST_INTRO =
  "Тестовый прогон: присылаю опрос только тебе — следующим сообщением, так же, как его увидят участники. " +
  "Пройди до конца — пришлю кнопки «Апрув» и «На доработку». Больше никому ничего не отправляю.";

export const SURVEY_TEST_VERDICT =
  "Тест пройден. Апрув — разошлю стартовое сообщение всем, кто бегал (как в предпросмотре /surveysend). " +
  "На доработку — никому не отправляю. В обоих случаях твои тестовые ответы сотру.";

export const SURVEY_TEST_REWORK =
  "Никому не отправила, тестовые ответы стёрла. Дорабатываем — когда будет готово, снова /surveysend.";

export function surveyTestVerdictKeyboard(key: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Апрув — разослать всем", cb(key, { type: "approve" }))
    .row()
    .text("На доработку", cb(key, { type: "rework" }));
}

/** Итог рассылки (стартовой или итога) — та же формулировка, что у /say. */
export const surveyReportText = broadcastReportText;

/** Подсказка к /surveyresult. */
export const SURVEY_RESULT_USAGE =
  "Формат: /surveyresult ГГГГ-ММ-ДД ЧЧ:ММ место | что взять\n" +
  "Например: /surveyresult 2026-10-29 19:30 Студия «Прана», Тверская, 1 | удобную одежду и воду\n" +
  "«Что взять» — необязательно, вместе с чертой.";

/** Длина места и «что взять» — как check в migrations/063. */
export const RESULT_FIELD_MAX = 300;

export interface ResultArgs {
  meetDate: string;
  meetTime: string;
  place: string;
  bring: string | null;
}

/** Разбор аргументов /surveyresult; null — формат не узнан. */
export function parseSurveyResultArgs(raw: string): ResultArgs | null {
  const m = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})\s+([\s\S]+)$/.exec(raw.trim());
  if (!m) return null;
  const [, date, hh, mm, rest] = m;

  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return null;
  if (Number(hh) > 23 || Number(mm) > 59) return null;

  const bar = rest.indexOf("|");
  const place = (bar === -1 ? rest : rest.slice(0, bar)).trim();
  const bring = bar === -1 ? "" : rest.slice(bar + 1).trim();
  if (!place || place.length > RESULT_FIELD_MAX || bring.length > RESULT_FIELD_MAX) return null;

  return { meetDate: date, meetTime: `${hh.padStart(2, "0")}:${mm}`, place, bring: bring || null };
}

export type ResultCommand =
  | { ok: true; args: ResultArgs }
  | { ok: false; reason: "format" | "date" };

/** /surveyresult целиком: формат и дата из дней-кандидатов опроса. */
export function parseSurveyResultCommand(survey: ClubSurvey, raw: string): ResultCommand {
  const args = parseSurveyResultArgs(raw);
  if (!args) return { ok: false, reason: "format" };
  if (!survey.days.some((d) => d.date === args.meetDate)) return { ok: false, reason: "date" };
  return { ok: true, args };
}

/** Ответ организатору на неверный /surveyresult. */
export function surveyResultErrorText(survey: ClubSurvey, reason: "format" | "date"): string {
  if (reason === "date") {
    return (
      `Эта дата не из дней опроса. Можно: ${survey.days.map((d) => d.date).join(", ")}.\n\n` +
      SURVEY_RESULT_USAGE
    );
  }
  return `Не разобрала команду.\n\n${SURVEY_RESULT_USAGE}`;
}

/** Предпросмотр итога: оба варианта, числа и — если итог уже рассылали — предупреждение. */
export function resultPreviewText(
  result: SurveyResultRow,
  counts: { match: number; nomatch: number },
  previous: { result: SurveyResultRow; received: number } | null,
): string {
  const when = `${meetDayLabel(result.meet_date)}, в ${result.meet_time}`;
  const lines = [
    `Итог: ${when}. Место: ${tidy(result.place)}.` + (result.bring ? ` С собой: ${tidy(result.bring)}.` : ""),
    `Получат ${counts.match + counts.nomatch} чел. с согласием: ` +
      `совпали день и время — ${counts.match} (вариант 1), остальные — ${counts.nomatch} (вариант 2).`,
  ];

  if (previous) {
    const prev = `${meetDayLabel(previous.result.meet_date)}, в ${previous.result.meet_time}, ${tidy(previous.result.place)}`;
    lines.push(
      "",
      `Внимание: итог уже рассылали (${prev}) — его получили ${previous.received} чел. ` +
        "Новый уйдёт им заново отдельным сообщением, старые кнопки перестанут работать, " +
        "ответы «Буду»/«Приду» сбросятся, а напоминание накануне получат только ответившие заново.",
    );
  }

  lines.push(
    "",
    "— Вариант 1:",
    TEXT.resultMatch(result),
    "",
    "— Вариант 2:",
    TEXT.resultNoMatch(result),
    "",
    "Отозвать после отправки нельзя. Отправляем?",
  );
  return lines.join("\n");
}

export function resultConfirmKeyboard(key: string, resultId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("Разослать", cb(key, { type: "result_send", resultId }))
    .row()
    .text("Отмена", cb(key, { type: "result_cancel" }));
}

export function resultRetryKeyboard(key: string, resultId: number): InlineKeyboard {
  return new InlineKeyboard().text("Дослать остальным", cb(key, { type: "result_send", resultId }));
}
