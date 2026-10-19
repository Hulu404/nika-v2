import { tgAdmin } from "../telegram/supabase";

/**
 * Доступ к таблицам опросов клубов (migrations/063_club_surveys.sql).
 *
 * Только через tgAdmin(): клиент нетипизированный, как у остальных служебных
 * таблиц бота (coffee_run_signups, team_outbox), поэтому форма строк описана
 * здесь, а не в types/database.ts.
 *
 * Ошибки базы: логируем операцию и код ошибки, без chat_id, имён и ответов, и
 * БРОСАЕМ, как optedOutChats(). Молча продолжить без ответа базы нельзя ни
 * рассылке (задвоит сообщения или напишет не тем), ни хендлеру (потеряет шаг
 * человека). Что делать с исключением, решает вызывающий.
 */

const RESPONSES = "club_survey_responses";
const RESULTS = "club_survey_results";

export type SurveyStep =
  | "interest"
  | "skipped"
  | "consent"
  | "declined"
  | "attend"
  | "days"
  | "later"
  | "time"
  | "done"
  | "later_done";

/** Шаги, на которых человек закончил опрос. */
export const FINISHED_STEPS: readonly SurveyStep[] = ["done", "later_done"];

export type SurveySource = "broadcast" | "link";
export type SurveyAttend = "come" | "later";
/** Какой вопрос о времени задан: общий, про будни, про выходные. */
export type TimeQuestion = "all" | "wd" | "we";
export type ResultVariant = "match" | "nomatch";
export type ResultAnswer = "yes" | "no";

/** Строка club_survey_responses как её отдаёт PostgREST. */
export interface SurveyResponseRow {
  survey_key: string;
  chat_id: number;
  source: SurveySource;
  step: SurveyStep;
  last_msg_id: number | null;
  asked_at: string;
  blocked_at: string | null;
  name: string | null;
  username: string | null;
  consent_at: string | null;
  consent_version: string | null;
  attend: SurveyAttend | null;
  /** YYYY-MM-DD */
  days: string[];
  /** JS getDay: Вс=0…Сб=6 */
  weekdays: number[];
  time_q: TimeQuestion | null;
  wd_from: string | null;
  wd_to: string | null;
  wd_any: boolean;
  wd_raw: string | null;
  we_from: string | null;
  we_to: string | null;
  we_any: boolean;
  we_raw: string | null;
  fail_count: number;
  finished_at: string | null;
  reminded_at: string | null;
  result_id: number | null;
  result_variant: ResultVariant | null;
  result_msg_id: number | null;
  result_sent_at: string | null;
  result_answer: ResultAnswer | null;
  result_answered_at: string | null;
  eve_result_id: number | null;
  created_at: string;
  updated_at: string;
}

/** Что можно менять в строке ответа. Ключ и created_at неизменны. */
export type SurveyResponsePatch = Partial<
  Omit<SurveyResponseRow, "survey_key" | "chat_id" | "created_at" | "updated_at">
>;

/** Строка club_survey_results. */
export interface SurveyResultRow {
  id: number;
  survey_key: string;
  /** YYYY-MM-DD */
  meet_date: string;
  /** HH:MM, МСК */
  meet_time: string;
  place: string;
  bring: string | null;
  created_at: string;
  confirmed_at: string | null;
}

export interface SurveyResultDraft {
  meetDate: string;
  meetTime: string;
  place: string;
  bring: string | null;
}

/**
 * «Изменить ответ»: стираем ответы, согласие и имя оставляем. Отметки рассылок
 * (asked_at, reminded_at, blocked_at) тоже не трогаем: напоминание остаётся
 * одним на опрос.
 */
export const ANSWERS_RESET: Readonly<SurveyResponsePatch> = Object.freeze({
  attend: null,
  days: [],
  weekdays: [],
  time_q: null,
  wd_from: null,
  wd_to: null,
  wd_any: false,
  wd_raw: null,
  we_from: null,
  we_to: null,
  we_any: false,
  we_raw: null,
  fail_count: 0,
  finished_at: null,
});

interface DbError {
  code?: string;
  message: string;
}

/** Лог без персональных данных и исключение: продолжать без базы небезопасно. */
function dbFail(op: string, error: DbError): never {
  console.error(`[club-survey] ${op}:`, error.code ?? "", error.message);
  throw new Error("DB error");
}

function assertId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("bad result id");
}

const nowIso = () => new Date().toISOString();

// ── Строка ответа ─────────────────────────────────────────────────────────────

