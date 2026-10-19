import { describe, it, expect } from "vitest";
import {
  currentGroup,
  surveyStep,
  timeGroups,
  type FlowContext,
  type FlowEvent,
  type ParticipantAction,
} from "./survey-flow";
import { ANSWERS_RESET, type SurveyResponseRow } from "./survey-store";
import { YOGA, consentedRow, surveyRow } from "../../test/club-survey-row";

const NOW = new Date("2026-10-20T10:00:00.000Z");
const THU = "2026-10-29";
const FRI = "2026-10-30";
const SAT = "2026-10-31";

function ctx(overrides: Partial<FlowContext> = {}): FlowContext {
  return {
    survey: YOGA,
    now: NOW,
    resultSent: false,
    legalVersion: "2026-09-30",
    person: { name: "Аня Петрова", username: "anya" },
    ...overrides,
  };
}

const press = (action: ParticipantAction): FlowEvent => ({ type: "action", action });
const text = (t: string): FlowEvent => ({ type: "text", text: t });
const START: FlowEvent = { type: "start" };

/** Строка после патча — как её увидит следующий шаг. */
function apply(row: SurveyResponseRow, patch: Partial<SurveyResponseRow>): SurveyResponseRow {
  return { ...row, ...patch };
}

describe("вход: /start yoga", () => {
  it("новенький: заводим строку и шлём текст 1", () => {
    const out = surveyStep(null, START, ctx());
    expect(out).toMatchObject({ create: true, patch: { step: "interest" }, send: ["interest"] });
  });

  it.each(["interest", "consent", "attend", "days", "later", "time"] as const)(
    "на шаге %s повторяет текущий шаг и снимает старые кнопки",
    (step) => {
      const row = consentedRow({ step, attend: step === "later" ? "later" : "come", time_q: "all", days: [THU] });
      const out = surveyStep(row, START, ctx());
      expect(out.send).toEqual([step]);
      expect(out.stripLast).toBe(true);
      expect(out.patch).toEqual({});
    },
  );

  it("после done — текст 6, после «позже» — 3б", () => {
    expect(surveyStep(consentedRow({ step: "done" }), START, ctx()).send).toEqual(["done"]);
    expect(surveyStep(consentedRow({ step: "later_done" }), START, ctx()).send).toEqual(["later_done"]);
  });

  it("после «Пока пропущу» и «Посмотрю итог в чате» — шаг 1 заново", () => {
    for (const step of ["skipped", "declined"] as const) {
      const out = surveyStep(surveyRow({ step }), START, ctx());
      expect(out).toMatchObject({ patch: { step: "interest" }, send: ["interest"] });
    }
  });

  it("после итога: с согласием — повтор итога, иначе общий ответ", () => {
    const after = ctx({ resultSent: true });
    expect(surveyStep(consentedRow({ step: "done", result_id: 3 }), START, after).send).toEqual(["result_repeat"]);
    expect(surveyStep(surveyRow({ step: "skipped" }), START, after).send).toEqual(["fallback"]);
    expect(surveyStep(null, START, after)).toMatchObject({ create: false, send: ["fallback"] });
  });
});

