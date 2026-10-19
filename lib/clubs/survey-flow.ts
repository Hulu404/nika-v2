import type { ClubSurvey } from "./survey-config";
import {
  ANSWERS_RESET,
  type SurveyResponsePatch,
  type SurveyResponseRow,
  type SurveyStep,
  type TimeQuestion,
} from "./survey-store";
import {
  WEEK_ORDER,
  chosenWeekdays,
  groupsOfDays,
  groupsOfWeekdays,
  uncoveredWeekdays,
  weekdayGroup,
  type DayGroup,
} from "./survey-slots";
import { parseDayTimes, type DayTime } from "./day-times";

/**
 * Переходы опроса — таблица из плана, целиком здесь. Чистая функция:
 * (строка, событие, контекст) → что записать, что отправить, какие кнопки снять.
 *
 * Сообщения описаны видом (OutKind), а не текстом: текст собирает
 * lib/telegram/club-survey-copy.ts по строке ПОСЛЕ патча. Так flow не знает
 * формулировок, а копирайт не знает переходов.
 *
 * Актуальность кнопки решается шагом: действие допустимо на текущем шаге —
 * выполняем, иначе это кнопка из прошлого (ignored), её «часики» гасит хендлер.
 */

/** Действие участника из callback_data (админские и итоговые — отдельно). */
export type ParticipantAction =
  | { type: "interest"; yes: boolean }
  | { type: "consent"; yes: boolean }
  | { type: "attend"; come: boolean }
  | { type: "day"; index: number }
  | { type: "days_done" }
  | { type: "weekday"; day: number }
  | { type: "weekdays_done" }
  | { type: "weekdays_skip" }
  | { type: "any_time" }
  | { type: "edit" }
  | { type: "continue" }
  | { type: "result"; resultId: number; yes: boolean };

export type FlowEvent =
  | { type: "start" }
  | { type: "action"; action: ParticipantAction }
  | { type: "text"; text: string };

/**
 * Что отправить. Тексты:
 *   interest 1, skipped 1а, consent 2, declined 2а, attend 3, days 4,
 *   days_empty 4а, time 5/5б/5в (по time_q; про оставшиеся дни — «А в пт?»),
 *   time_retry 5г, time_short 5д, time_saved 5е, time_other_days 5ж, done 6, later 3а, later_done 3б, result_yes 10, result_no 11.
 *   result_repeat — хендлер повторяет человеку его вариант итога (8 или 9);
 *   fallback — общий ответ бота: по опросу сказать нечего.
 */
export type OutKind =
  | "interest"
  | "skipped"
  | "consent"
  | "declined"
  | "attend"
  | "days"
  | "days_empty"
  | "later"
  | "time"
  | "time_retry"
  | "time_short"
  | "time_saved"
  | "time_other_days"
  | "done"
  | "later_done"
  | "result_yes"
  | "result_no"
  | "result_repeat"
  | "fallback";

/** Сообщения, у которых кнопки — главные на шаге: их id ложится в last_msg_id. */
export const PRIMARY_KINDS: ReadonlySet<OutKind> = new Set<OutKind>([
  "interest",
  "skipped",
  "consent",
  "attend",
  "days",
  "later",
  "time",
  "done",
  "later_done",
]);

export interface FlowOutcome {
  /** Строки ещё нет — хендлер заводит её (source = link) и только потом пишет патч. */
  create: boolean;
  patch: SurveyResponsePatch;
  send: OutKind[];
  /** Перерисовать переключатели в нажатом сообщении. */
  redraw: "days" | "weekdays" | null;
  /** Снять кнопки с нажатого сообщения. */
  stripPressed: boolean;
  /** Снять кнопки с сообщения last_msg_id. */
  stripLast: boolean;
  /** Строка в ленту организаторам. */
  feed: "finished" | "result_answer" | null;
  /** Кнопка из прошлого шага: ничего не меняли. */
  ignored: boolean;
}

export type FlowRow = Pick<
  SurveyResponseRow,
  | "step"
  | "consent_at"
  | "attend"
  | "days"
  | "weekdays"
  | "time_q"
  | "fail_count"
  | "result_id"
  | "wd_from"
  | "wd_to"
  | "wd_any"
  | "wd_raw"
  | "we_from"
  | "we_to"
  | "we_any"
  | "we_raw"
  | "day_times"
