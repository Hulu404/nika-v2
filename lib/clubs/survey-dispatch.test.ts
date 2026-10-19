import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb, fakeClient, type FakeDb, type Row } from "../../test/fake-supabase";
import { YOGA, consentedRow, surveyRow } from "../../test/club-survey-row";
import type { SurveyResultRow } from "./survey-store";

/**
 * Рассылки опроса на «базе» в памяти: кому уходит старт, когда появляется
 * отметка «спросили», как итог делится на варианты 8 и 9.
 */

let db: FakeDb;
vi.mock("../telegram/supabase", () => ({ tgAdmin: () => fakeClient(db) }));

const sent: { chatId: number; text: string }[] = [];
const outcome = new Map<number, "blocked" | "failed">();
vi.mock("../telegram/send", () => ({
  sendBotMessage: async (chatId: number, text: string) => {
    const o = outcome.get(chatId);
    if (o === "blocked") return { ok: false, blocked: true };
    if (o === "failed") return { ok: false, retryAfter: 3 };
    sent.push({ chatId, text });
    return { ok: true, messageId: 500 + chatId };
  },
}));

const { dispatchSurveyResult, dispatchSurveyStart, surveyStartAudience } = await import("./survey-dispatch");
const { TEXT } = await import("../telegram/club-survey-copy");

function signup(chatId: number, confirmed = true): Row {
  return { tg_chat_id: chatId, confirmed_at: confirmed ? "2026-09-01T10:00:00Z" : null };
}

function responses(): Row[] {
  return db.tables.club_survey_responses ?? [];
}

beforeEach(() => {
  db = createFakeDb({
    club_survey_responses: (r) => ({ ...surveyRow({ chat_id: r.chat_id as number }), ...r }) as Row,
  });
  sent.length = 0;
  outcome.clear();
});

describe("surveyStartAudience — бегавшие минус отписавшиеся минус спрошенные", () => {
  it("считает каждую группу один раз", () => {
    const res = surveyStartAudience([1, 2, 2, 3, 4, 5], new Set([2, 9]), new Set([3, 5]));
    expect(res).toEqual({ due: [1, 4], alumni: 5, optedOut: 1, alreadyAsked: 2 });
  });

  it("отписавшийся и спрошенный — считается отписавшимся", () => {
    expect(surveyStartAudience([1], new Set([1]), new Set([1]))).toMatchObject({ optedOut: 1, alreadyAsked: 0 });
  });
});

describe("dispatchSurveyStart", () => {
  beforeEach(() => {
    db.tables.coffee_run_signups = [signup(1), signup(2), signup(2), signup(3), signup(4), signup(5, false)];
    db.tables.tg_bindings = [{ chat_id: 2, tg_opt_in: false }];
    db.tables.club_survey_responses = [surveyRow({ chat_id: 3, source: "link" }) as unknown as Row];
  });

  it("предпросмотр: числа без отправки и без отметок", async () => {
    const preview = await dispatchSurveyStart(YOGA, { dryRun: true });
    expect(preview).toMatchObject({ alumni: 4, optedOut: 1, alreadyAsked: 1, wouldSend: 2, hasMore: false });
    expect(sent).toHaveLength(0);
    expect(responses()).toHaveLength(1);
  });

  it("отметка «спросили» — только после отправки или блокировки", async () => {
    outcome.set(4, "failed");
    const res = await dispatchSurveyStart(YOGA, { throttleMs: 0 });

    expect(res).toMatchObject({ sent: 1, failed: 1, blocked: 0 });
    expect(sent).toEqual([{ chatId: 1, text: TEXT.interest }]);
    expect(responses().find((r) => r.chat_id === 1)).toMatchObject({
      source: "broadcast",
      step: "interest",
      last_msg_id: 501,
    });
    expect(responses().find((r) => r.chat_id === 4)).toBeUndefined();

    // «Дослать остальным»: уходит только тому, кому не дошло.
    outcome.set(4, "blocked");
    const again = await dispatchSurveyStart(YOGA, { throttleMs: 0 });
    expect(again).toMatchObject({ sent: 0, blocked: 1, wouldSend: 1 });
    expect(responses().find((r) => r.chat_id === 4)?.blocked_at).not.toBeNull();

    const third = await dispatchSurveyStart(YOGA, { dryRun: true });
    expect(third.wouldSend).toBe(0);
  });

  it("порция ограничена, остаток — hasMore", async () => {
    const res = await dispatchSurveyStart(YOGA, { throttleMs: 0, limit: 1 });
    expect(res).toMatchObject({ sent: 1, hasMore: true });
  });
});