describe("шаги 1–3", () => {
  it("«Интересно» → согласие (текст 2)", () => {
    const out = surveyStep(surveyRow(), press({ type: "interest", yes: true }), ctx());
    expect(out).toMatchObject({ patch: { step: "consent" }, send: ["consent"], stripPressed: true });
  });

  it("«Пока пропущу» → 1а", () => {
    const out = surveyStep(surveyRow(), press({ type: "interest", yes: false }), ctx());
    expect(out).toMatchObject({ patch: { step: "skipped" }, send: ["skipped"] });
  });

  it("«Даю согласие» → шаг 3, пишем момент, версию документа и имя", () => {
    const out = surveyStep(surveyRow({ step: "consent" }), press({ type: "consent", yes: true }), ctx());
    expect(out.patch).toEqual({
      step: "attend",
      consent_at: NOW.toISOString(),
      consent_version: "2026-09-30",
      name: "Аня Петрова",
      username: "anya",
    });
    expect(out.send).toEqual(["attend"]);
  });

  it("«Посмотрю итог в чате» → 2а, без имени и ответов", () => {
    const out = surveyStep(surveyRow({ step: "consent" }), press({ type: "consent", yes: false }), ctx());
    expect(out).toMatchObject({ patch: { step: "declined" }, send: ["declined"] });
    expect(Object.keys(out.patch)).toEqual(["step"]);
  });

  it("«Приду» → дни, «Присоединюсь позже» → дни недели", () => {
    const row = consentedRow({ step: "attend" });
    expect(surveyStep(row, press({ type: "attend", come: true }), ctx())).toMatchObject({
      patch: { step: "days", attend: "come" },
      send: ["days"],
    });
    expect(surveyStep(row, press({ type: "attend", come: false }), ctx())).toMatchObject({
      patch: { step: "later", attend: "later" },
      send: ["later"],
    });
  });
});

describe("шаг 4: дни", () => {
  const row = consentedRow({ step: "days", attend: "come" });

  it("переключатель добавляет и убирает день, порядок — как в конфиге", () => {
    const on = surveyStep(apply(row, { days: [SAT] }), press({ type: "day", index: 1 }), ctx());
    expect(on).toMatchObject({ patch: { days: [THU, SAT] }, redraw: "days", send: [] });

    const off = surveyStep(apply(row, { days: [THU, SAT] }), press({ type: "day", index: 1 }), ctx());
    expect(off.patch).toEqual({ days: [SAT] });
  });

  it("индекс вне списка — старая кнопка", () => {
    expect(surveyStep(row, press({ type: "day", index: 9 }), ctx()).ignored).toBe(true);
  });

  it("«Готово» без дней — текст 4а, кнопки дней остаются", () => {
    const out = surveyStep(row, press({ type: "days_done" }), ctx());
    expect(out).toMatchObject({ send: ["days_empty"], stripPressed: false, patch: {} });
  });

  it("«Присоединюсь позже» из 4а снимает кнопки и с 4а, и с сообщения дней", () => {
    const out = surveyStep(row, press({ type: "attend", come: false }), ctx());
    expect(out).toMatchObject({
      patch: { step: "later", attend: "later", days: [] },
      send: ["later"],
      stripPressed: true,
      stripLast: true,
    });
  });

  it("только будни — один вопрос (5)", () => {
    const out = surveyStep(apply(row, { days: [THU, FRI] }), press({ type: "days_done" }), ctx());
    expect(out).toMatchObject({ patch: { step: "time", time_q: "all", fail_count: 0 }, send: ["time"] });
  });

  it("будни и выходные — сначала вопрос про будни (5б)", () => {
    const out = surveyStep(apply(row, { days: [THU, SAT] }), press({ type: "days_done" }), ctx());
    expect(out.patch).toMatchObject({ step: "time", time_q: "wd" });
  });
});

describe("шаг 3а: «Присоединюсь позже»", () => {
  const row = consentedRow({ step: "later", attend: "later" });

  it("переключатель дня недели, порядок Пн…Вс", () => {
    const out = surveyStep(apply(row, { weekdays: [0] }), press({ type: "weekday", day: 1 }), ctx());
    expect(out).toMatchObject({ patch: { weekdays: [1, 0] }, redraw: "weekdays" });
  });

  it("«Пропустить» и «Готово» без отметок → 3б сразу", () => {
    for (const action of [{ type: "weekdays_skip" }, { type: "weekdays_done" }] as const) {
      const out = surveyStep(row, press(action), ctx());
      expect(out).toMatchObject({
        patch: { step: "later_done", finished_at: NOW.toISOString() },
        send: ["later_done"],
        feed: "finished",
      });
    }
  });

  it("«Готово» с днями → вопрос о времени по тем же правилам", () => {
    const out = surveyStep(apply(row, { weekdays: [1, 6] }), press({ type: "weekdays_done" }), ctx());
    expect(out.patch).toMatchObject({ step: "time", time_q: "wd" });
  });
});

