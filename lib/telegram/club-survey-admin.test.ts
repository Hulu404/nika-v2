import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb, fakeClient, type FakeDb, type Row } from "../../test/fake-supabase";
import { YOGA, consentedRow, surveyRow } from "../../test/club-survey-row";
import type { BotContext } from "./bot";

/**
 * Команды организатора: доступ только после /admin, предпросмотры, кнопки,
 * защита от двойного нажатия. Сами рассылки подменены управляемыми
 * промисами — их поведение проверяет survey-dispatch.test.ts.
 */

let db: FakeDb;
vi.mock("./supabase", () => ({ tgAdmin: () => fakeClient(db) }));

type Keyboard = { inline_keyboard: { text: string; callback_data?: string }[][] };
const reports: { chatId: number; text: string; keyboard?: Keyboard }[] = [];
vi.mock("./send", () => ({
  sendBotMessage: async (chatId: number, text: string, keyboard?: Keyboard) => {
    reports.push({ chatId, text, ...(keyboard ? { keyboard } : {}) });
    return { ok: true, messageId: 1 };
  },
}));

let releaseStart: () => void = () => {};
const startCalls: { dryRun?: boolean }[] = [];
const resultCalls: { id: number; dryRun?: boolean }[] = [];
vi.mock("../clubs/survey-dispatch", () => ({
  dispatchSurveyStart: (_s: unknown, opts: { dryRun?: boolean } = {}) => {
    startCalls.push(opts);
    const counts = { alumni: 182, optedOut: 0, alreadyAsked: 12, wouldSend: 170, hasMore: false };
    if (opts.dryRun) return Promise.resolve(counts);
    return new Promise((resolve) => {
      releaseStart = () => resolve({ ...counts, sent: 169, blocked: 1, failed: 0 });
    });
  },
  dispatchSurveyResult: (_s: unknown, result: { id: number }, opts: { dryRun?: boolean } = {}) => {
    resultCalls.push({ id: result.id, ...opts });
    return Promise.resolve({ match: 3, nomatch: 7, hadPrevious: 0, hasMore: false, sent: 10, blocked: 0, failed: 0 });
  },
}));

const admin = await import("./club-survey-admin");
const { __resetPollStateForTests, addAdminChat } = await import("./poll-store");
const { surveyStartLink } = await import("../clubs/survey-config");

const ADMIN = 777;

function makeCtx(opts: { chatId?: number; match?: string; data?: string } = {}) {
  const replies: { text: string; keyboard?: { inline_keyboard: { text: string; callback_data?: string }[][] } }[] = [];
  const toasts: (string | undefined)[] = [];
  const ctx = {
    chat: { id: opts.chatId ?? ADMIN, type: "private" },
    from: { id: opts.chatId ?? ADMIN },
    match: opts.match ?? "",
    callbackQuery: opts.data ? { data: opts.data, message: { message_id: 1 } } : undefined,
    reply: async (text: string, o?: { reply_markup?: (typeof replies)[number]["keyboard"] }) => {
      replies.push({ text, keyboard: o?.reply_markup });
      return { message_id: 1 };
    },
    answerCallbackQuery: async (o?: { text?: string }) => {
      toasts.push(o?.text);
    },
    editMessageReplyMarkup: async () => {},
  };
  return { ctx: ctx as unknown as BotContext, replies, toasts };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  db = createFakeDb({
    club_survey_responses: (r) => ({ ...surveyRow({ chat_id: r.chat_id as number }), ...r }) as Row,
    club_survey_results: (r, d) => ({
      id: (d.tables.club_survey_results?.length ?? 0) + 1,
      created_at: new Date().toISOString(),
      confirmed_at: null,
      ...r,
    }),
  });
  reports.length = 0;
  startCalls.length = 0;
  resultCalls.length = 0;
  __resetPollStateForTests();
  admin.__resetSurveyTestsForTests();
  addAdminChat(ADMIN);
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME = "mynikarun_bot";
});

describe("доступ", () => {
  it("чужому чату команды молчат", async () => {
    for (const handler of [admin.handleSurveySummaryCommand, admin.handleSurveySendCommand, admin.handleSurveyResultCommand]) {
      const { ctx, replies } = makeCtx({ chatId: 1 });
      await handler(ctx);
      expect(replies).toHaveLength(0);
    }
  });
});

describe("/survey", () => {
  it("сводка со ссылкой для поста", async () => {
    db.tables.club_survey_responses = [
      consentedRow({ chat_id: 1, step: "done", attend: "come", days: ["2026-10-29"], wd_from: "19:00", wd_to: "21:00" }),
    ] as unknown as Row[];
    const { ctx, replies } = makeCtx();
    await admin.handleSurveySummaryCommand(ctx);

    expect(replies[0].text).toContain("Придут: 1.");
    expect(replies[0].text).toContain("1. чт 29.10, 19:00 — 1 чел.");
    expect(replies[0].text).toContain(`Ссылка для поста в чат: ${surveyStartLink(YOGA)}`);
    expect(surveyStartLink(YOGA)).toBe("https://t.me/mynikarun_bot?start=yoga");
  });

  it("длинный список «придут» обрезается", async () => {
    db.tables.club_survey_responses = Array.from({ length: 45 }, (_, i) =>
      consentedRow({ chat_id: i + 1, name: `Участник ${i}`, step: "done", attend: "come", days: ["2026-10-29"], wd_any: true }),
    ) as unknown as Row[];
    const { ctx, replies } = makeCtx();
    await admin.handleSurveySummaryCommand(ctx);
    expect(replies[0].text).toContain("… и ещё 5");
    expect(replies[0].text.length).toBeLessThanOrEqual(4000);
  });
});

