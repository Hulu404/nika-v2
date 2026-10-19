import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb, fakeClient, type FakeDb, type Row } from "../../test/fake-supabase";
import { YOGA, consentedRow, surveyRow } from "../../test/club-survey-row";

/**
 * Тикер опроса на «базе» в памяти: окна, отметки и главное — повторный
 * проход ничего не шлёт второй раз (тикер идёт на каждом деплое).
 */

let db: FakeDb;
vi.mock("../telegram/supabase", () => ({ tgAdmin: () => fakeClient(db) }));

const sent: { chatId: number; text: string }[] = [];
const blockedChats = new Set<number>();
vi.mock("../telegram/send", () => ({
  sendBotMessage: async (chatId: number, text: string) => {
    if (blockedChats.has(chatId)) return { ok: false, blocked: true };
    sent.push({ chatId, text });
    return { ok: true, messageId: 1 };
  },
}));

const { tickClubSurveys } = await import("./survey-reminders");
const { TEXT } = await import("../telegram/club-survey-copy");

const ASKED = "2026-10-20T08:00:00.000Z";
/** 21.10, 12:00 МСК — окно открыто, прошло 25 часов. */
const REMIND_AT = new Date("2026-10-21T09:00:00Z");
/** 28.10, 19:00 МСК — накануне встречи 29.10. */
const EVE_AT = new Date("2026-10-28T16:00:00Z");

function seed(rows: Row[], results: Row[] = []) {
  db.tables.club_survey_responses = rows;
  db.tables.club_survey_results = results;
}

const tick = (now: Date) => tickClubSurveys({ now, throttleMs: 0 });

beforeEach(() => {
  db = createFakeDb();
  sent.length = 0;
  blockedChats.clear();
});

describe("напоминание незавершившим", () => {
  it("одно на человека: второй тик не шлёт", async () => {
    seed([consentedRow({ chat_id: 1, step: "days", asked_at: ASKED }) as unknown as Row]);

    expect(await tick(REMIND_AT)).toMatchObject({ reminded: 1 });
    expect(sent).toEqual([{ chatId: 1, text: TEXT.reminder(YOGA) }]);
    expect(db.tables.club_survey_responses[0].reminded_at).not.toBeNull();

    expect(await tick(new Date(REMIND_AT.getTime() + 15 * 60_000))).toMatchObject({ reminded: 0 });
    expect(sent).toHaveLength(1);
  });

  it("только согласившимся и незакончившим, через 24 часа", async () => {
    seed([
      consentedRow({ chat_id: 1, step: "time", asked_at: ASKED }),
      surveyRow({ chat_id: 2, step: "interest", asked_at: ASKED }),
      consentedRow({ chat_id: 3, step: "done", asked_at: ASKED }),
      consentedRow({ chat_id: 4, step: "attend", asked_at: "2026-10-20T10:00:00.000Z" }), // 23 часа
    ] as unknown as Row[]);

    await tick(REMIND_AT);
    expect(sent.map((s) => s.chatId)).toEqual([1]);
  });

  it("вне окна и после срока — тишина", async () => {
    seed([consentedRow({ chat_id: 1, step: "days", asked_at: ASKED }) as unknown as Row]);
    await tick(new Date("2026-10-21T06:00:00Z")); // 09:00 МСК
    await tick(new Date("2026-10-21T19:00:00Z")); // 22:00 МСК
    await tick(new Date("2026-10-22T10:00:00Z")); // 13:00 МСК, срок прошёл
    expect(sent).toHaveLength(0);
  });

  it("после итога напоминаний нет", async () => {
    seed(
      [consentedRow({ chat_id: 1, step: "days", asked_at: ASKED }) as unknown as Row],
      [{ id: 1, survey_key: "yoga", meet_date: "2026-10-29", meet_time: "19:30", place: "студия", bring: null, confirmed_at: "2026-10-21T08:00:00Z" }],
    );
    await tick(REMIND_AT);
    expect(sent).toHaveLength(0);
  });

  it("заблокировавший бота помечается и больше не пробуется", async () => {
    seed([consentedRow({ chat_id: 5, step: "days", asked_at: ASKED }) as unknown as Row]);
    blockedChats.add(5);

    expect(await tick(REMIND_AT)).toMatchObject({ blocked: 1, reminded: 0 });
    expect(db.tables.club_survey_responses[0].blocked_at).not.toBeNull();

    blockedChats.clear();
    await tick(REMIND_AT);
    expect(sent).toHaveLength(0);
  });

  it("порция за проход ограничена", async () => {
    seed(
      Array.from({ length: 5 }, (_, i) => consentedRow({ chat_id: 100 + i, step: "days", asked_at: ASKED })) as unknown as Row[],
    );
    await tickClubSurveys({ now: REMIND_AT, throttleMs: 0, limit: 2 });
    expect(sent).toHaveLength(2);
    await tickClubSurveys({ now: REMIND_AT, throttleMs: 0, limit: 2 });
    expect(sent).toHaveLength(4);
  });
});

describe("напоминание накануне", () => {
  const RESULT = {
    id: 3,
    survey_key: "yoga",
    meet_date: "2026-10-29",
    meet_time: "19:30",
    place: "студия, адрес",
    bring: null,
    confirmed_at: "2026-10-23T09:00:00Z",
  };

  it("тем, кто ответил «Буду»/«Приду», один раз", async () => {
    seed(
      [
        consentedRow({ chat_id: 1, step: "done", result_id: 3, result_answer: "yes" }),
        consentedRow({ chat_id: 2, step: "done", result_id: 3, result_answer: "no" }),
        consentedRow({ chat_id: 3, step: "done", result_id: 3, result_answer: null }),
      ] as unknown as Row[],
      [RESULT],
    );

    expect(await tick(EVE_AT)).toMatchObject({ eve: 1 });
    expect(sent).toEqual([{ chatId: 1, text: "Завтра в 19:30 встречаемся на йоге: студия, адрес. До встречи!" }]);

    await tick(new Date(EVE_AT.getTime() + 15 * 60_000));
    expect(sent).toHaveLength(1);
  });

  it("не в тот вечер — тишина", async () => {
    seed([consentedRow({ chat_id: 1, step: "done", result_id: 3, result_answer: "yes" }) as unknown as Row], [RESULT]);
    await tick(new Date("2026-10-27T16:00:00Z"));
    await tick(new Date("2026-10-28T19:00:00Z")); // 22:00 МСК
    expect(sent).toHaveLength(0);
  });

  it("ответ на прошлую версию итога — не повод напоминать", async () => {
    seed(
      [consentedRow({ chat_id: 1, step: "done", result_id: 2, result_answer: "yes" }) as unknown as Row],
      [{ ...RESULT, id: 2 }, RESULT],
    );
    await tick(EVE_AT);
    expect(sent).toHaveLength(0);
  });
});

