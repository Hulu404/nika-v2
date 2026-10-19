import { describe, it, expect } from "vitest";
import {
  BUTTONS,
  CLUB_SURVEY_CALLBACK_RE,
  TEXT,
  buildSurveyCallback,
  chosenDaysPhrase,
  daysKeyboard,
  joinRu,
  meetDayLabel,
  parseSurveyCallback,
  parseSurveyResultArgs,
  parseSurveyResultCommand,
  participantMessage,
  resultMessage,
  resultPreviewText,
  surveyFeedLine,
  surveySendPreviewText,
  surveySummaryText,
  weekdaysKeyboard,
  type SurveyCallbackAction,
} from "./club-survey-copy";
import { surveySummary } from "../clubs/survey-slots";
import type { SurveyResultRow } from "../clubs/survey-store";
import { YOGA, consentedRow } from "../../test/club-survey-row";

const URL = "https://www.mynika.online/legal/consent";
const WED = "2026-10-28";
const THU = "2026-10-29";
const FRI = "2026-10-30";
const SAT = "2026-10-31";

const RESULT: SurveyResultRow = {
  id: 7,
  survey_key: "yoga",
  meet_date: THU,
  meet_time: "19:30",
  place: "студия, адрес",
  bring: "удобную одежду и воду",
  created_at: "2026-10-23T09:00:00Z",
  confirmed_at: "2026-10-23T09:05:00Z",
};

const text = (kind: Parameters<typeof participantMessage>[0], row = consentedRow()) =>
  participantMessage(kind, YOGA, row, URL)?.text;

const labels = (kb: { inline_keyboard: { text: string }[][] } | undefined) =>
  (kb?.inline_keyboard ?? []).map((r) => r.map((b) => b.text));

