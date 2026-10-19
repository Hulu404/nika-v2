import type { SurveyResponseRow } from "../lib/clubs/survey-store";
import { surveyByKey, type ClubSurvey } from "../lib/clubs/survey-config";

/** Опрос йоги из конфига — общий для тестов опроса. */
export const YOGA: ClubSurvey = surveyByKey("yoga")!;

/** Строка ответа со значениями по умолчанию, как у свежей строки в базе. */
export function surveyRow(overrides: Partial<SurveyResponseRow> = {}): SurveyResponseRow {
  return {
    survey_key: "yoga",
    chat_id: 4242,
    source: "broadcast",
    step: "interest",
    last_msg_id: null,
    asked_at: "2026-10-20T08:00:00.000Z",
    blocked_at: null,
    name: null,
    username: null,
    consent_at: null,
    consent_version: null,
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
    reminded_at: null,
    result_id: null,
    result_variant: null,
    result_msg_id: null,
    result_sent_at: null,
    result_answer: null,
    result_answered_at: null,
    eve_result_id: null,
    created_at: "2026-10-20T08:00:00.000Z",
    updated_at: "2026-10-20T08:00:00.000Z",
    ...overrides,
  };
}

/** Строка с согласием — для шагов после «Даю согласие». */
export function consentedRow(overrides: Partial<SurveyResponseRow> = {}): SurveyResponseRow {
  return surveyRow({
    consent_at: "2026-10-20T08:05:00.000Z",
    consent_version: "2026-09-30",
    name: "Аня",
    username: "anya",
    ...overrides,
  });
}
