import { describe, it, expect } from "vitest";
import {
  POLL_CALLBACK_RE,
  buildPollCallback,
  parsePollCallback,
  parseRollcallCallback,
  personLabel,
  pollKeyboard,
  pollReplyText,
  pollText,
  rollcallConfirmKeyboard,
  rollcallPreviewText,
  summaryText,
  voteLine,
} from "./poll-copy";
import { parseRollcallArgs } from "./coffeerun-poll";
import type { PollSummary, PollVote } from "./poll-store";
import { COFFEE_RUNS } from "../coffeerun/run";

const RUN = COFFEE_RUNS[0];

function vote(name: string, answer: "yes" | "no", username: string | null = null): PollVote {
  return { chatId: 1, name, username, answer, at: "2026-09-04T18:00:00.000Z" };
}

describe("callback_data опроса", () => {
  it("собирается и разбирается обратно вместе с датой забега", () => {
    expect(parsePollCallback(buildPollCallback("yes", RUN.date))).toEqual({
      answer: "yes",
      runDate: RUN.date,
      kind: "rain",
    });
    expect(parsePollCallback(buildPollCallback("no", RUN.date))).toEqual({
      answer: "no",
      runDate: RUN.date,
      kind: "rain",
    });
  });

  it("влезает в лимит Telegram (64 байта)", () => {
    expect(Buffer.byteLength(buildPollCallback("yes", RUN.date))).toBeLessThanOrEqual(64);
  });

  it("не путается с чужими кнопками и мусором", () => {
    expect(parsePollCallback("optin_yes")).toBeNull();
    expect(parsePollCallback("ans_1")).toBeNull();
    expect(parsePollCallback("crp_y_")).toBeNull();
    expect(parsePollCallback("crp_x_2026-09-05")).toBeNull();
    expect(parsePollCallback("crp_y_05.09.2026")).toBeNull();
    expect(parsePollCallback("")).toBeNull();
  });

  it("регексп бота ловит ровно свои данные", () => {
    expect(POLL_CALLBACK_RE.test(buildPollCallback("no", RUN.date))).toBe(true);
    expect(POLL_CALLBACK_RE.test("optin_no")).toBe(false);
  });
});

describe("pollText — что человек читает перед дождём", () => {
  const text = pollText({ name: "Аня" }, RUN);

  it("обращается по имени и называет забег, время и место", () => {
    expect(text).toContain("Аня");
    expect(text).toContain(RUN.spotName);
    expect(text).toContain(RUN.gatherTime);
    expect(text).toContain(RUN.startTime);
  });

  it("прямо говорит, что забег не отменён, и спрашивает про дождь", () => {
    expect(text).toContain("не отменяем");
    expect(text.toLowerCase()).toContain("дождь");
  });
});

describe("pollKeyboard — две кнопки ответа", () => {
  it("несёт оба варианта с датой забега внутри", () => {
    const kb = pollKeyboard(RUN.date);
    const data = kb.inline_keyboard
      .flat()
      .map((b) => ("callback_data" in b ? b.callback_data : null));
    expect(data).toContain(buildPollCallback("yes", RUN.date));
    expect(data).toContain(buildPollCallback("no", RUN.date));
  });
});

describe("pollReplyText — ответ бота участнику", () => {
  it("бегущему напоминает время и адрес", () => {
    const text = pollReplyText("yes", RUN);
    expect(text).toContain(RUN.gatherTime);
    expect(text).toContain(RUN.address);
  });

  it("отказавшегося не отчитывает и зовёт на следующий", () => {
    const text = pollReplyText("no", RUN);
    expect(text).toContain("следующем");
    expect(text.toLowerCase()).not.toContain("жаль");
  });
});

describe("лента организатора", () => {
  it("подписывает человека именем и ником, а вердикт — словами", () => {
    expect(personLabel({ name: "Аня", username: "anya" })).toBe("Аня (@anya)");
    expect(personLabel({ name: "Аня", username: null })).toBe("Аня");

    const line = voteLine(vote("Аня", "yes", "anya"), { yes: 3, no: 1 });
    expect(line).toContain("Аня (@anya)");
    expect(line).toContain("ПОБЕЖИТ");
    expect(line).toContain("побегут 3, не побегут 1");
  });
});

describe("summaryText — сводка по /poll", () => {
  const summary: PollSummary = {
    runDate: RUN.date,
    kind: "rain",
    startTime: null,
    yes: [vote("Аня", "yes", "anya"), vote("Игорь", "yes")],
    no: [vote("Лена", "no", "lenka")],
    silent: [{ chatId: 9, name: "Пётр", username: "petya" }],
    asked: 4,
  };

  it("показывает цифры и поимённые списки", () => {
    const text = summaryText(summary, RUN);
    expect(text).toContain("Побегут: 2");
    expect(text).toContain("Не побегут: 1");
    expect(text).toContain("Молчат: 1");
    expect(text).toContain("Всего спросили: 4");
    expect(text).toContain("Аня (@anya)");
    expect(text).toContain("Пётр (@petya)");
    expect(text).toContain(RUN.spotName);
  });

  it("до первой рассылки объясняет, что опроса ещё нет", () => {
    const text = summaryText(
      { runDate: "", kind: "rain", startTime: null, yes: [], no: [], silent: [], asked: 0 },
      null,
    );
    expect(text).toContain("/rollcall");
  });
});