describe("шаг 5: время", () => {
  const oneGroup = consentedRow({ step: "time", attend: "come", days: [THU], time_q: "all" });
  const twoGroups = consentedRow({ step: "time", attend: "come", days: [THU, SAT], time_q: "wd" });

  it("разобранный промежуток → финиш, текст 6, строка в ленту", () => {
    const out = surveyStep(oneGroup, text("с 19 до 21"), ctx());
    expect(out.patch).toMatchObject({
      wd_from: "19:00",
      wd_to: "21:00",
      wd_raw: "с 19 до 21",
      wd_any: false,
      step: "done",
      time_q: null,
      finished_at: NOW.toISOString(),
    });
    expect(out).toMatchObject({ send: ["done"], feed: "finished", stripLast: true });
  });

  it("две группы: после будней — вопрос про выходные (5в)", () => {
    const first = surveyStep(twoGroups, text("19-21"), ctx());
    expect(first).toMatchObject({ patch: { time_q: "we", wd_from: "19:00" }, send: ["time"], feed: null });

    const second = surveyStep(apply(twoGroups, first.patch), text("с 11 до 14"), ctx());
    expect(second.patch).toMatchObject({ we_from: "11:00", we_to: "14:00", step: "done" });
  });

  it("«Подойдёт любое время» — кнопка", () => {
    const out = surveyStep(twoGroups, press({ type: "any_time" }), ctx());
    expect(out).toMatchObject({ patch: { wd_any: true, time_q: "we" }, stripPressed: true });
  });

  it("первая неудача — 5г или 5д, ничего не сохраняем", () => {
    expect(surveyStep(oneGroup, text("абв"), ctx())).toMatchObject({ patch: { fail_count: 1 }, send: ["time_retry"] });
    expect(surveyStep(oneGroup, text("21-19"), ctx()).send).toEqual(["time_retry"]);
    expect(surveyStep(oneGroup, text("19-19:30"), ctx()).send).toEqual(["time_short"]);
  });

  it("вторая неудача подряд — сохраняем текст как есть, 5е и дальше", () => {
    const out = surveyStep(apply(oneGroup, { fail_count: 1 }), text("после работы"), ctx());
    expect(out.patch).toMatchObject({ wd_raw: "после работы", wd_from: null, wd_any: false, step: "done" });
    expect(out.send).toEqual(["time_saved", "done"]);
  });

  it("вторая неудача на вопросе про будни ведёт к вопросу про выходные", () => {
    const out = surveyStep(apply(twoGroups, { fail_count: 1 }), text("как получится"), ctx());
    expect(out.patch).toMatchObject({ wd_raw: "как получится", time_q: "we", fail_count: 0 });
    expect(out.send).toEqual(["time_saved", "time"]);
  });

  it("ветка «позже» заканчивается текстом 3б", () => {
    const later = consentedRow({ step: "time", attend: "later", weekdays: [1], time_q: "all" });
    expect(surveyStep(later, text("с 19 до 21"), ctx())).toMatchObject({
      patch: { step: "later_done" },
      send: ["later_done"],
    });
  });

  it("длинный ответ обрезается до 500 символов", () => {
    const out = surveyStep(apply(oneGroup, { fail_count: 1 }), text("я".repeat(800)), ctx());
    expect(out.patch.wd_raw).toHaveLength(500);
  });
});