describe("dispatchSurveyResult — варианты 8 и 9", () => {
  const THU = "2026-10-29";
  const SAT = "2026-10-31";
  const RESULT: SurveyResultRow = {
    id: 2,
    survey_key: "yoga",
    meet_date: THU,
    meet_time: "19:30",
    place: "студия, адрес",
    bring: null,
    created_at: "2026-10-23T09:00:00Z",
    confirmed_at: "2026-10-23T09:05:00Z",
  };

  beforeEach(() => {
    db.tables.club_survey_responses = [
      consentedRow({ chat_id: 1, step: "done", attend: "come", days: [THU], wd_from: "19:00", wd_to: "21:00" }),
      consentedRow({ chat_id: 2, step: "done", attend: "come", days: [THU], wd_from: "18:00", wd_to: "20:00" }),
      consentedRow({ chat_id: 3, step: "done", attend: "come", days: [SAT], we_any: true }),
      consentedRow({ chat_id: 4, step: "later_done", attend: "later" }),
      consentedRow({ chat_id: 5, step: "done", attend: "come", days: [THU], wd_raw: "после работы" }),
      consentedRow({ chat_id: 6, step: "days", attend: "come" }),
      surveyRow({ chat_id: 7, step: "skipped" }),
      surveyRow({ chat_id: 8, step: "declined" }),
      consentedRow({ chat_id: 9, step: "done", result_id: 2 }),
    ] as unknown as Row[];
  });

  it("предпросмотр: совпал — один, остальным с согласием — вариант 9", async () => {
    const preview = await dispatchSurveyResult(YOGA, RESULT, { dryRun: true });
    expect(preview).toMatchObject({ match: 1, nomatch: 5, hadPrevious: 0 });
    expect(sent).toHaveLength(0);
  });

  it("рассылка: тексты по вариантам, без согласия — никому, повтор — никому", async () => {
    await dispatchSurveyResult(YOGA, RESULT, { throttleMs: 0 });

    const byChat = new Map(sent.map((s) => [s.chatId, s.text]));
    expect([...byChat.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(byChat.get(1)).toBe(TEXT.resultMatch(RESULT));
    for (const chat of [2, 3, 4, 5, 6]) expect(byChat.get(chat)).toBe(TEXT.resultNoMatch(RESULT));
    expect(responses().find((r) => r.chat_id === 1)).toMatchObject({
      result_id: 2,
      result_variant: "match",
      result_msg_id: 501,
    });

    sent.length = 0;
    await dispatchSurveyResult(YOGA, RESULT, { throttleMs: 0 });
    expect(sent).toHaveLength(0);
  });

  it("исправленный итог уходит заново и сбрасывает ответ", async () => {
    Object.assign(responses().find((r) => r.chat_id === 9)!, { result_answer: "yes", attend: "come", days: [THU], wd_any: true });
    const fixed = { ...RESULT, id: 3, meet_time: "20:00" };

    const preview = await dispatchSurveyResult(YOGA, fixed, { dryRun: true });
    expect(preview.hadPrevious).toBe(1);

    await dispatchSurveyResult(YOGA, fixed, { throttleMs: 0 });
    expect(responses().find((r) => r.chat_id === 9)).toMatchObject({ result_id: 3, result_answer: null, result_variant: "match" });
  });
});