describe("перекличка «кто придёт сегодня»", () => {
  it("вопрос называет время старта, место и сбор", () => {
    const text = pollText({ name: "Аня" }, RUN, "rollcall", "18:00");
    expect(text).toContain("Аня");
    expect(text).toContain("18:00");
    expect(text).toContain("17:45");
    expect(text).toContain(RUN.address);
    expect(text).toContain("придёшь?");
  });

  it("без времени берёт штатное время забега", () => {
    expect(pollText({ name: "Аня" }, RUN, "rollcall", null)).toContain(RUN.startTime);
  });

  it("кнопки говорят «приду», а не «побегу», и несут вид опроса", () => {
    const kb = pollKeyboard(RUN.date, "rollcall");
    const labels = kb.inline_keyboard.flat().map((b) => b.text);
    const data = kb.inline_keyboard
      .flat()
      .map((b) => ("callback_data" in b ? b.callback_data : null));
    expect(labels).toContain("Приду 🏃");
    expect(labels).toContain("Не приду");
    expect(data).toContain(`crp_y_${RUN.date}_c`);
  });

  it("ответ отметившемуся называет время и адрес", () => {
    const text = pollReplyText("yes", RUN, "rollcall", "18:00");
    expect(text).toContain("18:00");
    expect(text).toContain(RUN.address);
  });

  it("лента организатору говорит «ПРИДЁТ» и считает придут/не придут", () => {
    const line = voteLine(vote("Аня", "yes", "anya"), { yes: 5, no: 2 }, "rollcall");
    expect(line).toContain("ПРИДЁТ");
    expect(line).toContain("придут 5, не придут 2");
  });

  it("сводка подписана как перекличка и показывает время старта", () => {
    const text = summaryText(
      {
        runDate: RUN.date,
        kind: "rollcall",
        startTime: "18:00",
        yes: [vote("Аня", "yes", "anya")],
        no: [],
        silent: [],
        asked: 1,
      },
      RUN,
    );
    expect(text).toContain("Перекличка");
    expect(text).toContain("старт в 18:00");
    expect(text).toContain("Придут: 1");
    expect(text).toContain("Не придут: 0");
  });

  it("предпросмотр показывает текст, число получателей и метку переноса", () => {
    const preview = rollcallPreviewText(RUN, "18:00", 34, true);
    expect(preview).toContain(RUN.spotName);
    expect(preview).toContain("18:00");
    expect(preview).toContain("34 чел.");
    expect(preview).toContain("переноса");
  });

  it("кнопки подтверждения разбираются обратно", () => {
    const kb = rollcallConfirmKeyboard(RUN.date, "18:00");
    const data = kb.inline_keyboard
      .flat()
      .map((b) => ("callback_data" in b ? b.callback_data : null));
    expect(data).toContain(`rc_go_${RUN.date}_18:00`);
    expect(parseRollcallCallback(`rc_go_${RUN.date}_18:00`)).toEqual({
      action: "send",
      runDate: RUN.date,
      startTime: "18:00",
    });
    expect(parseRollcallCallback("rc_no")).toEqual({ action: "cancel" });
    expect(parseRollcallCallback("mv_no")).toBeNull();
  });
});

describe("кнопки опроса различают вопросы", () => {
  it("вид зашит в callback_data", () => {
    expect(parsePollCallback(buildPollCallback("yes", RUN.date, "rollcall"))).toEqual({
      answer: "yes",
      runDate: RUN.date,
      kind: "rollcall",
    });
    expect(parsePollCallback(buildPollCallback("no", RUN.date, "rain"))).toEqual({
      answer: "no",
      runDate: RUN.date,
      kind: "rain",
    });
  });

  it("кнопки, разосланные до появления вида, читаются как «дождь»", () => {
    expect(parsePollCallback(`crp_y_${RUN.date}`)).toEqual({
      answer: "yes",
      runDate: RUN.date,
      kind: "rain",
    });
  });
});

describe("аргументы /rollcall", () => {
  it("пустые — время подставит вызывающий", () => {
    expect(parseRollcallArgs("")).toEqual({ runDate: null, startTime: null });
  });

  it("различает время и дату в любом порядке", () => {
    expect(parseRollcallArgs("18:00")).toEqual({ runDate: null, startTime: "18:00" });
    expect(parseRollcallArgs("2026-09-06 19:00")).toEqual({
      runDate: "2026-09-06",
      startTime: "19:00",
    });
    expect(parseRollcallArgs("19:00 2026-09-06")).toEqual({
      runDate: "2026-09-06",
      startTime: "19:00",
    });
  });
});