>;

export interface FlowContext {
  survey: ClubSurvey;
  now: Date;
  /** Итог уже разослан: «Изменить ответ» больше не работает. */
  resultSent: boolean;
  /** LEGAL_VERSION на момент согласия. */
  legalVersion: string;
  /** Как человек подписан в Telegram — пишем только вместе с согласием. */
  person: { name: string | null; username: string | null };
}

/** Сколько символов исходного ответа о времени храним. */
export const RAW_ANSWER_MAX = 500;

/** Неудачных попыток подряд, после которых сохраняем ответ текстом. */
export const TIME_ATTEMPTS = 2;

const FINISHED: ReadonlySet<SurveyStep> = new Set<SurveyStep>(["done", "later_done"]);

/** Сообщение, которое повторяем на шаге. */
const STEP_MESSAGE: Readonly<Record<SurveyStep, OutKind>> = {
  interest: "interest",
  skipped: "skipped",
  consent: "consent",
  declined: "declined",
  attend: "attend",
  days: "days",
  later: "later",
  time: "time",
  done: "done",
  later_done: "later_done",
};

function outcome(partial: Partial<FlowOutcome>): FlowOutcome {
  return {
    create: false,
    patch: {},
    send: [],
    redraw: null,
    stripPressed: false,
    stripLast: false,
    feed: null,
    ignored: false,
    ...partial,
  };
}

const IGNORED = outcome({ ignored: true });

/** Повторить сообщение текущего шага, сняв кнопки с прошлого. */
function repeatStep(row: FlowRow): FlowOutcome {
  return outcome({ send: [STEP_MESSAGE[row.step]], stripLast: true });
}

/** Группы, о которых спрашиваем время, по ветке человека. */
export function timeGroups(row: Pick<FlowRow, "attend" | "days" | "weekdays">): DayGroup[] {
  return row.attend === "later" ? groupsOfWeekdays(row.weekdays) : groupsOfDays(row.days);
}

/** Группа текущего вопроса о времени. */
export function currentGroup(row: Pick<FlowRow, "attend" | "days" | "weekdays" | "time_q">): DayGroup {
  if (row.time_q === "wd" || row.time_q === "we") return row.time_q;
  return timeGroups(row)[0] ?? "wd";
}

/** Первый вопрос о времени: один общий или «про будни», если групп две. */
function firstQuestion(groups: DayGroup[]): TimeQuestion {
  return groups.length === 2 ? "wd" : "all";
}

/**
 * Ответ на вопрос о времени записан — следующий вопрос или финиш. Следующий
 * вопрос — про первую по неделе группу, где у выбранных дней ещё нет времени:
 * человек мог одним сообщением ответить и про будни, и про выходные, а мог
 * назвать не все дни.
 */
function afterTimeAnswer(
  row: FlowRow,
  answer: SurveyResponsePatch,
  ctx: FlowContext,
  lead: OutKind[],
  strip: { stripPressed?: boolean; stripLast?: boolean },
): FlowOutcome {
  const next = { ...row, ...answer };
  const rest = uncoveredWeekdays(next);
  if (rest.length > 0) {
    const time_q: TimeQuestion = timeGroups(next).length === 2 ? weekdayGroup(rest[0]) : "all";
    return outcome({
      patch: { ...answer, time_q, fail_count: 0 },
      send: [...lead, "time"],
      ...strip,
    });
  }

  const step: SurveyStep = row.attend === "later" ? "later_done" : "done";
  return outcome({
    patch: { ...answer, step, time_q: null, fail_count: 0, finished_at: ctx.now.toISOString() },
    send: [...lead, step],
    feed: "finished",
    ...strip,
  });
}

function groupPatch(group: DayGroup, fields: { from: string | null; to: string | null; any: boolean; raw: string | null }): SurveyResponsePatch {
  return group === "wd"
    ? { wd_from: fields.from, wd_to: fields.to, wd_any: fields.any, wd_raw: fields.raw }
    : { we_from: fields.from, we_to: fields.to, we_any: fields.any, we_raw: fields.raw };
}