describe("/surveysend", () => {
  it("предпросмотр → «Разослать» в фоне → отчёт; двойное нажатие не задваивает", async () => {
    const { ctx, replies } = makeCtx();
    await admin.handleSurveySendCommand(ctx);
    expect(replies[0].text).toContain("уйдёт 170 чел.");
    expect(replies[0].text).toContain("Привет! Это команда NIKA.");
    const go = replies[0].keyboard!.inline_keyboard.flat().find((b) => b.text === "Разослать всем");
    expect(go).toMatchObject({ callback_data: "cs_yoga_sg" });

    const first = makeCtx({ data: "cs_yoga_sg" });
    await admin.handleSurveyAdminCallback(first.ctx, YOGA, { type: "send", go: true });
    const second = makeCtx({ data: "cs_yoga_sg" });
    await admin.handleSurveyAdminCallback(second.ctx, YOGA, { type: "send", go: true });

    expect(first.toasts).toEqual(["Рассылаю"]);
    expect(second.toasts).toEqual(["Уже рассылаю"]);
    expect(startCalls.filter((c) => !c.dryRun)).toHaveLength(1);

    releaseStart();
    await flush();
    await flush();
    expect(reports).toEqual([{ chatId: ADMIN, text: "Разослала: 169. Заблокировали бота: 1. Не дошло: 0." }]);

    // После отчёта можно запустить снова («Дослать остальным»).
    const third = makeCtx({ data: "cs_yoga_sg" });
    await admin.handleSurveyAdminCallback(third.ctx, YOGA, { type: "send", go: true });
    expect(third.toasts).toEqual(["Рассылаю"]);
  });

  it("«Отмена» — ничего не шлём", async () => {
    const { ctx, replies } = makeCtx({ data: "cs_yoga_sn" });
    await admin.handleSurveyAdminCallback(ctx, YOGA, { type: "send", go: false });
    expect(replies[0].text).toContain("Отменила");
    expect(startCalls).toHaveLength(0);
  });
});

describe("тестовый прогон /surveysend", () => {
  const labels = (k?: Keyboard) => (k?.inline_keyboard ?? []).flat().map((b) => b.text);
  const adminRow = () => (db.tables.club_survey_responses ?? []).find((r) => r.chat_id === ADMIN);

  it("в предпросмотре первой идёт кнопка «Тест — прислать мне»", async () => {
    const { ctx, replies } = makeCtx();
    await admin.handleSurveySendCommand(ctx);
    expect(labels(replies[0].keyboard)).toEqual(["Тест — прислать мне", "Разослать всем", "Отмена"]);
    expect(replies[0].keyboard!.inline_keyboard[0][0].callback_data).toBe("cs_yoga_st");
  });

  it("«Тест» — опрос приходит только организатору, рассылки нет", async () => {
    const { ctx, replies, toasts } = makeCtx({ data: "cs_yoga_st" });
    await admin.handleSurveyAdminCallback(ctx, YOGA, { type: "test" });

    expect(toasts).toEqual(["Присылаю тебе"]);
    expect(replies[0].text).toContain("Тестовый прогон");
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ chatId: ADMIN, text: expect.stringContaining("Привет! Это команда NIKA.") });
    expect(labels(reports[0].keyboard)).toEqual(["Интересно", "Пока пропущу"]);
    expect(adminRow()).toMatchObject({ source: "broadcast", last_msg_id: 1 });
    expect(startCalls).toHaveLength(0);
    expect(admin.isSurveyTestRun("yoga", ADMIN)).toBe(true);
  });

  it("повторный тест начинает опрос заново", async () => {
    db.tables.club_survey_responses = [consentedRow({ chat_id: ADMIN, step: "done", attend: "come" })] as unknown as Row[];
    const { ctx } = makeCtx({ data: "cs_yoga_st" });
    await admin.handleSurveyAdminCallback(ctx, YOGA, { type: "test" });
    expect(db.tables.club_survey_responses).toHaveLength(1);
    expect(adminRow()).toMatchObject({ step: "interest", consent_at: null });
  });

  it("«Апрув» — тестовая строка стёрта, запускается рассылка всем", async () => {
    await admin.handleSurveyAdminCallback(makeCtx({ data: "cs_yoga_st" }).ctx, YOGA, { type: "test" });
    const press = makeCtx({ data: "cs_yoga_ap" });
    await admin.handleSurveyAdminCallback(press.ctx, YOGA, { type: "approve" });

    expect(adminRow()).toBeUndefined();
    expect(admin.isSurveyTestRun("yoga", ADMIN)).toBe(false);
    expect(press.toasts).toEqual(["Рассылаю"]);
    expect(startCalls.filter((c) => !c.dryRun)).toHaveLength(1);
  });

  it("«На доработку» — никому не шлём, тестовая строка стёрта", async () => {
    await admin.handleSurveyAdminCallback(makeCtx({ data: "cs_yoga_st" }).ctx, YOGA, { type: "test" });
    const press = makeCtx({ data: "cs_yoga_rw" });
    await admin.handleSurveyAdminCallback(press.ctx, YOGA, { type: "rework" });

    expect(press.replies[0].text).toContain("Никому не отправила");
    expect(adminRow()).toBeUndefined();
    expect(admin.isSurveyTestRun("yoga", ADMIN)).toBe(false);
    expect(startCalls).toHaveLength(0);
  });

  it("чужой чат кнопки теста не запускают", async () => {
    for (const action of [{ type: "test" }, { type: "approve" }, { type: "rework" }] as const) {
      await admin.handleSurveyAdminCallback(makeCtx({ chatId: 1 }).ctx, YOGA, action);
    }
    expect(reports).toHaveLength(0);
    expect(db.tables.club_survey_responses ?? []).toHaveLength(0);
    expect(startCalls).toHaveLength(0);
  });

  it("вердикт после теста — кнопки «Апрув» и «На доработку» в чат организатора", async () => {
    await admin.handleSurveyAdminCallback(makeCtx({ data: "cs_yoga_st" }).ctx, YOGA, { type: "test" });
    await admin.offerSurveyTestVerdict(YOGA, ADMIN);
    const verdict = reports[reports.length - 1];
    expect(verdict.chatId).toBe(ADMIN);
    expect(verdict.text).toContain("Тест пройден");
    expect(verdict.keyboard!.inline_keyboard.flat().map((b) => b.callback_data)).toEqual(["cs_yoga_ap", "cs_yoga_rw"]);
  });
});