export async function getResponse(key: string, chatId: number): Promise<SurveyResponseRow | null> {
  const { data, error } = await tgAdmin()
    .from(RESPONSES)
    .select("*")
    .eq("survey_key", key)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (error) dbFail("get", error);
  return (data as SurveyResponseRow | null) ?? null;
}

/**
 * Завести строку при первом сообщении опроса. false — строка уже была
 * (человек пришёл по ссылке раньше рассылки или наоборот): существующую не трогаем.
 */
export async function createResponse(
  key: string,
  chatId: number,
  source: SurveySource,
  fields: Pick<SurveyResponsePatch, "last_msg_id" | "blocked_at"> = {},
): Promise<boolean> {
  const { data, error } = await tgAdmin()
    .from(RESPONSES)
    .upsert(
      { survey_key: key, chat_id: chatId, source, ...fields },
      { onConflict: "survey_key,chat_id", ignoreDuplicates: true },
    )
    .select("chat_id");
  if (error) dbFail("create", error);
  return ((data as unknown[] | null) ?? []).length > 0;
}

/**
 * Обновить строку. С expectedUpdatedAt — оптимистичная проверка: если строку
 * успели поменять (двойной тап по переключателю дня), вернётся null и
 * вызывающий перечитает строку. null также — строки нет.
 */
export async function updateResponse(
  key: string,
  chatId: number,
  patch: SurveyResponsePatch,
  opts: { expectedUpdatedAt?: string } = {},
): Promise<SurveyResponseRow | null> {
  let query = tgAdmin()
    .from(RESPONSES)
    .update({ ...patch, updated_at: nowIso() })
    .eq("survey_key", key)
    .eq("chat_id", chatId);
  if (opts.expectedUpdatedAt) query = query.eq("updated_at", opts.expectedUpdatedAt);

  const { data, error } = await query.select("*").maybeSingle();
  if (error) dbFail("update", error);
  return (data as SurveyResponseRow | null) ?? null;
}

/**
 * Telegram ответил 403. Строки может не быть (рассылка ещё не дошла до
 * человека) — тогда заводим её сразу с отметкой, чтобы «Дослать остальным»
 * не стучался снова.
 */
export async function markBlocked(key: string, chatId: number, source: SurveySource): Promise<void> {
  const at = nowIso();
  const created = await createResponse(key, chatId, source, { blocked_at: at });
  if (!created) await updateResponse(key, chatId, { blocked_at: at });
}

// ── Выборки для рассылок и сводки ─────────────────────────────────────────────

/** Кого уже спросили в этом опросе (любой шаг, в том числе заблокировавших). */
export async function askedChatIds(key: string): Promise<Set<number>> {
  const { data, error } = await tgAdmin().from(RESPONSES).select("chat_id").eq("survey_key", key);
  if (error) dbFail("asked", error);
  return new Set(((data as { chat_id: number }[] | null) ?? []).map((r) => Number(r.chat_id)));
}

/** Все строки опроса — для сводки /survey и расчёта слотов. Строк сотни. */
export async function listResponses(key: string): Promise<SurveyResponseRow[]> {
  const { data, error } = await tgAdmin()
    .from(RESPONSES)
    .select("*")
    .eq("survey_key", key)
    .order("asked_at", { ascending: true });
  if (error) dbFail("list", error);
  return (data as SurveyResponseRow[] | null) ?? [];
}

/**
 * Кандидаты на напоминание незавершившим: согласие есть, опрос не закончен,
 * ещё не напоминали, первое сообщение не позже askedBefore, итог ещё не
 * приходил. Окно по МСК и срок проверяет вызывающий.
 */
export async function dueForReminder(
  key: string,
  askedBefore: Date,
  limit: number,
): Promise<SurveyResponseRow[]> {
  const { data, error } = await tgAdmin()
    .from(RESPONSES)
    .select("*")
    .eq("survey_key", key)
    .not("consent_at", "is", null)
    .not("step", "in", `(${FINISHED_STEPS.join(",")})`)
    .is("reminded_at", null)
    .is("blocked_at", null)
    .is("result_id", null)
    .lte("asked_at", askedBefore.toISOString())
    .order("asked_at", { ascending: true })
    .limit(limit);
  if (error) dbFail("due reminder", error);
  return (data as SurveyResponseRow[] | null) ?? [];
}

export async function markReminded(key: string, chatId: number): Promise<void> {
  await updateResponse(key, chatId, { reminded_at: nowIso() });
}

/**
 * Получатели итога версии resultId: все с согласием, кому эта версия ещё не
 * уходила (не получали ничего или получили прошлую).
 */