/** Ответ без дней — про всю текущую группу (её дни без своего времени). */
function groupAnswer(group: DayGroup, time: DayTime, raw: string): SurveyResponsePatch {
  return "any" in time
    ? groupPatch(group, { from: null, to: null, any: true, raw })
    : groupPatch(group, { from: time.from, to: time.to, any: false, raw });
}

function onTimeText(row: FlowRow, text: string, ctx: FlowContext): FlowOutcome {
  const raw = text.trim().slice(0, RAW_ANSWER_MAX);
  const group = currentGroup(row);
  const parsed = parseDayTimes(raw, {
    survey: ctx.survey,
    chosen: chosenWeekdays(row),
    uncovered: uncoveredWeekdays(row),
  });

  if (parsed.ok) {
    const answer =
      parsed.kind === "group"
        ? groupAnswer(group, parsed.time, raw)
        : { day_times: { ...row.day_times, ...parsed.times } };
    return afterTimeAnswer(row, answer, ctx, [], { stripLast: true });
  }

  const failures = row.fail_count + 1;
  if (failures >= TIME_ATTEMPTS) {
    const answer = groupPatch(group, { from: null, to: null, any: false, raw });
    return afterTimeAnswer(row, answer, ctx, ["time_saved"], { stripLast: true });
  }

  return outcome({
    patch: { fail_count: failures },
    send: [parsed.error === "short" ? "time_short" : parsed.error === "other_days" ? "time_other_days" : "time_retry"],
  });
}

function toggle<T>(list: readonly T[], item: T, order: readonly T[]): T[] {
  const next = list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
  return order.filter((x) => next.includes(x));
}

/** Порядок дней недели в кнопках и в списках: Пн…Вс (JS getDay). */
export const WEEKDAY_ORDER: readonly number[] = WEEK_ORDER;

function startTime(patch: SurveyResponsePatch, groups: DayGroup[]): FlowOutcome {
  return outcome({
    patch: { ...patch, step: "time", time_q: firstQuestion(groups), fail_count: 0 },
    send: ["time"],
    stripPressed: true,
  });
}

function finishLater(ctx: FlowContext): FlowOutcome {
  return outcome({
    patch: { step: "later_done", weekdays: [], finished_at: ctx.now.toISOString() },
    send: ["later_done"],
    stripPressed: true,
    feed: "finished",
  });
}

function onEdit(row: FlowRow, ctx: FlowContext): FlowOutcome {
  if (ctx.resultSent) return IGNORED;
  if (row.step !== "skipped" && !FINISHED.has(row.step)) return IGNORED;

  if (row.consent_at) {
    return outcome({ patch: { ...ANSWERS_RESET, step: "attend" }, send: ["attend"], stripPressed: true });
  }
  return outcome({ patch: { step: "interest" }, send: ["interest"], stripPressed: true });
}

function onResult(row: FlowRow, resultId: number, yes: boolean, ctx: FlowContext): FlowOutcome {
  if (!row.consent_at || row.result_id !== resultId) return IGNORED;
  return outcome({
    patch: { result_answer: yes ? "yes" : "no", result_answered_at: ctx.now.toISOString() },
    send: [yes ? "result_yes" : "result_no"],
    stripPressed: true,
    feed: "result_answer",
  });
}

function onAction(row: FlowRow, action: ParticipantAction, ctx: FlowContext): FlowOutcome {
  // Действуют на любом шаге — своими правилами.
  if (action.type === "edit") return onEdit(row, ctx);
  if (action.type === "result") return onResult(row, action.resultId, action.yes, ctx);
  if (action.type === "continue") return row.consent_at ? repeatStep(row) : IGNORED;

  switch (row.step) {
    case "interest":
      if (action.type !== "interest") return IGNORED;
      return action.yes
        ? outcome({ patch: { step: "consent" }, send: ["consent"], stripPressed: true })
        : outcome({ patch: { step: "skipped" }, send: ["skipped"], stripPressed: true });

    case "consent":
      if (action.type !== "consent") return IGNORED;
      if (!action.yes) return outcome({ patch: { step: "declined" }, send: ["declined"], stripPressed: true });
      return outcome({
        patch: {
          step: "attend",
          consent_at: ctx.now.toISOString(),
          consent_version: ctx.legalVersion,
          name: ctx.person.name,
          username: ctx.person.username,
        },
        send: ["attend"],
        stripPressed: true,
      });

    case "attend":
      if (action.type !== "attend") return IGNORED;
      return action.come
        ? outcome({ patch: { step: "days", attend: "come" }, send: ["days"], stripPressed: true })
        : outcome({ patch: { step: "later", attend: "later" }, send: ["later"], stripPressed: true });

    case "days":
      return onDaysAction(row, action, ctx);

    case "later":
      return onLaterAction(row, action, ctx);

    case "time":
      if (action.type !== "any_time") return IGNORED;
      return afterTimeAnswer(
        row,
        groupPatch(currentGroup(row), { from: null, to: null, any: true, raw: null }),
        ctx,
        [],
        { stripPressed: true },
      );

    default:
      return IGNORED;
  }
}