describe("«Изменить ответ» и «Продолжить»", () => {
  it("с согласием — стираем ответы, начинаем с шага 3", () => {
    const row = consentedRow({ step: "done", attend: "come", days: [THU], wd_from: "19:00", wd_to: "21:00" });
    const out = surveyStep(row, press({ type: "edit" }), ctx());
    expect(out.patch).toEqual({ ...ANSWERS_RESET, step: "attend" });
    expect(out.send).toEqual(["attend"]);
    expect(out.patch).not.toHaveProperty("consent_at");
  });

  it("без согласия (после «Пока пропущу») — с шага 1", () => {
    const out = surveyStep(surveyRow({ step: "skipped" }), press({ type: "edit" }), ctx());
    expect(out).toMatchObject({ patch: { step: "interest" }, send: ["interest"] });
  });

  it("после рассылки итога — не работает", () => {
    const out = surveyStep(consentedRow({ step: "done" }), press({ type: "edit" }), ctx({ resultSent: true }));
    expect(out.ignored).toBe(true);
  });

  it("на незаконченном шаге «Изменить ответ» — старая кнопка", () => {
    expect(surveyStep(consentedRow({ step: "days" }), press({ type: "edit" }), ctx()).ignored).toBe(true);
  });

  it("«Продолжить» повторяет текущий шаг; без согласия — игнор", () => {
    const row = consentedRow({ step: "days", attend: "come" });
    expect(surveyStep(row, press({ type: "continue" }), ctx())).toMatchObject({ send: ["days"], stripLast: true });
    expect(surveyStep(surveyRow({ step: "skipped" }), press({ type: "continue" }), ctx()).ignored).toBe(true);
  });
});

describe("старые кнопки и свободный текст", () => {
  it.each<[string, SurveyResponseRow, ParticipantAction]>([
    ["«Интересно» на шаге дней", consentedRow({ step: "days" }), { type: "interest", yes: true }],
    ["«Даю согласие» после согласия", consentedRow({ step: "attend" }), { type: "consent", yes: true }],
    ["«Приду» на шаге времени", consentedRow({ step: "time" }), { type: "attend", come: true }],
    ["переключатель дня после «Готово»", consentedRow({ step: "time" }), { type: "day", index: 0 }],
    ["«любое время» после финиша", consentedRow({ step: "done" }), { type: "any_time" }],
    ["день недели на шаге дней", consentedRow({ step: "days" }), { type: "weekday", day: 1 }],
  ])("%s — ничего не меняет", (_name, row, action) => {
    const out = surveyStep(row, press(action), ctx());
    expect(out).toMatchObject({ ignored: true, patch: {}, send: [] });
  });

  it.each(["interest", "consent", "attend", "days", "later"] as const)(
    "текст на шаге %s — повтор сообщения шага",
    (step) => {
      expect(surveyStep(consentedRow({ step }), text("привет"), ctx())).toMatchObject({ send: [step], stripLast: true });
    },
  );

  it("текст после финиша — 6 или 3б до итога, общий ответ после", () => {
    expect(surveyStep(consentedRow({ step: "done" }), text("ок"), ctx()).send).toEqual(["done"]);
    expect(surveyStep(consentedRow({ step: "done" }), text("ок"), ctx({ resultSent: true })).send).toEqual(["fallback"]);
    expect(surveyStep(surveyRow({ step: "skipped" }), text("ок"), ctx()).send).toEqual(["fallback"]);
  });

  it("кнопка без строки — игнор", () => {
    expect(surveyStep(null, press({ type: "interest", yes: true }), ctx()).ignored).toBe(true);
  });
});

describe("ответ на итог", () => {
  const row = consentedRow({ step: "done", result_id: 7 });

  it("кнопка действующей версии — 10 или 11, строка в ленту", () => {
    expect(surveyStep(row, press({ type: "result", resultId: 7, yes: true }), ctx({ resultSent: true }))).toMatchObject({
      patch: { result_answer: "yes" },
      send: ["result_yes"],
      feed: "result_answer",
    });
    expect(surveyStep(row, press({ type: "result", resultId: 7, yes: false }), ctx()).send).toEqual(["result_no"]);
  });

  it("кнопка прошлой версии итога — игнор", () => {
    expect(surveyStep(row, press({ type: "result", resultId: 6, yes: true }), ctx()).ignored).toBe(true);
  });
});