export async function resultRecipients(key: string, resultId: number): Promise<SurveyResponseRow[]> {
  assertId(resultId);
  const { data, error } = await tgAdmin()
    .from(RESPONSES)
    .select("*")
    .eq("survey_key", key)
    .not("consent_at", "is", null)
    .is("blocked_at", null)
    .or(`result_id.is.null,result_id.lt.${resultId}`)
    .order("asked_at", { ascending: true });
  if (error) dbFail("result recipients", error);
  return (data as SurveyResponseRow[] | null) ?? [];
}

/** Итог ушёл. Ответ на прошлую версию сбрасываем: время или место могли поменяться. */
export async function markResultSent(
  key: string,
  chatId: number,
  sent: { resultId: number; variant: ResultVariant; messageId: number | null },
): Promise<void> {
  await updateResponse(key, chatId, {
    result_id: sent.resultId,
    result_variant: sent.variant,
    result_msg_id: sent.messageId,
    result_sent_at: nowIso(),
    result_answer: null,
    result_answered_at: null,
  });
}

/**
 * Ответ на итог. Записываем, только если кнопка от действующей у человека
 * версии; false — кнопка устарела, ничего не меняли.
 */
export async function recordResultAnswer(
  key: string,
  chatId: number,
  resultId: number,
  answer: ResultAnswer,
): Promise<boolean> {
  assertId(resultId);
  const { data, error } = await tgAdmin()
    .from(RESPONSES)
    .update({ result_answer: answer, result_answered_at: nowIso(), updated_at: nowIso() })
    .eq("survey_key", key)
    .eq("chat_id", chatId)
    .eq("result_id", resultId)
    .select("chat_id");
  if (error) dbFail("result answer", error);
  return ((data as unknown[] | null) ?? []).length > 0;
}

/** Кому напомнить накануне: ответили «Буду»/«Приду» на действующую версию, ещё не напоминали по ней. */
export async function dueForEve(key: string, resultId: number, limit: number): Promise<SurveyResponseRow[]> {
  assertId(resultId);
  const { data, error } = await tgAdmin()
    .from(RESPONSES)
    .select("*")
    .eq("survey_key", key)
    .eq("result_id", resultId)
    .eq("result_answer", "yes")
    .is("blocked_at", null)
    .or(`eve_result_id.is.null,eve_result_id.lt.${resultId}`)
    .order("asked_at", { ascending: true })
    .limit(limit);
  if (error) dbFail("due eve", error);
  return (data as SurveyResponseRow[] | null) ?? [];
}

export async function markEveSent(key: string, chatId: number, resultId: number): Promise<void> {
  await updateResponse(key, chatId, { eve_result_id: resultId });
}

// ── Итог ──────────────────────────────────────────────────────────────────────

/** Черновик итога под предпросмотр /surveyresult. Его id уходит в кнопку «Разослать». */
export async function createResultDraft(key: string, draft: SurveyResultDraft): Promise<SurveyResultRow> {
  const { data, error } = await tgAdmin()
    .from(RESULTS)
    .insert({
      survey_key: key,
      meet_date: draft.meetDate,
      meet_time: draft.meetTime,
      place: draft.place,
      bring: draft.bring,
    })
    .select("*")
    .single();
  if (error) dbFail("result draft", error);
  return data as SurveyResultRow;
}

export async function getResult(id: number): Promise<SurveyResultRow | null> {
  assertId(id);
  const { data, error } = await tgAdmin().from(RESULTS).select("*").eq("id", id).maybeSingle();
  if (error) dbFail("result get", error);
  return (data as SurveyResultRow | null) ?? null;
}

/**
 * Подтвердить черновик («Разослать»). Повторное нажатие, в том числе
 * «Дослать остальным», возвращает уже подтверждённую строку без изменений.
 * null — черновика нет.
 */
export async function confirmResult(id: number): Promise<SurveyResultRow | null> {
  const existing = await getResult(id);
  if (!existing || existing.confirmed_at) return existing;

  const { data, error } = await tgAdmin()
    .from(RESULTS)
    .update({ confirmed_at: nowIso() })
    .eq("id", id)
    .is("confirmed_at", null)
    .select("*")
    .maybeSingle();
  if (error) dbFail("result confirm", error);
  // Гонка двух нажатий: вторая update не нашла строку — она уже подтверждена.
  return (data as SurveyResultRow | null) ?? (await getResult(id));
}

/** Действующий итог: последняя подтверждённая версия. null — итог ещё не рассылали. */
export async function currentResult(key: string): Promise<SurveyResultRow | null> {
  const { data, error } = await tgAdmin()
    .from(RESULTS)
    .select("*")
    .eq("survey_key", key)
    .not("confirmed_at", "is", null)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) dbFail("result current", error);
  return (data as SurveyResultRow | null) ?? null;
}