function onDaysAction(row: FlowRow, action: ParticipantAction, ctx: FlowContext): FlowOutcome {
  const order = ctx.survey.days.map((d) => d.date);

  if (action.type === "day") {
    const date = order[action.index];
    if (date === undefined) return IGNORED;
    return outcome({ patch: { days: toggle(row.days, date, order) }, redraw: "days" });
  }
  if (action.type === "days_done") {
    // Кнопки дней оставляем: человек отметит день в том же сообщении.
    if (row.days.length === 0) return outcome({ send: ["days_empty"] });
    return startTime({}, groupsOfDays(row.days));
  }
  // «Присоединюсь позже» из текста 4а: снимаем кнопки и с 4а, и с сообщения дней.
  if (action.type === "attend" && !action.come) {
    return outcome({
      patch: { step: "later", attend: "later", days: [] },
      send: ["later"],
      stripPressed: true,
      stripLast: true,
    });
  }
  return IGNORED;
}

function onLaterAction(row: FlowRow, action: ParticipantAction, ctx: FlowContext): FlowOutcome {
  if (action.type === "weekday") {
    if (!WEEKDAY_ORDER.includes(action.day)) return IGNORED;
    return outcome({ patch: { weekdays: toggle(row.weekdays, action.day, WEEKDAY_ORDER) }, redraw: "weekdays" });
  }
  if (action.type === "weekdays_skip") return finishLater(ctx);
  if (action.type === "weekdays_done") {
    // «Готово» без отметок читаем как «Пропустить».
    if (row.weekdays.length === 0) return finishLater(ctx);
    return startTime({}, groupsOfWeekdays(row.weekdays));
  }
  return IGNORED;
}

function onStart(row: FlowRow | null, ctx: FlowContext): FlowOutcome {
  if (!row) {
    // Новенький после итога: опрос закрыт, текста под этот случай пока нет.
    if (ctx.resultSent) return outcome({ send: ["fallback"] });
    return outcome({ create: true, patch: { step: "interest" }, send: ["interest"] });
  }

  if (ctx.resultSent) {
    return row.consent_at && row.result_id !== null
      ? outcome({ send: ["result_repeat"] })
      : outcome({ send: ["fallback"] });
  }

  if (row.step === "skipped" || row.step === "declined") {
    return outcome({ patch: { step: "interest" }, send: ["interest"], stripLast: true });
  }
  return repeatStep(row);
}

function onText(row: FlowRow, text: string, ctx: FlowContext): FlowOutcome {
  switch (row.step) {
    case "time":
      return onTimeText(row, text, ctx);
    case "interest":
    case "consent":
    case "attend":
    case "days":
    case "later":
      return repeatStep(row);
    case "done":
    case "later_done":
      return ctx.resultSent ? outcome({ send: ["fallback"] }) : outcome({ send: [row.step] });
    default:
      return outcome({ send: ["fallback"] });
  }
}

/**
 * Главная функция. row = null — строки нет (имеет смысл только для /start:
 * на кнопку и текст без строки хендлер отвечает сам).
 */
export function surveyStep(row: FlowRow | null, event: FlowEvent, ctx: FlowContext): FlowOutcome {
  if (event.type === "start") return onStart(row, ctx);
  if (!row) return event.type === "text" ? outcome({ send: ["fallback"] }) : IGNORED;
  if (event.type === "text") return onText(row, event.text, ctx);
  return onAction(row, event.action, ctx);
}