describe("/surveyresult", () => {
  it("неверная дата — подсказка с днями опроса, черновик не создаём", async () => {
    const { ctx, replies } = makeCtx({ match: "2026-11-05 19:30 Студия" });
    await admin.handleSurveyResultCommand(ctx);
    expect(replies[0].text).toContain("Эта дата не из дней опроса");
    expect(replies[0].text).toContain("2026-10-28");
    expect(db.tables.club_survey_results ?? []).toHaveLength(0);
  });

  it("неверный формат — подсказка", async () => {
    const { ctx, replies } = makeCtx({ match: "завтра вечером" });
    await admin.handleSurveyResultCommand(ctx);
    expect(replies[0].text).toContain("Не разобрала команду");
  });

  it("черновик → предпросмотр с числами → «Разослать» подтверждает и рассылает", async () => {
    const { ctx, replies } = makeCtx({ match: "2026-10-29 19:30 Студия, Тверская 1 | воду" });
    await admin.handleSurveyResultCommand(ctx);

    expect(db.tables.club_survey_results).toHaveLength(1);
    expect(db.tables.club_survey_results[0]).toMatchObject({ meet_date: "2026-10-29", meet_time: "19:30", bring: "воду", confirmed_at: null });
    expect(replies[0].text).toContain("Получат 10 чел.");
    expect(replies[0].text).toContain("совпали день и время — 3 (вариант 1), остальные — 7 (вариант 2)");
    expect(replies[0].keyboard!.inline_keyboard[0][0].callback_data).toBe("cs_yoga_rg_1");

    const press = makeCtx({ data: "cs_yoga_rg_1" });
    await admin.handleSurveyAdminCallback(press.ctx, YOGA, { type: "result_send", resultId: 1 });
    await flush();

    expect(db.tables.club_survey_results[0].confirmed_at).not.toBeNull();
    expect(resultCalls.filter((c) => !c.dryRun)).toEqual([{ id: 1 }]);
    expect(reports[0].text).toBe("Разослала: 10. Заблокировали бота: 0. Не дошло: 0.");
  });

  it("старый черновик после нового разосланного итога — отказ", async () => {
    db.tables.club_survey_results = [
      { id: 1, survey_key: "yoga", meet_date: "2026-10-29", meet_time: "19:30", place: "А", bring: null, confirmed_at: null },
      { id: 2, survey_key: "yoga", meet_date: "2026-10-29", meet_time: "20:00", place: "Б", bring: null, confirmed_at: "2026-10-23T10:00:00Z" },
    ];
    const press = makeCtx({ data: "cs_yoga_rg_1" });
    await admin.handleSurveyAdminCallback(press.ctx, YOGA, { type: "result_send", resultId: 1 });

    expect(press.replies[0].text).toContain("устарел");
    expect(db.tables.club_survey_results[0].confirmed_at).toBeNull();
    expect(resultCalls).toHaveLength(0);
  });
});