describe("тексты участнику — дословно", () => {
  it("1, 1а, 2, 2а, 3", () => {
    expect(text("interest")).toBe(
      "Привет! Это команда NIKA. Мы бегали вместе на кофе-ранах, а теперь зовём на коврик: открываем клуб йоги.\n\n" +
        "Здесь можно замедлиться. Спокойное занятие с нашим инструктором, рядом знакомые лица с пробежек. " +
        "Подойдёт для любого уровня.\n\nТебе интересно?",
    );
    expect(text("skipped")).toBe(
      "Спасибо за ответ! Если передумаешь, нажми кнопку ниже. Анонсы кофе-ранов и других клубов NIKA выходят в чате.",
    );
    expect(text("consent")).toBe(
      "Здорово! Чтобы сохранить твои ответы и прислать дату, время и место, нужно твоё согласие " +
        "на обработку персональных данных и сообщения от NIKA: https://www.mynika.online/legal/consent",
    );
    expect(text("declined")).toBe("Договорились! Итог опубликуем в чате кофе-ранов в пятницу, 23 октября.");
    expect(text("attend")).toBe(
      "Первая встреча пройдёт на неделе с 28 октября по 1 ноября. Получится прийти в один из этих дней?",
    );
  });

  it("ссылка в тексте 2 — последней, без точки", () => {
    expect(text("consent")?.endsWith(URL)).toBe(true);
  });

  it("4, 4а, 3а, 3б и вопросы о времени без подстановок", () => {
    expect(text("days")).toBe("Отметь все дни, которые подходят, и нажми «Готово».");
    expect(text("days_empty")).toBe("Отметь хотя бы один день. Если эта неделя занята, нажми «Присоединюсь позже».");
    expect(text("later")).toBe(
      "Поняли! Клуб будет встречаться регулярно. Подскажи, какие дни недели тебе обычно удобны, и подберём время следующих встреч.",
    );
    expect(text("later_done")).toBe(
      "Спасибо! Позовём на следующие встречи, а детали первой тоже пришлём: вдруг планы поменяются.",
    );
    expect(text("time_retry")).toBe("Напиши, пожалуйста, начало и конец. Например: с 19 до 21.");
    expect(text("time_short")).toBe("Нужен промежуток хотя бы в час, чтобы занятие поместилось. Например: с 19 до 21.");
    expect(text("time_saved")).toBe("Спасибо, сохранили твой ответ. Идём дальше.");
  });

  it("5, 5б, 5в — по вопросу и выбранным дням", () => {
    const come = { attend: "come" as const, days: [THU, FRI, SAT] };
    expect(text("time", consentedRow({ ...come, time_q: "all" }))).toBe(
      "Во сколько тебе удобно? Напиши, с какого и до какого часа. Например: с 19 до 21 или с 18:30 до 21:00.",
    );
    expect(text("time", consentedRow({ ...come, time_q: "wd" }))).toBe(
      "Во сколько удобно в будни (чт, пт)? Напиши, с какого и до какого часа. Например: с 19 до 21.",
    );
    expect(text("time", consentedRow({ ...come, time_q: "we" }))).toBe("А в выходные (сб)? Например: с 11 до 14.");

    const later = consentedRow({ attend: "later", weekdays: [1, 3, 6], time_q: "wd" });
    expect(text("time", later)).toBe(
      "Во сколько удобно в будни (пн, ср)? Напиши, с какого и до какого часа. Например: с 19 до 21.",
    );
  });

  it("6 — только будни", () => {
    const row = consentedRow({ attend: "come", days: [THU, FRI], wd_from: "19:00", wd_to: "21:00" });
    expect(text("done", row)).toBe(
      "Записали: чт 29.10 и пт 30.10, с 19:00 до 21:00. В пятницу, 23 октября, пришлём дату, время и место.\n\n" +
        "Приходи один, уйдёшь с компанией.",
    );
  });

  it("6 — будни и выходные (пример из спецификации)", () => {
    const row = consentedRow({
      attend: "come",
      days: [THU, SAT],
      wd_from: "19:00",
      wd_to: "21:00",
      we_from: "11:00",
      we_to: "14:00",
    });
    expect(text("done", row)).toBe(
      "Записали: чт 29.10 и сб 31.10, в будни с 19:00 до 21:00, в выходные с 11:00 до 14:00. " +
        "В пятницу, 23 октября, пришлём дату, время и место.\n\nПриходи один, уйдёшь с компанией.",
    );
  });

  it("6 — любое время", () => {
    expect(text("done", consentedRow({ attend: "come", days: [SAT], we_any: true }))).toMatch(
      /^Записали: сб 31\.10, в любое время\. /,
    );
    expect(
      text("done", consentedRow({ attend: "come", days: [THU, SAT], wd_any: true, we_from: "11:00", we_to: "14:00" })),
    ).toMatch(/^Записали: чт 29\.10 и сб 31\.10, в будни в любое время, в выходные с 11:00 до 14:00\. /);
  });

  it("6 — ответ текстом", () => {
    expect(text("done", consentedRow({ attend: "come", days: [THU], wd_raw: "после работы" }))).toMatch(
      /^Записали: чт 29\.10, время: «после работы»\. /,
    );
  });

  it("7, 8, 9, 10, 11, 12", () => {
    expect(TEXT.reminder(YOGA)).toBe(
      "Осталось выбрать день и время для клуба йоги, это займёт минуту. Голосуем до четверга.",
    );
    expect(resultMessage(YOGA, RESULT, "match").text).toBe(
      "Встречаемся в четверг, 29 октября, в 19:30. Место: студия, адрес. С собой: удобную одежду и воду. Будешь?",
    );
    expect(TEXT.resultMatch({ ...RESULT, bring: null })).toBe(
      "Встречаемся в четверг, 29 октября, в 19:30. Место: студия, адрес. Будешь?",
    );
    expect(resultMessage(YOGA, RESULT, "nomatch").text).toBe(
      "Первая встреча клуба йоги: в четверг, 29 октября, в 19:30, студия, адрес. " +
        "Если получится, приходи! Следующие встречи поставим с учётом твоих ответов.",
    );
    expect(text("result_yes")).toBe("Ждём тебя! Накануне напомним.");
    expect(text("result_no")).toBe("Поняли, спасибо! Позовём на следующую встречу.");
    expect(TEXT.eve(RESULT)).toBe("Завтра в 19:30 встречаемся на йоге: студия, адрес. До встречи!");
  });

  it("точка в конце места не задваивается", () => {
    expect(TEXT.eve({ ...RESULT, place: "студия, адрес." })).toBe(
      "Завтра в 19:30 встречаемся на йоге: студия, адрес. До встречи!",
    );
  });

  it("для повтора итога и общего ответа текста здесь нет", () => {
    expect(participantMessage("result_repeat", YOGA, consentedRow(), URL)).toBeNull();
    expect(participantMessage("fallback", YOGA, consentedRow(), URL)).toBeNull();
  });
});

describe("подстановки", () => {
  it("список дней: один, два, три", () => {
    expect(chosenDaysPhrase(YOGA, { days: [THU] })).toBe("чт 29.10");
    expect(chosenDaysPhrase(YOGA, { days: [THU, SAT] })).toBe("чт 29.10 и сб 31.10");
    expect(chosenDaysPhrase(YOGA, { days: [WED, THU, SAT] })).toBe("ср 28.10, чт 29.10 и сб 31.10");
    expect(joinRu([])).toBe("");
  });

  it("день встречи с предлогом и месяцем", () => {
    expect(meetDayLabel(THU)).toBe("в четверг, 29 октября");
    expect(meetDayLabel("2026-11-03")).toBe("во вторник, 3 ноября");
    expect(meetDayLabel("2026-11-01")).toBe("в воскресенье, 1 ноября");
  });
});