describe("группы вопроса о времени", () => {
  it("ветка «Приду» — по датам, «позже» — по дням недели", () => {
    expect(timeGroups(consentedRow({ attend: "come", days: [SAT, THU] }))).toEqual(["wd", "we"]);
    expect(timeGroups(consentedRow({ attend: "later", weekdays: [0] }))).toEqual(["we"]);
  });

  it("общий вопрос относится к единственной группе", () => {
    expect(currentGroup(consentedRow({ attend: "come", days: [SAT], time_q: "all" }))).toBe("we");
    expect(currentGroup(consentedRow({ attend: "come", days: [THU, SAT], time_q: "we" }))).toBe("we");
  });
});

describe("шаг 5: разное время по дням", () => {
  const twoDays = consentedRow({ step: "time", attend: "come", days: [THU, FRI], time_q: "all" });
  const twoGroups = consentedRow({ step: "time", attend: "come", days: [THU, FRI, SAT], time_q: "wd" });

  it("каждому дню своё время — финиш", () => {
    const out = surveyStep(twoDays, text("чт с 19 до 21, пт с 18 до 20"), ctx());
    expect(out.patch).toMatchObject({
      day_times: { "4": { from: "19:00", to: "21:00" }, "5": { from: "18:00", to: "20:00" } },
      step: "done",
    });
    expect(out.send).toEqual(["done"]);
  });

  it("назвал не все дни — переспрашиваем про оставшиеся", () => {
    const first = surveyStep(twoGroups, text("чт с 19 до 21, сб с 11 до 14"), ctx());
    expect(first.patch).toMatchObject({
      day_times: { "4": { from: "19:00", to: "21:00" }, "6": { from: "11:00", to: "14:00" } },
      time_q: "wd",
      fail_count: 0,
    });
    expect(first.send).toEqual(["time"]);

    // Ответ без дней — про оставшуюся пятницу: ложится на группу будней.
    const second = surveyStep(apply(twoGroups, first.patch), text("с 18 до 20"), ctx());
    expect(second.patch).toMatchObject({ wd_from: "18:00", wd_to: "20:00", step: "done" });
  });

  it("на вопросе про будни ответил и про выходные — вопроса про выходные нет", () => {
    const row = consentedRow({ step: "time", attend: "come", days: [THU, SAT], time_q: "wd" });
    const out = surveyStep(row, text("по будням с 19 до 21, в выходные с 11 до 14"), ctx());
    expect(out.patch).toMatchObject({ step: "done" });
  });

  it("на вопросе про будни назвал только выходной — снова спрашиваем про будни", () => {
    const row = consentedRow({ step: "time", attend: "come", days: [THU, SAT], time_q: "wd" });
    const out = surveyStep(row, text("сб с 11 до 14"), ctx());
    expect(out.patch).toMatchObject({ day_times: { "6": { from: "11:00", to: "14:00" } }, time_q: "wd" });
    expect(out.send).toEqual(["time"]);
  });

  it("«любое время» текстом", () => {
    const out = surveyStep(twoDays, text("в любое время"), ctx());
    expect(out.patch).toMatchObject({ wd_any: true, step: "done" });
  });

  it("назвал только невыбранные дни — 5ж, считаем неудачей", () => {
    const out = surveyStep(twoDays, text("пн с 19 до 21"), ctx());
    expect(out).toMatchObject({ patch: { fail_count: 1 }, send: ["time_other_days"] });
  });

  it("ветка «позже» — по дням недели", () => {
    const later = consentedRow({ step: "time", attend: "later", weekdays: [1, 3], time_q: "all" });
    const out = surveyStep(later, text("пн с 19 до 21, ср с 8 до 10 утра"), ctx());
    expect(out.patch).toMatchObject({
      day_times: { "1": { from: "19:00", to: "21:00" }, "3": { from: "08:00", to: "10:00" } },
      step: "later_done",
    });
  });

  it("«Изменить ответ» стирает и время по дням", () => {
    expect(ANSWERS_RESET).toMatchObject({ day_times: {} });
  });
});