describe("клавиатуры", () => {
  it("кнопки шагов 1, 2, 3", () => {
    expect(labels(participantMessage("interest", YOGA, consentedRow(), URL)?.keyboard)).toEqual([
      ["Интересно", "Пока пропущу"],
    ]);
    expect(labels(participantMessage("consent", YOGA, consentedRow(), URL)?.keyboard)).toEqual([
      ["Даю согласие"],
      ["Посмотрю итог в чате"],
    ]);
    expect(labels(participantMessage("attend", YOGA, consentedRow(), URL)?.keyboard)).toEqual([
      ["Приду", "Присоединюсь позже"],
    ]);
  });

  it("дни: отмеченные с «✓ », в конце «Готово»", () => {
    expect(labels(daysKeyboard(YOGA, [THU, SAT]))).toEqual([
      ["Ср 28.10", "✓ Чт 29.10", "Пт 30.10"],
      ["✓ Сб 31.10", "Вс 01.11"],
      ["Готово"],
    ]);
  });

  it("дни недели Пн…Вс, «Готово» и «Пропустить»", () => {
    expect(labels(weekdaysKeyboard(YOGA, [1, 0]))).toEqual([
      ["✓ Пн", "Вт", "Ср", "Чт"],
      ["Пт", "Сб", "✓ Вс"],
      ["Готово", "Пропустить"],
    ]);
  });

  it("под 5, 4а, 6 и итогами", () => {
    expect(labels(participantMessage("time", YOGA, consentedRow({ time_q: "all" }), URL)?.keyboard)).toEqual([
      ["Подойдёт любое время"],
    ]);
    expect(labels(participantMessage("days_empty", YOGA, consentedRow(), URL)?.keyboard)).toEqual([
      ["Присоединюсь позже"],
    ]);
    expect(labels(participantMessage("done", YOGA, consentedRow({ days: [THU] }), URL)?.keyboard)).toEqual([
      ["Изменить ответ"],
    ]);
    expect(labels(resultMessage(YOGA, RESULT, "match").keyboard)).toEqual([["Буду", "Планы поменялись"]]);
    expect(labels(resultMessage(YOGA, RESULT, "nomatch").keyboard)).toEqual([["Приду", "В этот раз пропущу"]]);
  });
});

describe("callback_data", () => {
  const ALL: SurveyCallbackAction[] = [
    { type: "interest", yes: true },
    { type: "interest", yes: false },
    { type: "consent", yes: true },
    { type: "consent", yes: false },
    { type: "attend", come: true },
    { type: "attend", come: false },
    ...YOGA.days.map((_, index) => ({ type: "day" as const, index })),
    { type: "days_done" },
    ...[0, 1, 2, 3, 4, 5, 6].map((day) => ({ type: "weekday" as const, day })),
    { type: "weekdays_done" },
    { type: "weekdays_skip" },
    { type: "any_time" },
    { type: "edit" },
    { type: "continue" },
    { type: "result", resultId: 9_999_999_999, yes: true },
    { type: "result", resultId: 1, yes: false },
    { type: "send", go: true },
    { type: "send", go: false },
    { type: "result_send", resultId: 9_999_999_999 },
    { type: "result_cancel" },
  ];

  it.each(ALL.map((a) => [JSON.stringify(a), a] as const))("%s: parse(build(x)) = x, ≤ 64 байт", (_n, action) => {
    for (const key of ["yoga", "abcdefghijkl"]) {
      const data = buildSurveyCallback(key, action);
      expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
      expect(CLUB_SURVEY_CALLBACK_RE.test(data)).toBe(true);
      expect(parseSurveyCallback(data)).toEqual({ key, action });
    }
  });

  it("самая длинная кнопка — 29 байт", () => {
    const max = Math.max(...ALL.map((a) => Buffer.byteLength(buildSurveyCallback("abcdefghijkl", a), "utf8")));
    expect(max).toBe(29);
  });

  it("не путается с чужими кнопками и мусором", () => {
    for (const data of ["crp_y_2026-09-05", "bc_no", "op_no", "rc_no", "optin_yes", "ans_ok", "cs_yoga_zz", "cs_YOGA_iy", "cs_yoga_w_7", "cs_yoga_d_10", "cs__iy", "cs_yoga_rg_"]) {
      expect(parseSurveyCallback(data)).toBeNull();
    }
  });

  it("все кнопки участника несут ключ опроса", () => {
    const kb = participantMessage("interest", YOGA, consentedRow(), URL)?.keyboard;
    const datas = (kb?.inline_keyboard ?? []).flat().map((b) => (b as { callback_data?: string }).callback_data);
    expect(datas).toEqual(["cs_yoga_iy", "cs_yoga_in"]);
  });
});

describe("/surveyresult — аргументы", () => {
  it("дата, время, место и что взять", () => {
    expect(parseSurveyResultArgs("2026-10-29 19:30 Студия, Тверская 1 | удобную одежду и воду")).toEqual({
      meetDate: THU,
      meetTime: "19:30",
      place: "Студия, Тверская 1",
      bring: "удобную одежду и воду",
    });
  });

  it("без «что взять», час одной цифрой", () => {
    expect(parseSurveyResultArgs("2026-10-31 9:00 Парк")).toEqual({
      meetDate: SAT,
      meetTime: "09:00",
      place: "Парк",
      bring: null,
    });
    expect(parseSurveyResultArgs("2026-10-31 9:00 Парк |  ")?.bring).toBeNull();
  });

  it("неверный формат — null", () => {
    for (const raw of ["", "2026-10-29", "2026-10-29 19:30", "2026-02-30 19:30 Парк", "2026-10-29 25:00 Парк", "29.10 19:30 Парк", "2026-10-29 19:30 | вода", `2026-10-29 19:30 ${"а".repeat(301)}`]) {
      expect(parseSurveyResultArgs(raw)).toBeNull();
    }
  });
});

describe("/surveyresult — дата из дней опроса", () => {
  it("день-кандидат проходит, другой — reason date, мусор — format", () => {
    expect(parseSurveyResultCommand(YOGA, "2026-10-31 11:00 Парк")).toMatchObject({ ok: true });
    expect(parseSurveyResultCommand(YOGA, "2026-11-02 11:00 Парк")).toEqual({ ok: false, reason: "date" });
    expect(parseSurveyResultCommand(YOGA, "в субботу в парке")).toEqual({ ok: false, reason: "format" });
    expect(parseSurveyResultCommand(YOGA, "2026-10-31 11:60 Парк")).toEqual({ ok: false, reason: "format" });
  });
});

describe("служебное организатору", () => {
  it("предпросмотр /surveysend: числа и дословный текст 1", () => {
    const t = surveySendPreviewText({ wouldSend: 150, alumni: 182, optedOut: 0, alreadyAsked: 32, hasMore: false }, TEXT.interest);
    expect(t).toContain("уйдёт 150 чел.");
    expect(t).toContain("из 182");
    expect(t).toContain("уже спрошены (в том числе по ссылке): 32");
    expect(t).toContain(TEXT.interest);
    expect(t).not.toContain("Дослать");
  });

  it("предпросмотр итога: оба варианта и предупреждение о повторе", () => {
    const first = resultPreviewText(RESULT, { match: 12, nomatch: 30 }, null);
    expect(first).toContain("Получат 42 чел.");
    expect(first).toContain(TEXT.resultMatch(RESULT));
    expect(first).toContain(TEXT.resultNoMatch(RESULT));
    expect(first).not.toContain("Внимание");

    const again = resultPreviewText({ ...RESULT, id: 8, meet_time: "20:00" }, { match: 10, nomatch: 32 }, {
      result: RESULT,
      received: 42,
    });
    expect(again).toContain("Внимание: итог уже рассылали (в четверг, 29 октября, в 19:30, студия, адрес)");
    expect(again).toContain("получили 42 чел.");
  });

  it("строка ленты и сводка называют человека и его ответы", () => {
    const row = consentedRow({ step: "done", attend: "come", days: [THU, SAT], wd_from: "19:00", wd_to: "21:00", we_any: true });
    expect(surveyFeedLine(YOGA, row, { coming: 3, later: 1 })).toBe(
      "Аня (@anya) — придёт: чт 29.10, сб 31.10; будни 19:00–21:00, выходные любое время. Итого: придут 3, позже 1.",
    );

    const summary = surveySummaryText(YOGA, surveySummary([row], YOGA), "https://t.me/mynikarun_bot?start=yoga");
    expect(summary).toContain("Придут: 1.");
    expect(summary).toContain("• Аня (@anya): чт 29.10, сб 31.10; будни 19:00–21:00, выходные любое время");
    expect(summary).toContain("1. чт 29.10, 19:00 — 1 чел.");
    expect(summary).toContain("https://t.me/mynikarun_bot?start=yoga");
  });

  it("подписи кнопок участника — из одного места", () => {
    expect(Object.values(BUTTONS)).toContain("Подойдёт любое время");
  });
});
